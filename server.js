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
let RecoModel = null;

if (MONGO_URI) {
  try {
    const mongoose = require('mongoose');
    mongoose.connect(MONGO_URI).then(() => { console.log('MongoDB Atlas OK'); useMongo = true; }).catch(e => { console.log('Mongo hiba:', e.message); });
    const shopSchema = new mongoose.Schema({
      _id: String, name: String, revenue: { type: Number, default: 0 }, cartCount: { type: Number, default: 0 },
      disabled: { type: Boolean, default: false }, expiresAt: { type: Date, default: null }, createdAt: { type: Date, default: Date.now },
      recommendedProducts: { type: Array, default: [] }, recommendationStats: { type: Object, default: { shown: 0, accepted: 0 } }
    }, { _id: false });
    const cartSchema = new mongoose.Schema({ apiKey: String, session: mongoose.Schema.Types.Mixed, cart: Array, total: Number, time: { type: Date, default: Date.now } });
    const recoSchema = new mongoose.Schema({ apiKey: String, event: String, count: {type:Number, default:1}, time: {type:Date, default:Date.now} });
    ShopModel = mongoose.model('Shop', shopSchema); CartModel = mongoose.model('Cart', cartSchema); RecoModel = mongoose.model('RecoEvent', recoSchema);
  } catch (e) { console.log('mongoose nincs'); }
}

let db = { shops: {}, carts: [], recoEvents: [] };
function load() { try { if (fs.existsSync(DB_FILE)) { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); if (!db.shops) db.shops = {}; if (!db.carts) db.carts = []; if (!db.recoEvents) db.recoEvents = []; } } catch {} }
function save() { if (useMongo) return; try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch {} }
load();
let idempotency = {};
function parseCookies(req) { let list = {}; let rc = req.headers.cookie; if (rc) rc.split(';').forEach(c => { let parts = c.split('='); list[parts.shift().trim()] = decodeURI(parts.join('=')); }); return list; }
function isAuthed(req) { let c = parseCookies(req); return c.admin_auth === ADMIN_PASSWORD; }
function requireAuth(req, res, next) { if (isAuthed(req)) return next(); res.redirect('/admin/login'); }

app.get('/admin/login',(req,res)=>{ res.send('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:sans-serif;background:#f8fafc;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:32px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.08);width:340px}input{width:100%;padding:14px;margin:10px 0;border:1px solid #e2e8f0;border-radius:10px;box-sizing:border-box}button{width:100%;padding:14px;background:#0f172a;color:white;border:0;border-radius:10px;font-weight:600;cursor:pointer}</style></head><body><div class="card"><h2>SM Admin</h2><p>Lepj be</p><form method="POST" action="/api/v1/admin/login"><input type="password" name="password" placeholder="admin123"><button type="submit">Belepes</button></form></div></body></html>') })
app.all('/api/v1/admin/login',(req,res)=>{ let pass=req.body.password||req.body.pass||req.query.password; if(pass===ADMIN_PASSWORD){ res.setHeader('Set-Cookie','admin_auth='+ADMIN_PASSWORD+'; Path=/; HttpOnly; SameSite=Lax'); return res.redirect('/admin') } res.send('<h1>Hibas jelszo!</h1><a href="/admin/login">Vissza</a>') })
app.get('/admin/logout',(req,res)=>{ res.setHeader('Set-Cookie','admin_auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'); res.redirect('/admin/login') })

app.get('/api/v1/admin/acceptance-rate', async(req,res)=>{ if(!isAuthed(req)) return res.status(401).json({ok:false}); let stats = []; if(useMongo && ShopModel){ let shops = await ShopModel.find({}).lean(); for(let s of shops){ let shown = s.recommendationStats?.shown || 0; let accepted = s.recommendationStats?.accepted || 0; let rate = shown>0 ? (accepted/shown*100).toFixed(2) : 0; stats.push({apiKey:s._id, name:s.name, shown, accepted, rate: parseFloat(rate)}); } } else { for(let k in db.shops){ let st = db.shops[k].recommendationStats || {shown:0, accepted:0}; let rate = st.shown>0 ? (st.accepted/st.shown*100).toFixed(2) : 0; stats.push({apiKey:k, name:db.shops[k].name, shown:st.shown, accepted:st.accepted, rate:parseFloat(rate)}); } } res.json({ok:true, stats}); })
app.get('/api/v1/recommended-products', async(req,res)=>{ let apiKey = req.query.apiKey || req.headers['x-api-key']; if(!apiKey) return res.status(400).json({ok:false, msg:'apiKey hianyzik'}); let shop=null; if(useMongo && ShopModel){ shop=await ShopModel.findById(apiKey).lean(); } else { shop=db.shops[apiKey]; if(shop) shop._id=apiKey; } if(!shop) return res.status(404).json({ok:false}); res.json({ok:true, products: shop.recommendedProducts || [], shop: shop.name}); })
app.post('/api/v1/admin/set-recommended', async(req,res)=>{ if(!isAuthed(req)) return res.status(401).json({ok:false}); let {apiKey, products} = req.body; if(!apiKey || !Array.isArray(products)) return res.status(400).json({ok:false, msg:'apiKey + products[] kell'}); if(useMongo && ShopModel){ await ShopModel.updateOne({_id:apiKey}, {recommendedProducts: products}); } else { if(db.shops[apiKey]){ db.shops[apiKey].recommendedProducts=products; save(); } } res.json({ok:true, count: products.length}); })
app.post('/api/v1/recommendation-event', async(req,res)=>{ let apiKey = req.headers['x-api-key'] || req.body.apiKey; let event = req.body.event; let count = parseInt(req.body.count||1); if(!apiKey || !['shown','accepted'].includes(event)) return res.status(400).json({ok:false}); if(useMongo && ShopModel && RecoModel){ let shop = await ShopModel.findById(apiKey); if(!shop) return res.status(404).json({ok:false}); if(!shop.recommendationStats) shop.recommendationStats={shown:0, accepted:0}; shop.recommendationStats[event]=(shop.recommendationStats[event]||0)+count; await shop.save(); await RecoModel.create({apiKey, event, count, time:new Date()}); } else { if(db.shops[apiKey]){ if(!db.shops[apiKey].recommendationStats) db.shops[apiKey].recommendationStats={shown:0, accepted:0}; db.shops[apiKey].recommendationStats[event]+=count; db.recoEvents.push({apiKey, event, count, time:new Date()}); save(); } } res.json({ok:true, event, count}); })

app.get('/admin',requireAuth,async(req,res)=>{
let shops=[]; if(useMongo && ShopModel){ shops = await ShopModel.find({}).lean(); } else { shops = Object.keys(db.shops).map(k=>({...db.shops[k], _id:k, apiKey:k})); }
let totalRev=0, totalCart=0; shops.forEach(s=>{ totalRev+=s.revenue||0; totalCart+=s.cartCount||0; });
let html=`
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
body{font-family:sans-serif;padding:12px;background:#f8fafc;margin:0}
.card{background:white;padding:16px;border-radius:12px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.key{font-family:monospace;background:#f1f5f9;padding:4px 8px;border-radius:6px;font-size:11px;word-break:break-all}
input,textarea{width:100%;padding:10px;margin:6px 0;border:1px solid #e2e8f0;border-radius:8px;box-sizing:border-box}
button{padding:10px 16px;background:#0f172a;color:white;border:0;border-radius:8px;cursor:pointer;margin-right:6px;margin-top:4px}
.stat{background:#eff6ff;padding:10px;border-radius:10px;margin:6px 0;font-size:14px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:700px){.grid{grid-template-columns:1fr}}
canvas{max-width:100%}
.kpi{display:flex;gap:10px;flex-wrap:wrap}
.kpi .card{flex:1;min-width:120px;text-align:center}
.kpi b{font-size:22px;display:block}
</style></head><body>
<h1 style="margin:6px 0">SM Admin V9 - Dashboard ✅</h1>
<p style="font-size:13px"><a href="/admin/logout">Kilepes</a> | <a href="/">Fooldal</a> | <a href="/api/v1/debug/shops">JSON</a> | <a href="/api/v1/admin/acceptance-rate">Elfogadas JSON</a></p>

<div class="kpi">
  <div class="card"><b>${totalRev} Ft</b> Ossz bevetel</div>
  <div class="card"><b>${totalCart}</b> Kosar</div>
  <div class="card"><b>${shops.length}</b> Bolt</div>
  <div class="card">DB: ${useMongo?'MongoDB Atlas ✅':'file'}</div>
</div>

<div class="grid">
  <div class="card"><h3 style="margin:0 0 8px">📈 Napi bevetel (utolso 14 nap)</h3><canvas id="dailyChart" height="160"></canvas></div>
  <div class="card"><h3 style="margin:0 0 8px">📅 Heti bevetel</h3><canvas id="weeklyChart" height="160"></canvas></div>
  <div class="card"><h3 style="margin:0 0 8px">🗓️ Havi bevetel</h3><canvas id="monthlyChart" height="160"></canvas></div>
  <div class="card"><h3 style="margin:0 0 8px">🏪 Boltok szerint</h3><canvas id="shopChart" height="160"></canvas></div>
</div>

<div class="card"><h3>📊 Elfogadasi arany</h3><div id="acceptStats">Betoltes...</div><button onclick="loadAccept()">Frissit</button></div>

<div class="card"><h3>Uj bolt</h3><form onsubmit="createShop(event)"><input id="shopName" placeholder="Bolt nev" required><button type="submit">Letrehoz</button></form><div id="res"></div></div>

<h2>Boltok listaja</h2>
`;
shops.forEach(s=>{
 let shown = s.recommendationStats?.shown||0; let accepted = s.recommendationStats?.accepted||0; let rate = shown>0 ? (accepted/shown*100).toFixed(1) : 0;
 html+=`<div class="card"><b>${s.name||'Nev nelkul'}</b> ${s.disabled?'⛔ Tiltva':'● Aktiv'}<br><div class="key">${s._id||s.apiKey}</div><div>Bevetel: ${s.revenue||0} Ft | Kosar: ${s.cartCount||0}</div><div class="stat">Ajanlas: Megjelenitve: ${shown} | Elfogadva: ${accepted} | Arany: ${rate}%</div><div><b>Ajanlott termekek (JSON):</b><br><textarea id="reco-${s._id||s.apiKey}" rows="3" placeholder='[{"id":123,"name":"Polo"}]'>${JSON.stringify(s.recommendedProducts||[], null, 2)}</textarea><br><button onclick="saveReco('${s._id||s.apiKey}')">Mentes</button></div></div>`;
});
html+=`
<script>
async function createShop(e){e.preventDefault();let name=document.getElementById("shopName").value;let r=await fetch("/api/v1/admin/create-shop",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});let d=await r.json();document.getElementById("res").innerText="OK! Kulcs: "+d.apiKey; location.reload();}
async function loadAccept(){ let r=await fetch('/api/v1/admin/acceptance-rate'); let j=await r.json(); let html=''; j.stats.forEach(s=>{ html+='<div>'+s.name+': '+s.accepted+'/'+s.shown+' = <b>'+s.rate+'%</b></div>'; }); if(j.stats.length===0) html='Nincs adat meg'; document.getElementById('acceptStats').innerHTML=html; }
async function saveReco(apiKey){ let txt=document.getElementById('reco-'+apiKey).value; try{ let products=JSON.parse(txt); let r=await fetch('/api/v1/admin/set-recommended',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey, products})}); let j=await r.json(); alert('Mentve! '+j.count+' termek'); } catch(e){ alert('Hibas JSON! '+e.message); } }

async function loadCharts(){
 try{
  let r=await fetch('/api/v1/admin/stats'); let j=await r.json();
  // napi
  new Chart(document.getElementById('dailyChart'), {type:'line', data:{labels:j.daily.map(d=>d.date), datasets:[{label:'Ft', data:j.daily.map(d=>d.total), borderColor:'#0f172a', backgroundColor:'rgba(15,23,42,0.08)', tension:0.3, fill:true}]}, options:{responsive:true, plugins:{legend:{display:false}}}});
  new Chart(document.getElementById('weeklyChart'), {type:'bar', data:{labels:j.weekly.map(d=>d.date), datasets:[{label:'Ft', data:j.weekly.map(d=>d.total), backgroundColor:'#3b82f6'}]}, options:{responsive:true, plugins:{legend:{display:false}}}});
  new Chart(document.getElementById('monthlyChart'), {type:'bar', data:{labels:j.monthly.map(d=>d.date), datasets:[{label:'Ft', data:j.monthly.map(d=>d.total), backgroundColor:'#10b981'}]}, options:{responsive:true, plugins:{legend:{display:false}}}});
  let shopLabels=Object.values(j.perShop).map(s=>s.name||s.apiKey.slice(0,8)); let shopData=Object.values(j.perShop).map(s=>s.revenue);
  new Chart(document.getElementById('shopChart'), {type:'doughnut', data:{labels:shopLabels, datasets:[{data:shopData, backgroundColor:['#0f172a','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6']}]}, options:{responsive:true}});
 } catch(e){ console.log('chart hiba', e); }
}
loadAccept(); loadCharts();
</script>
</body></html>
`;
res.send(html);
})

app.get('/api/v1/admin/stats',async(req,res)=>{
if(!isAuthed(req)) return res.status(401).json({ok:false});
let shopsMap={}; let carts=[]; let dailyMap={}; let weeklyMap={}; let monthlyMap={}; let perShop={};
if(useMongo && ShopModel){
let sArr=await ShopModel.find({}); sArr.forEach(s=>{ shopsMap[s._id]=s; perShop[s._id]={name:s.name, revenue:s.revenue||0, count:s.cartCount||0, apiKey:s._id, disabled:s.disabled, expiresAt:s.expiresAt}; });
let cArr=await CartModel.find({}).sort({time:-1}).limit(2000); carts=cArr;
} else { shopsMap=db.shops; carts=db.carts; for(let k in db.shops){ perShop[k]={name:db.shops[k].name, revenue:db.shops[k].revenue||0, count:db.shops[k].cartCount||0, apiKey:k} } }
carts.forEach(c=>{ let t=new Date(c.time||c.createdAt); if(!t||isNaN(t)) t=new Date(); let day=t.toISOString().slice(0,10); let month=t.toISOString().slice(0,7); let week=getWeek(t); dailyMap[day]=(dailyMap[day]||0)+(c.total||0); weeklyMap[week]=(weeklyMap[week]||0)+(c.total||0); monthlyMap[month]=(monthlyMap[month]||0)+(c.total||0); let k=c.apiKey||c.shopId; if(!perShop[k]) perShop[k]={name:k,revenue:0,count:0,apiKey:k}; perShop[k].revenue+=c.total||0; perShop[k].count+=1; })
let daily=Object.keys(dailyMap).sort().slice(-14).map(k=>({date:k,total:dailyMap[k]}))
let weekly=Object.keys(weeklyMap).sort().slice(-12).map(k=>({date:k,total:weeklyMap[k]}))
let monthly=Object.keys(monthlyMap).sort().slice(-12).map(k=>({date:k,total:monthlyMap[k]}))
if(daily.length===0) daily=[{date:new Date().toISOString().slice(0,10),total:0}]
if(weekly.length===0) weekly=[{date:getWeek(new Date()), total:0}]
if(monthly.length===0) monthly=[{date:new Date().toISOString().slice(0,7), total:0}]
res.json({daily,weekly,monthly,perShop})
})
app.post('/api/v1/admin/create-shop',async(req,res)=>{ if(!isAuthed(req)) return res.status(401).json({ok:false}); let name=req.body.name||'Shop'; let expiresInDays=parseInt(req.body.expiresInDays||0); let key='sm_live_'+crypto.randomBytes(16).toString('hex'); let expiresAt=null; if(expiresInDays>0){expiresAt=new Date(); expiresAt.setDate(expiresAt.getDate()+expiresInDays)} if(useMongo && ShopModel){ await ShopModel.create({_id:key,name,revenue:0,cartCount:0,expiresAt,createdAt:new Date(),recommendedProducts:[], recommendationStats:{shown:0, accepted:0}}) } else { db.shops[key]={name, revenue:0, cartCount:0, expiresAt, createdAt:new Date(), recommendedProducts:[], recommendationStats:{shown:0, accepted:0}}; save() } res.json({ok:true,apiKey:key,shop:name,expiresAt}) })
app.post('/api/v1/admin/disable-key',async(req,res)=>{ if(!isAuthed(req)) return res.status(401).json({ok:false}); let key=req.body.apiKey; if(useMongo && ShopModel){ await ShopModel.updateOne({_id:key},{disabled:true}); return res.json({ok:true}); } if(db.shops[key]){db.shops[key].disabled=true; save(); res.json({ok:true})} else res.status(404).json({ok:false}) })
app.post('/api/v1/admin/regenerate',async(req,res)=>{ if(!isAuthed(req)) return res.status(401).json({ok:false}); let oldKey=req.body.apiKey; let oldData=null; if(useMongo && ShopModel){ oldData=await ShopModel.findById(oldKey); if(!oldData) return res.status(404).json({ok:false}); } else oldData=db.shops[oldKey]; if(!oldData) return res.status(404).json({ok:false}); let newKey='sm_live_'+crypto.randomBytes(16).toString('hex'); if(useMongo && ShopModel){ await ShopModel.create({_id:newKey,name:oldData.name,revenue:oldData.revenue,cartCount:oldData.cartCount,createdAt:new Date(),expiresAt:oldData.expiresAt,recommendedProducts:oldData.recommendedProducts||[], recommendationStats:oldData.recommendationStats||{shown:0,accepted:0}}); await ShopModel.updateOne({_id:oldKey},{disabled:true}); } else { db.shops[newKey]={...oldData,createdAt:new Date()}; db.shops[oldKey].disabled=true; save(); } res.json({ok:true,newApiKey:newKey}) })
app.post('/api/v1/cart',async(req,res)=>{ let apiKey=req.headers['x-api-key']; let shop=null; if(useMongo && ShopModel){ shop=await ShopModel.findById(apiKey); if(!shop) return res.status(401).json({ok:false,msg:'bad key'}); } else { if(!apiKey||!db.shops[apiKey]) return res.status(401).json({ok:false}); shop=db.shops[apiKey]; } if(shop.disabled) return res.status(403).json({ok:false,msg:'disabled'}); if(shop.expiresAt && new Date(shop.expiresAt)<new Date()) return res.status(403).json({ok:false,msg:'expired'}); let idemKey=req.headers['x-idempotency-key']; if(idemKey&&idempotency[idemKey]) return res.json(idempotency[idemKey]); let cart=req.body.cart||[]; let session=req.body.session||'unknown'; let total=0; cart.forEach(i=>{total+= (i.price||0)*(i.qty||1)}); if(useMongo && CartModel){ shop.revenue+=total; shop.cartCount+=1; await shop.save(); await CartModel.create({apiKey,session,cart,total,time:new Date()}); } else { shop.revenue+=total; shop.cartCount+=1; db.carts.push({apiKey,session,cart,total,time:new Date()}); if(db.carts.length>2000) db.carts=db.carts.slice(-2000); save() } let valasz={ok:true,received:cart.length,total}; if(idemKey) idempotency[idemKey]=valasz; res.json(valasz) })
app.get('/api/v1/debug/add-cart', async(req,res)=>{ try{ let key=req.query.key||req.query.apiKey; if(!key) return res.status(400).send('Hianyzik ?key= parameter'); let shop=null; if(useMongo && ShopModel){ shop=await ShopModel.findById(key); if(!shop){ shop = await ShopModel.create({_id:key, name:'ElsoBoltom', revenue:0, cartCount:0, createdAt:new Date(), recommendedProducts:[], recommendationStats:{shown:0,accepted:0}}); } } else { shop=db.shops[key]; if(shop) shop._id=key; } if(!shop) return res.status(404).send('Nincs ilyen bolt: '+key); let price=5990; if(useMongo && ShopModel){ shop.revenue=(shop.revenue||0)+price; shop.cartCount=(shop.cartCount||0)+1; await shop.save(); await CartModel.create({apiKey:key, session:{test:true, name:'debug'}, cart:[{name:'Teszt Termek', price, qty:1}], total:price, time:new Date()}); } else { shop.revenue=(shop.revenue||0)+price; shop.cartCount=(shop.cartCount||0)+1; db.carts.push({apiKey:key, session:{test:true}, cart:[{name:'Teszt Termek', price, qty:1}], total:price, time:new Date()}); save(); } res.send('<h1>SIKER!</h1><p>Bolt: '+(shop.name||key)+'</p><p>+'+price+' Ft hozzaadva!</p><p>CartCount: '+shop.cartCount+'</p><p>Revenue: '+shop.revenue+'</p><a href="/admin">Menj az Adminba -></a>'); }catch(e){ res.status(500).send('HIBA: '+e.message); } });
app.get('/api/v1/debug/create', async(req,res)=>{ try{ let name=req.query.name||'Teszt Bolt'; let key='sm_live_'+crypto.randomBytes(16).toString('hex'); if(useMongo && ShopModel){ await ShopModel.create({_id:key,name,revenue:0,cartCount:0,createdAt:new Date(),expiresAt:null,recommendedProducts:[], recommendationStats:{shown:0,accepted:0}}); return res.json({ok:true, apiKey:key, msg:'MongoDB-ben letrehozva!', mongo: true}); } else { db.shops[key]={name,revenue:0,cartCount:0,createdAt:new Date(),expiresAt:null,recommendedProducts:[], recommendationStats:{shown:0,accepted:0}}; save(); return res.json({ok:true, apiKey:key, msg:'File DB-ben letrehozva', mongo:false}); } }catch(e){ res.status(500).json({ok:false, error:e.message, stack:e.stack}); } });
app.get('/api/v1/debug/shops', async(req,res)=>{ if(useMongo && ShopModel){ let arr=await ShopModel.find({}); res.json({mongo:true, count:arr.length, shops:arr}); } else { res.json({mongo:false, shops:db.shops}); } });
function getWeek(d){let date=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())); let dayNum=date.getUTCDay()||7; date.setUTCDate(date.getUTCDate()+4-dayNum); let yearStart=new Date(Date.UTC(date.getUTCFullYear(),0,1)); let weekNo=Math.ceil(( ( (date - yearStart)/86400000)+1)/7); return date.getUTCFullYear()+'-W'+String(weekNo).padStart(2,'0')}
app.get('/',(req,res)=>{res.send('<h1>SM Modul V9 VEGLEGES - Fut! DB: '+(useMongo?'MongoDB Atlas ✅':'file')+'</h1><a href="/admin">Admin</a>')})
app.listen(process.env.PORT||10000,()=>console.log('SM V9 DASHBOARD + GRAFIKONOK Fut'))
