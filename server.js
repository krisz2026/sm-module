
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
      apiKey: String, session: String, cart: Array, total: Number,
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
<div><b>SM Modul</b> <span class="badge">V7 SZÉP • MongoDB ${persistentText}</span></div>
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

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
<div class="chartBox"><h2>Boltok megoszlása</h2><canvas id="shopChart" height="200"></canvas></div>
<div class="chartBox">
<h2>Új bolt létrehozása</h2>
<input id="name" placeholder="Bolt neve" style="width:100%;margin-bottom:8px">
<input id="exp" type="number" placeholder="Lejárat nap (0=soha)" style="width:100%;margin-bottom:12px">
<button class="btnGreen" style="width:100%" onclick="createShop()">+ Létrehozás</button>
<p style="font-size:12px;color:#94a3b8;margin-top:12px">Tipp: A kulcsot másold a Shopify modulba</p>
</div>
</div>

<div class="chartBox" style="margin-top:20px">
<h2>Aktív API kulcsok</h2>
<div id="list"></div>
</div>

<script>
let chartRev=null, chartShop=null, analyticsData=null;
async function load(){
try{
let r=await fetch('/api/v1/admin/shops',{credentials:'same-origin'})
let d=await r.json()
let h='', totalRev=0, totalCart=0, active=0;
for(let k in d.shops){let s=d.shops[k]; if(s.disabled) continue;
totalRev+=s.revenue||0; totalCart+=s.cartCount||0; active++;
h+='<div class=shopItem><div><b>'+s.name+'</b><div class=key>'+k+'</div><div style="font-size:12px;color:#64748b;margin-top:4px">'+(s.revenue||0)+' Ft • '+(s.cartCount||0)+' kosár</div></div><div><button class=btnRed onclick="disableKey(\''+k+'\')">Tilt</button> <button style="background:#f1f5f9" onclick="regenKey(\''+k+'\')">Új kulcs</button></div></div>';
}
if(h==='') h='<p style="color:#94a3b8">Még nincs bolt. Hozz létre egyet fent.</p>';
document.getElementById('list').innerHTML=h;
document.getElementById('totalRev').innerText=totalRev.toLocaleString()+' Ft';
document.getElementById('totalCart').innerText=totalCart;
document.getElementById('totalShop').innerText=active;
let a=await fetch('/api/v1/admin/analytics').then(r=>r.json());
analyticsData=a
drawShopChart(a.perShop)
showChart('daily')
}
function showChart(type){
document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'))
document.getElementById('tab-'+type).classList.add('active')
let labels=[], data=[]
if(type==='daily'){labels=analyticsData.daily.map(x=>x.date); data=analyticsData.daily.map(x=>x.total)}
if(type==='weekly'){labels=analyticsData.weekly.map(x=>x.date); data=analyticsData.weekly.map(x=>x.total)}
if(type==='monthly'){labels=analyticsData.monthly.map(x=>x.date); data=analyticsData.monthly.map(x=>x.total)}
drawRevChart(labels,data,type)
}
function drawRevChart(labels,data,type){
let ctx=document.getElementById('revChart')
if(chartRev) chartRev.destroy()
chartRev=new Chart(ctx,{type:'bar',data:{labels:labels,datasets:[{data:data,backgroundColor:'#0f172a',borderRadius:8,barThickness:22}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{x:{grid:{display:false}},y:{grid:{color:'#f1f5f9'}}}}})
}
function drawShopChart(perShop){
let ctx=document.getElementById('shopChart')
if(chartShop) chartShop.destroy()
let labels=Object.values(perShop).map(s=>s.name||'Shop')
let data=Object.values(perShop).map(s=>s.revenue)
if(labels.length===0){labels=['Nincs adat']; data=[1]}
chartShop=new Chart(ctx,{type:'doughnut',data:{labels:labels,datasets:[{data:data,backgroundColor:['#0f172a','#334155','#64748b','#94a3b8','#cbd5e1','#16a34a'],borderWidth:0}]},options:{responsive:true,plugins:{legend:{position:'bottom'}}}})
}
async function createShop(){
let n=document.getElementById('name').value.trim();
if(!n){ alert('Írj be egy nevet!'); return; }
let e=document.getElementById('exp').value||0;
try{
let r=await fetch('/api/v1/admin/create-shop',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({name:n,expiresInDays:parseInt(e)})});
let txt=await r.text();
let d=null; try{ d=JSON.parse(txt); }catch{ alert('Hiba válasz: '+txt.substring(0,200)); return; }
if(!d.ok){ alert('Hiba: '+JSON.stringify(d)); return; }
alert('✅ LÉTREHOZVA! Kulcs:\n\n'+d.apiKey+'\n\nMásold ki!');
document.getElementById('name').value='';
load()
}catch(err){ alert('Hálózati hiba: '+err.message); console.error(err); }
}
async function disableKey(k){if(!confirm('Tiltod?'))return; await fetch('/api/v1/admin/disable-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:k})}); load()}
async function regenKey(k){let r=await fetch('/api/v1/admin/regenerate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:k})}); let d=await r.json(); alert('Új kulcs: '+d.newApiKey); load()}
load()
</script>
</body></html>`
res.send(html)
})

app.get('/api/v1/admin/shops',async(req,res)=>{
if(!isAuthed(req)) return res.status(401).json({ok:false});
if(useMongo && ShopModel){ let shopsArr = await ShopModel.find({}); let shops = {}; shopsArr.forEach(s=>{ shops[s._id]=s }); return res.json({ok:true,shops}); }
res.json({ok:true,shops:db.shops})
})
app.get('/api/v1/admin/analytics',async(req,res)=>{
if(!isAuthed(req) && req.headers['x-admin-pass']!==ADMIN_PASSWORD) return res.status(401).json({ok:false});
let dailyMap={}, weeklyMap={}, monthlyMap={}, perShop={}; let carts=[];
if(useMongo && CartModel){ carts = await CartModel.find({}).sort({time:-1}).limit(2000); let shopsArr = await ShopModel.find({}); shopsArr.forEach(s=>{ perShop[s._id]={name:s.name,revenue:s.revenue||0,count:s.cartCount||0, apiKey:s._id}}); }
else { carts = db.carts; for(let k in db.shops){ perShop[k]={name:db.shops[k].name, revenue:0, count:0, apiKey:k} } }
carts.forEach(c=>{ let d=new Date(c.time); let day=d.toISOString().slice(0,10); let month=d.toISOString().slice(0,7); let week=getWeek(d); dailyMap[day]=(dailyMap[day]||0)+(c.total||0); weeklyMap[week]=(weeklyMap[week]||0)+(c.total||0); monthlyMap[month]=(monthlyMap[month]||0)+(c.total||0); if(!perShop[c.apiKey]) perShop[c.apiKey]={name:c.apiKey,revenue:0,count:0,apiKey:c.apiKey}; perShop[c.apiKey].revenue+=c.total||0; perShop[c.apiKey].count+=1; })
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
function getWeek(d){let date=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())); let dayNum=date.getUTCDay()||7; date.setUTCDate(date.getUTCDate()+4-dayNum); let yearStart=new Date(Date.UTC(date.getUTCFullYear(),0,1)); let weekNo=Math.ceil(( ( (date - yearStart)/86400000)+1)/7); return date.getUTCFullYear()+'-W'+String(weekNo).padStart(2,'0')}
app.get('/',(req,res)=>{res.send('<h1>SM Modul V7 SZEP - Fut! DB: '+(useMongo?'MongoDB Atlas ✅':'file')+'</h1><a href="/admin">Admin</a>')})
app.listen(process.env.PORT||10000,()=>console.log('SM V7 SZEP Fut'))
