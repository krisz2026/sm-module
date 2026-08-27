const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:true}));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ='admin123';
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
res.send(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font-family:Inter,sans-serif;background:#f8fafc;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
.card{background:white;padding:32px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.08);width:340px}
input{width:100%;padding:14px;margin:10px 0;border:1px solid #e2e8f0;border-radius:10px;box-sizing:border-box}
button{width:100%;padding:14px;background:#0f172a;color:white;border:0;border-radius:10px;font-weight:600;cursor:pointer}
</style></head><body>
<div class="card">
<h2 style="margin:0 0 8px">SM Admin</h2>
<p style="color:#64748b;font-size:14px">Lépj be a dashboardba</p>
<form method="POST" action="/api/v1/admin/login">
<input type="password" name="password" placeholder="Jelszó (admin123)">
<button type="submit">Belépés</button>
</form>
</div>
</body></html>`) })

app.all('/api/v1/admin/login',(req,res)=>{
let pass=req.body.password||req.body.pass||req.query.password;
if(pass===ADMIN_PASSWORD){
res.setHeader('Set-Cookie',`admin_auth=${ADMIN_PASSWORD}; Path=/; HttpOnly; SameSite=Lax`);
return res.redirect('/admin')
}
res.send('<h1>Hibás jelszó!</h1><a href="/admin/login">Vissza</a>')
})
app.get('/admin/logout',(req,res)=>{
res.setHeader('Set-Cookie','admin_auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
res.redirect('/admin/login')
})

app.get('/admin',requireAuth,(req,res)=>{
let persistentText = useMongo ? 'IGEN ✅' : 'NEM ❌';
let html=`<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
*{box-sizing:border-box}
body{font-family:Inter,Segoe UI,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:20px}
.topbar{background:white;padding:16px 20px;border-radius:12px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 1px 3px rgba(0,0,0,.06);margin-bottom:20px}
.badge{background:#dcfce7;color:#166534;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:20px}
.statCard{background:white;padding:20px;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.statLabel{color:#64748b;font-size:13px;margin-bottom:6px}
.statValue{font-size:28px;font-weight:700;color:#0f172a}
.chartBox{background:white;padding:20px;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.06);margin-bottom:20px}
.tabs{display:flex;gap:8px;margin-bottom:16px}
.tab{padding:8px 16px;border-radius:20px;border:1px solid #e2e8f0;background:white;color:#64748b;cursor:pointer;font-size:14px}
.tab.active{background:#0f172a;color:white;border-color:#0f172a}
input{padding:10px 14px;border:1px solid #e2e8f0;border-radius:10px}
button{padding:10px 16px;border-radius:10px;border:0;cursor:pointer;font-weight:600}
.btnGreen{background:#16a34a;color:white}
.btnRed{background:#fee2e2;color:#991b1b}
.shopItem{background:white;padding:14px 16px;border-radius:12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.key{font-family:monospace;background:#f1f5f9;color:#334155;padding:4px 8px;border-radius:6px;font-size:11px;word-break:break-all}
h2{font-size:18px;margin:0 0 12px}
</style>
</head><body>
<div class="topbar">
<div><b>SM Modul</b> <span class="badge">V9 VÉGLEGES • MongoDB ${persistentText}</span></div>
<a href="/admin/logout"><button class="btnRed">Kilépés</button></a>
</div>

<div class="grid">
<div class="statCard"><div class="statLabel">Össz bevétel</div><div class="statValue" id="totalRev">0 Ft</div></div>
<div class="statCard"><div class="statLabel">Össz kosár</div><div class="statValue" id="totalCart">0</div></div>
<div class="statCard"><div class="statLabel">Aktív boltok</div><div class="statValue" id="totalShop">0</div></div>
</div>

<div class="chartBox">
<h2>Bevétel alakulása</h2>
<div class="tabs">
<button class="tab active" id="tab-daily" onclick="showChart('daily')">Napi</button>
<button class="tab" id="tab-weekly" onclick="showChart('weekly')">Heti</button>
<button class="tab" id="tab-monthly" onclick="showChart('monthly')">Havi</button>
</div>
<canvas id="revChart" height="120"></canvas>
</div>

<div class="chartBox">
<h2>Új bolt létrehozása</h2>
<div style="display:flex;gap:8px;flex-wrap:wrap">
<input id="shopName" placeholder="Bolt név">
<input id="expiresIn" type="number" placeholder="Lejárat nap (0=soha)" style="width:160px">
<button class="btnGreen" onclick="createShop()">+ Létrehozás</button>
</div>
<div id="createResult" style="margin-top:12px"></div>
</div>

<div class="chartBox">
<h2>API Kulcsok</h2>
<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
<input id="search" placeholder="Keresés név / kulcs..." oninput="filterShops()" style="flex:1;min-width:200px">
</div>
<div id="shopList"></div>
</div>

<script>
let allShops=[]; let chartInst=null; let chartData=null;
async function loadStats(){
let r=await fetch('/api/v1/admin/stats'); let d=await r.json(); chartData=d;
document.getElementById('totalRev').innerText=(Object.values(d.perShop).reduce((a,b)=>a+b.revenue,0)).toLocaleString('hu-HU')+' Ft');
document.getElementById('totalCart').innerText=Object.values(d.perShop).reduce((a,b)=>a+b.count,0);
document.getElementById('totalShop').innerText=Object.keys(d.perShop).length;
showChart('daily'); renderShops(d.perShop);
}
function showChart(type){
if(!chartData) return;
document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
document.getElementById('tab-'+type).classList.add('active');
let data=chartData[type]||[];
let labels=data.map(x=>x.date); let values=data.map(x=>x.total);
if(chartInst) chartInst.destroy();
let ctx=document.getElementById('revChart').getContext('2d');
chartInst=new Chart(ctx,{type:'line',data:{labels,datasets:[{label:'Bevétel Ft',data:values,borderColor:'#16a34a',backgroundColor:'rgba(22,163,74,0.1)',tension:0.3,fill:true}]},options:{responsive:true,plugins:{legend:{display:false}}}});
}
function renderShops(perShop){
allShops=Object.values(perShop);
let html=''; allShops.forEach(s=>{
let status=s.disabled?'<span style="color:#dc2626;font-size:12px">⛔ Letiltva</span>':'<span style="color:#16a34a;font-size:12px">● Aktív</span>';
let exp=s.expiresAt? new Date(s.expiresAt).toLocaleDateString('hu-HU') : 'Soha';
html+=`<div class="shopItem" data-search="${s.name} ${s.apiKey}">
<div style="flex:1;min-width:0"><div style="font-weight:600">${s.name} ${status}</div><div class="key" style="margin-top:6px">${s.apiKey}</div><div style="font-size:12px;color:#64748b;margin-top:4px">${s.revenue||0} Ft • ${s.count||0} kosár • Lejárat: ${exp}</div></div>
<div style="display:flex;gap:6px;flex-direction:column"><button class="btnGreen" style="font-size:12px;padding:6px 10px" onclick="copyKey('${s.apiKey}')">Másol</button><button style="font-size:12px;padding:6px 10px;background:#f1f5f9" onclick="regenerate('${s.apiKey}')">Újragenerál</button><button class="btnRed" style="font-size:12px;padding:6px 10px" onclick="disableKey('${s.apiKey}')">Tilt</button></div>
</div>`;
});
document.getElementById('shopList').innerHTML=html||'<p style="color:#94a3b8">Nincs bolt még</p>';
}
function filterShops(){let q=document.getElementById('search').value.toLowerCase(); document.querySelectorAll('.shopItem').forEach(el=>{el.style.display=el.dataset.search.toLowerCase().includes(q)?'flex':'none'})}
async function createShop(){let name=document.getElementById('shopName').value; let expiresInDays=document.getElementById('expiresIn').value||0; let r=await fetch('/api/v1/admin/create-shop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,expiresInDays})}); let d=await r.json(); if(d.ok){document.getElementById('createResult').innerHTML='<div class="key">OK! Kulcs: '+d.apiKey+'</div>'; loadStats();} else alert('Hiba');}
async function disableKey(k){if(!confirm('Biztos letiltod?')) return; await fetch('/api/v1/admin/disable-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:k})}); loadStats();}
async function regenerate(k){if(!confirm('Új kulcs generálása? Régi letiltva lesz.')) return; let r=await fetch('/api/v1/admin/regenerate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:k})}); let d=await r.json(); if(d.ok){alert('Új kulcs: '+d.newApiKey); loadStats();}}
function copyKey(k){navigator.clipboard.writeText(k); alert('Másolva: '+k)}
loadStats();
</script>
</body></html>`;
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
if(!key) return res.status(400).send('Hiányzik ?key= paraméter');
let shop=null;
if(useMongo && ShopModel){ 
  shop=await ShopModel.findById(key);
  if(!shop){
    // Auto create if not exists (for ElsoBoltom)
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
await CartModel.create({apiKey:key, session:{test:true, name:'debug'}, cart:[{name:'Teszt Termék', price, qty:1}], total:price, time:new Date()});
} else {
shop.revenue=(shop.revenue||0)+price;
shop.cartCount=(shop.cartCount||0)+1;
db.carts.push({apiKey:key, session:{test:true}, cart:[{name:'Teszt Termék', price, qty:1}], total:price, time:new Date()});
save();
}
res.send(`<h1>✅ SIKER!</h1><p>Bolt: ${shop.name||key}</p><p>+${price} Ft hozzáadva!</p><p>CartCount: ${shop.cartCount}</p><p>Revenue: ${shop.revenue}</p><a href="/admin">Menj az Adminba -></a>`);
}catch(e){ res.status(500).send('HIBA: '+e.message); }
});

app.get('/api/v1/debug/create', async(req,res)=>{
try{
let name=req.query.name||'Teszt Bolt';
let key='sm_live_'+crypto.randomBytes(16).toString('hex');
if(useMongo && ShopModel){
await ShopModel.create({_id:key,name,revenue:0,cartCount:0,createdAt:new Date(),expiresAt:null});
return res.json({ok:true, apiKey:key, msg:'MongoDB-ben létrehozva!', mongo: true});
} else {
db.shops[key]={name,revenue:0,cartCount:0,createdAt:new Date(),expiresAt:null};
save();
return res.json({ok:true, apiKey:key, msg:'File DB-ben létrehozva', mongo:false});
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
