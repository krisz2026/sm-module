const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:true}));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DB_FILE = process.env.DB_FILE || './db.json';
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || '';
let useMongo = false;
let ShopModel = null;
let CartModel = null;

if (MONGO_URI) {
  try {
    const mongoose = require('mongoose');
    mongoose.connect(MONGO_URI).then(() => {
      console.log('MongoDB Atlas OK');
      useMongo = true;
    }).catch(e => {
      console.log('Mongo hiba:', e.message);
    });
    const shopSchema = new mongoose.Schema({
      _id: String, name: String,
      revenue: { type: Number, default: 0 },
      cartCount: { type: Number, default: 0 },
      disabled: { type: Boolean, default: false },
      expiresAt: { type: Date, default: null },
      createdAt: { type: Date, default: Date.now }
    }, { _id: false });
    const cartSchema = new mongoose.Schema({
      apiKey: String, session: mongoose.Schema.Types.Mixed, cart: Array, total: Number,
      time: { type: Date, default: Date.now }
    });
    ShopModel = mongoose.model('Shop', shopSchema);
    CartModel = mongoose.model('Cart', cartSchema);
  } catch (e) { console.log('mongoose nincs'); }
}

let db = { shops: {}, carts: [] };
function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (!db.shops) db.shops = {};
      if (!db.carts) db.carts = [];
    }
  } catch {}
}
function save() { if (useMongo) return; try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch {} }
load();
let idempotency = {};
function parseCookies(req) { let list = {}; let rc = req.headers.cookie; if (rc) rc.split(';').forEach(c => { let parts = c.split('='); list[parts.shift().trim()] = decodeURI(parts.join('=')); }); return list; }
function isAuthed(req) { let c = parseCookies(req); return c.admin_auth === ADMIN_PASSWORD; }
function requireAuth(req, res, next) { if (isAuthed(req)) return next(); res.redirect('/admin/login'); }

app.get('/admin/login',(req,res)=>{
res.send('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:sans-serif;background:#f8fafc;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:32px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.08);width:340px}input{width:100%;padding:14px;margin:10px 0;border:1px solid #e2e8f0;border-radius:10px;box-sizing:border-box}button{width:100%;padding:14px;background:#0f172a;color:white;border:0;border-radius:10px;font-weight:600;cursor:pointer}</style></head><body><div class="card"><h2>SM Admin</h2><p>Lepj be</p><form method="POST" action="/api/v1/admin/login"><input type="password" name="password" placeholder="admin123"><button type="submit">Belepes</button></form></div></body></html>')
})

app.all('/api/v1/admin/login',(req,res)=>{
let pass=req.body.password||req.body.pass||req.query.password;
if(pass===ADMIN_PASSWORD){
res.setHeader('Set-Cookie','admin_auth='+ADMIN_PASSWORD+'; Path=/; HttpOnly; SameSite=Lax');
return res.redirect('/admin')
}
res.send('<h1>Hibas jelszo!</h1><a href="/admin/login">Vissza</a>')
})
app.get('/admin/logout',(req,res)=>{
res.setHeader('Set-Cookie','admin_auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
res.redirect('/admin/login')
})

app.get('/admin',requireAuth,async(req,res)=>{
let shops=[];
if(useMongo && ShopModel){
 shops = await ShopModel.find({}).lean();
} else {
 shops = Object.keys(db.shops).map(k=>({...db.shops[k], _id:k, apiKey:k}));
}
let html='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:sans-serif;padding:20px;background:#f8fafc}.card{background:white;padding:16px;border-radius:12px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.06)}.key{font-family:monospace;background:#f1f5f9;padding:4px 8px;border-radius:6px;font-size:12px;word-break:break-all}</style></head><body>';
html+='<h1>SM Admin V9 - EGYSZERU NEZET ✅</h1><p><a href="/admin/logout">Kilepes</a> | <a href="/">Fooldal</a> | <a href="/api/v1/debug/shops">JSON lista</a></p>';
html+='<p>DB: '+(useMongo?'MongoDB Atlas ✅':'file')+' | Boltok: '+shops.length+'</p>';
html+='<div style="background:white;padding:16px;border-radius:12px;margin-bottom:20px"><h3>Uj bolt</h3><form onsubmit="createShop(event)"><input id="shopName" placeholder="Bolt nev" required><button type="submit">Letrehoz</button></form><div id="res"></div></div>';
html+='<h2>Boltok listaja</h2>';
shops.forEach(s=>{
 html+='<div class="card"><b>'+ (s.name||'Nev nelkul') +'</b> '+(s.disabled?'⛔ Tiltva':'● Aktiv')+'<br><div class="key">'+ (s._id||s.apiKey) +'</div><div>Bevetel: '+(s.revenue||0)+' Ft | Kosar: '+(s.cartCount||0)+'</div></div>';
});
html+='<script>async function createShop(e){e.preventDefault();let name=document.getElementById("shopName").value;let r=await fetch("/api/v1/admin/create-shop",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});let d=await r.json();document.getElementById("res").innerText="OK! Kulcs: "+d.apiKey; location.reload();}</script>';
html+='</body></html>';
res.send(html);
})

app.get('/api/v1/admin/stats',async(req,res)=>{
if(!isAuthed(req)) return res.status(401).json({ok:false});
let shopsMap={}; let carts=[]; let dailyMap={}; let weeklyMap={}; let monthlyMap={}; let perShop={};
if(useMongo && ShopModel){
let sArr=await ShopModel.find({}); sArr.forEach(s=>{ shopsMap[s._id]=s; perShop[s._id]={name:s.name, revenue:s.revenue||0, count:s.cartCount||0, apiKey:s._id, disabled:s.disabled, expiresAt:s.expiresAt}; });
let cArr=await CartModel.find({}).sort({time:-1}).limit(2000); carts=cArr;
} else { shopsMap=db.shops; carts=db.carts; }
if(useMongo){
carts.forEach(c=>{ let t=new Date(c.time); let day=t.toISOString().slice(0,10); let month=t.toISOString().slice(0,7); let week=getWeek(t); dailyMap[day]=(dailyMap[day]||0)+(c.total||0); weeklyMap[week]=(weeklyMap[week]||0)+(c.total||0); monthlyMap[month]=(monthlyMap[month]||0)+(c.total||0); })
} else { carts = db.carts; for(let k in db.shops){ perShop[k]={name:db.shops[k].name, revenue:0, count:0, apiKey:k} } }
carts.forEach(c=>{ let k=c.apiKey||c.shopId; let t=new Date(c.time||c.createdAt); if(!t||isNaN(t)) t=new Date(); let day=t.toISOString().slice(0,10); let month=t.toISOString().slice(0,7); let week=getWeek(t); dailyMap[day]=(dailyMap[day]||0)+(c.total||0); weeklyMap[week]=(weeklyMap[week]||0)+(c.total||0); monthlyMap[month]=(monthlyMap[month]||0)+(c.total||0); if(!perShop[k]) perShop[k]={name:k,revenue:0,count:0,apiKey:k}; perShop[k].revenue+=c.total||0; perShop[k].count+=1; })
let daily=Object.keys(dailyMap).sort().slice(-14).map(k=>({date:k,total:dailyMap[k]}))
let weekly=Object.keys(weeklyMap).sort().slice(-12).map(k=>({date:k,total:weeklyMap[k]}))
let monthly=Object.keys(monthlyMap).sort().slice(-12).map(k=>({date:k,total:monthlyMap[k]}))
if(daily.length===0) daily=[{date:new Date().toISOString().slice(0,10),total:0}]
res.json({daily,weekly,monthly,perShop})
})
app.post('/api/v1/admin/create-shop',async(req,res)=>{
if(!isAuthed(req)) return res.status(401).json({ok:false});
let name=req.body.name||'Shop'; let expiresInDays=parseInt(req.body.expiresInDays||0); let key='sm_live_'+crypto.randomBytes(16).toString('hex'); let expiresAt=null; if(expiresInDays>0){expiresAt=new Date(); expiresAt.setDate(expiresAt.getDate()+expiresInDays)}
if(useMongo && ShopModel){ await ShopModel.create({_id:key,name,revenue:0,cartCount:0,expiresAt,createdAt:new Date()}) } else { db.shops[key]={name, revenue:0, cartCount:0, expiresAt, createdAt:new Date()}; save() }
res.json({ok:true,apiKey:key,shop:name,expiresAt})
})
app.post('/api/v1/admin/disable-key',async(req,res)=>{
if(!isAuthed(req)) return res.status(401).json({ok:false}); let key=req.body.apiKey
if(useMongo && ShopModel){ await ShopModel.updateOne({_id:key},{disabled:true}); return res.json({ok:true}); }
if(db.shops[key]){db.shops[key].disabled=true; save(); res.json({ok:true})} else res.status(404).json({ok:false})
})
app.post('/api/v1/admin/regenerate',async(req,res)=>{
if(!isAuthed(req)) return res.status(401).json({ok:false}); let oldKey=req.body.apiKey; let oldData=null;
if(useMongo && ShopModel){ oldData=await ShopModel.findById(oldKey); if(!oldData) return res.status(404).json({ok:false}); } else oldData=db.shops[oldKey];
if(!oldData) return res.status(404).json({ok:false}); let newKey='sm_live_'+crypto.randomBytes(16).toString('hex')
if(useMongo && ShopModel){ await ShopModel.create({_id:newKey,name:oldData.name,revenue:oldData.revenue,cartCount:oldData.cartCount,createdAt:new Date(),expiresAt:oldData.expiresAt}); await ShopModel.updateOne({_id:oldKey},{disabled:true}); } else { db.shops[newKey]={...oldData,createdAt:new Date()}; db.shops[oldKey].disabled=true; save(); }
res.json({ok:true,newApiKey:newKey})
})
app.post('/api/v1/cart',async(req,res)=>{
let apiKey=req.headers['x-api-key']; let shop=null;
if(useMongo && ShopModel){ shop=await ShopModel.findById(apiKey); if(!shop) return res.status(401).json({ok:false,msg:'bad key'}); } else { if(!apiKey||!db.shops[apiKey]) return res.status(401).json({ok:false}); shop=db.shops[apiKey]; }
if(shop.disabled) return res.status(403).json({ok:false,msg:'disabled'}); if(shop.expiresAt && new Date(shop.expiresAt)<new Date()) return res.status(403).json({ok:false,msg:'expired'});
let idemKey=req.headers['x-idempotency-key']; if(idemKey&&idempotency[idemKey]) return res.json(idempotency[idemKey])
let cart=req.body.cart||[]; let session=req.body.session||'unknown'; let total=0; cart.forEach(i=>{total+= (i.price||0)*(i.qty||1)})
if(useMongo && CartModel){ shop.revenue+=total; shop.cartCount+=1; await shop.save(); await CartModel.create({apiKey,session,cart,total,time:new Date()}); } else { shop.revenue+=total; shop.cartCount+=1; db.carts.push({apiKey,session,cart,total,time:new Date()}); if(db.carts.length>2000) db.carts=db.carts.slice(-2000); save() }
let valasz={ok:true,received:cart.length,total}; if(idemKey) idempotency[idemKey]=valasz; res.json(valasz)
})

app.get('/api/v1/debug/add-cart', async(req,res)=>{
try{
let key=req.query.key||req.query.apiKey;
if(!key) return res.status(400).send('Hianyzik ?key= parameter');
let shop=null;
if(useMongo && ShopModel){ 
  shop=await ShopModel.findById(key);
  if(!shop){
    shop = await ShopModel.create({_id:key, name:'ElsoBoltom', revenue:0, cartCount:0, createdAt:new Date()});
  }
}
else { shop=db.shops[key]; if(shop) shop._id=key; }
if(!shop) return res.status(404).send('Nincs ilyen bolt: '+key);
let price=5990;
if(useMongo && ShopModel){
shop.revenue=(shop.revenue||0)+price;
shop.cartCount=(shop.cartCount||0)+1;
await shop.save();
await CartModel.create({apiKey:key, session:{test:true, name:'debug'}, cart:[{name:'Teszt Termek', price, qty:1}], total:price, time:new Date()});
} else {
shop.revenue=(shop.revenue||0)+price;
shop.cartCount=(shop.cartCount||0)+1;
db.carts.push({apiKey:key, session:{test:true}, cart:[{name:'Teszt Termek', price, qty:1}], total:price, time:new Date()});
save();
}
res.send('<h1>SIKER!</h1><p>Bolt: '+(shop.name||key)+'</p><p>+'+price+' Ft hozzaadva!</p><p>CartCount: '+shop.cartCount+'</p><p>Revenue: '+shop.revenue+'</p><a href="/admin">Menj az Adminba -></a>');
}catch(e){ res.status(500).send('HIBA: '+e.message); }
});

app.get('/api/v1/debug/create', async(req,res)=>{
try{
let name=req.query.name||'Teszt Bolt';
let key='sm_live_'+crypto.randomBytes(16).toString('hex');
if(useMongo && ShopModel){
await ShopModel.create({_id:key,name,revenue:0,cartCount:0,createdAt:new Date(),expiresAt:null});
return res.json({ok:true, apiKey:key, msg:'MongoDB-ben letrehozva!', mongo: true});
} else {
db.shops[key]={name,revenue:0,cartCount:0,createdAt:new Date(),expiresAt:null};
save();
return res.json({ok:true, apiKey:key, msg:'File DB-ben letrehozva', mongo:false});
}
}catch(e){ res.status(500).json({ok:false, error:e.message, stack:e.stack}); }
});
app.get('/api/v1/debug/shops', async(req,res)=>{
if(useMongo && ShopModel){ let arr=await ShopModel.find({}); res.json({mongo:true, count:arr.length, shops:arr}); }
else { res.json({mongo:false, shops:db.shops}); }
});

function getWeek(d){let date=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())); let dayNum=date.getUTCDay()||7; date.setUTCDate(date.getUTCDate()+4-dayNum); let yearStart=new Date(Date.UTC(date.getUTCFullYear(),0,1)); let weekNo=Math.ceil(( ( (date - yearStart)/86400000)+1)/7); return date.getUTCFullYear()+'-W'+String(weekNo).padStart(2,'0')}
app.get('/',(req,res)=>{res.send('<h1>SM Modul V9 VEGLEGES - Fut! DB: '+(useMongo?'MongoDB Atlas ✅':'file')+'</h1><a href="/admin">Admin</a>')})
app.listen(process.env.PORT||10000,()=>console.log('SM V9 VEGLEGES Fut'))
