
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
      console.log('MongoDB Atlas csatlakozva! PERSISTENT IGEN');
      useMongo = true;
    }).catch(e => {
      console.log('Mongo hiba, fallback file:', e.message);
    });
    const shopSchema = new mongoose.Schema({
      _id: String,
      name: String,
      revenue: { type: Number, default: 0 },
      cartCount: { type: Number, default: 0 },
      disabled: { type: Boolean, default: false },
      expiresAt: { type: Date, default: null },
      createdAt: { type: Date, default: Date.now }
    }, { _id: false });
    const cartSchema = new mongoose.Schema({
      apiKey: String,
      session: String,
      cart: Array,
      total: Number,
      time: { type: Date, default: Date.now }
    });
    ShopModel = mongoose.model('Shop', shopSchema);
    CartModel = mongoose.model('Cart', cartSchema);
  } catch (e) {
    console.log('mongoose nincs telepítve, file mód');
  }
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
function save() {
  if (useMongo) return;
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch {}
}
load();

let idempotency = {};

function parseCookies(req) {
  let list = {};
  let rc = req.headers.cookie;
  if (rc) rc.split(';').forEach(c => {
    let parts = c.split('=');
    list[parts.shift().trim()] = decodeURI(parts.join('='));
  });
  return list;
}
function isAuthed(req) {
  let c = parseCookies(req);
  return c.admin_auth === ADMIN_PASSWORD;
}
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.redirect('/admin/login');
}

app.get('/admin/login',(req,res)=>{
res.send(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font-family:sans-serif;background:#f5f5f5;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
.card{background:white;padding:30px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.1);width:320px}
input{width:100%;padding:14px;margin:10px 0;border:1px solid #ddd;border-radius:8px;box-sizing:border-box}
button{width:100%;padding:14px;background:#111;color:white;border:0;border-radius:8px;font-weight:bold;cursor:pointer}
h2{margin:0 0 10px 0}
p{color:#666;font-size:13px}
</style></head><body>
<div class="card">
<h2>🔒 SM Admin Belépés</h2>
<p>Add meg a jelszót a dashboardhoz</p>
<form method="POST" action="/api/v1/admin/login">
<input type="password" name="password" placeholder="Jelszó">
<button type="submit">Belépés</button>
</form>
<p style="margin-top:15px">Alap jelszó: <b>admin123</b></p>
</div>
</body></html>`)
})

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
let persistentText = useMongo ? 'IGEN ✅ MongoDB Atlas' : 'NEM ❌';
let dbInfo = useMongo ? 'MongoDB Atlas' : DB_FILE;
let html=`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font-family:sans-serif;padding:20px;background:#000;color:#fff;margin:0}
.key{font-family:monospace;background:#111;color:#0f0;padding:6px;border-radius:4px;word-break:break-all;font-size:12px;display:block;margin:6px 0}
button{padding:8px 12px;margin:4px;border:0;border-radius:6px;cursor:pointer;font-weight:bold}
.danger{background:#e11;color:white}.ok{background:#0a7d00;color:white}
h1,h2,h3{font-weight:300;letter-spacing:1px}
.tab{padding:8px 12px;background:#222;color:#888;border:0;border-radius:20px;margin-right:6px;cursor:pointer}
.tab.active{background:#fff;color:#000}
hr{border:0;border-top:1px solid #222;margin:20px 0}
input{padding:10px;border:1px solid #333;background:#111;color:#fff;border-radius:6px;margin:4px}
</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head><body>
<div style="display:flex;justify-content:space-between;align-items:center"><h1>SM Admin - V6 NOBOX GRAFIKON</h1><a href="/admin/logout"><button class="danger">Kilépés</button></a></div>
<p>DB: ${dbInfo} | Persistent: ${persistentText}</p>
<hr>
<h3>Uj bolt + kulcs</h3>
<input id="name" placeholder="Bolt neve" style="width:50%">
<input id="exp" type="number" placeholder="Lejarat nap" style="width:25%">
<button class="ok" onclick="createShop()">Letrehozas</button>
<hr>
<h3>Osszesites - DOBOZ NELKUL</h3>
<p>Ossz bevetel: <b id="totalRev" style="color:#fff;font-size:22px">0 Ft</b> | Ossz kosar: <b id="totalCart" style="color:#fff">0</b> | Aktiv kulcs: <b id="totalShop" style="color:#fff">0</b></p>
<hr>
<div><span class="tab active" id="tab-daily" onclick="showChart('daily')">Napi bevetel</span>
<span class="tab" id="tab-weekly" onclick="showChart('weekly')">Heti bevetel</span>
<span class="tab" id="tab-monthly" onclick="showChart('monthly')">Havi bevetel</span></div>
<canvas id="revChart" height="200"></canvas>
<hr>
<h3>Boltok szerinti bevetel</h3>
<canvas id="shopChart" height="200"></canvas>
<hr>
<h3>Aktiv kulcsok - DOBOZ NELKUL</h3>
<div id="list"></div>
<script>
let chartRev=null, chartShop=null, analyticsData=null;
async function load(){
let r=await fetch('/api/v1/admin/shops')
let d=await r.json()
let h='', totalRev=0, totalCart=0, active=0;
for(let k in d.shops){let s=d.shops[k]; if(s.disabled) continue;
totalRev+=s.revenue||0; totalCart+=s.cartCount||0; active++;
h+='<div style="padding:10px 0;border-bottom:1px solid #222"><b style="color:#fff">'+s.name+'</b><br><span class=key>'+k+'</span>Bevétel: '+(s.revenue||0)+' Ft | Kosár: '+(s.cartCount||0)+' <button onclick="disableKey(\''+k+'\')" class="danger">Tiltás</button> <button onclick="regenKey(\''+k+'\')">Újragenerálás</button></div>';
}
document.getElementById('list').innerHTML=h;
document.getElementById('totalRev').innerText=totalRev+' Ft';
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
chartRev=new Chart(ctx,{type:'bar',data:{labels:labels,datasets:[{label:'Bevétel ('+type+')',data:data,backgroundColor:'#fff',borderColor:'#fff',borderWidth:1}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{x:{grid:{color:'#222'},ticks:{color:'#888'}},y:{grid:{color:'#222'},ticks:{color:'#888'}}}}})
}
function drawShopChart(perShop){
let ctx=document.getElementById('shopChart')
if(chartShop) chartShop.destroy()
let labels=Object.values(perShop).map(s=>s.name||s.apiKey||'Shop')
let data=Object.values(perShop).map(s=>s.revenue)
if(labels.length===0){labels=['Nincs adat']; data=[1]}
chartShop=new Chart(ctx,{type:'doughnut',data:{labels:labels,datasets:[{data:data,backgroundColor:['#fff','#888','#444','#222','#e11','#0a7d00']}]},options:{responsive:true,plugins:{legend:{labels:{color:'#888'}}}}})
}
async function createShop(){let n=document.getElementById('name').value||'Shop'; let e=document.getElementById('exp').value||0;
let r=await fetch('/api/v1/admin/create-shop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,expiresInDays:parseInt(e)})});
let d=await r.json(); alert('Kulcs: '+d.apiKey); load()}
async function disableKey(k){await fetch('/api/v1/admin/disable-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:k})}); load()}
async function regenKey(k){let r=await fetch('/api/v1/admin/regenerate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:k})}); let d=await r.json(); alert('Új kulcs: '+d.newApiKey); load()}
load()
</script>
</body></html>`
res.send(html)
})


app.get('/api/v1/admin/shops',async(req,res)=>{
if(!isAuthed(req)) return res.status(401).json({ok:false});
if(useMongo && ShopModel){
 let shopsArr = await ShopModel.find({});
 let shops = {}; shopsArr.forEach(s=>{ shops[s._id]=s });
 return res.json({ok:true,shops});
}
res.json({ok:true,shops:db.shops})
})
app.get('/api/v1/admin/analytics',async(req,res)=>{
if(!isAuthed(req) && req.headers['x-admin-pass']!==ADMIN_PASSWORD) return res.status(401).json({ok:false});
let dailyMap={}, weeklyMap={}, monthlyMap={}, perShop={};
let carts=[];
if(useMongo && CartModel){
 carts = await CartModel.find({}).sort({time:-1}).limit(2000);
 let shopsArr = await ShopModel.find({});
 shopsArr.forEach(s=>{ perShop[s._id]={name:s.name,revenue:s.revenue||0,count:s.cartCount||0, apiKey:s._id}});
} else {
 carts = db.carts;
 for(let k in db.shops){ perShop[k]={name:db.shops[k].name, revenue:0, count:0, apiKey:k} }
}
carts.forEach(c=>{
let d=new Date(c.time)
let day=d.toISOString().slice(0,10)
let month=d.toISOString().slice(0,7)
let week=getWeek(d)
dailyMap[day]=(dailyMap[day]||0)+(c.total||0)
weeklyMap[week]=(weeklyMap[week]||0)+(c.total||0)
monthlyMap[month]=(monthlyMap[month]||0)+(c.total||0)
if(!perShop[c.apiKey]) perShop[c.apiKey]={name:c.apiKey,revenue:0,count:0,apiKey:c.apiKey};
perShop[c.apiKey].revenue+=c.total||0;
perShop[c.apiKey].count+=1;
})
let daily=Object.keys(dailyMap).sort().slice(-14).map(k=>({date:k,total:dailyMap[k]}))
let weekly=Object.keys(weeklyMap).sort().slice(-12).map(k=>({date:k,total:weeklyMap[k]}))
let monthly=Object.keys(monthlyMap).sort().slice(-12).map(k=>({date:k,total:monthlyMap[k]}))
if(daily.length===0) daily=[{date:new Date().toISOString().slice(0,10),total:0}]
res.json({daily,weekly,monthly,perShop})
})

app.post('/api/v1/admin/create-shop',async(req,res)=>{
if(!isAuthed(req)) return res.status(401).json({ok:false});
let name=req.body.name||'Shop'
let expiresInDays=parseInt(req.body.expiresInDays||req.body.exp||0)
let key='sm_live_'+crypto.randomBytes(16).toString('hex')
let expiresAt=null
if(expiresInDays>0){expiresAt=new Date(); expiresAt.setDate(expiresAt.getDate()+expiresInDays)}
if(useMongo && ShopModel){
 await ShopModel.create({_id:key,name,revenue:0,cartCount:0,expiresAt,createdAt:new Date()})
} else {
 db.shops[key]={name, revenue:0, cartCount:0, expiresAt, createdAt:new Date()};
 save()
}
res.json({ok:true,apiKey:key,shop:name,expiresAt})
})
app.post('/api/v1/admin/disable-key',async(req,res)=>{
if(!isAuthed(req)) return res.status(401).json({ok:false});
let key=req.body.apiKey
if(useMongo && ShopModel){ await ShopModel.updateOne({_id:key},{disabled:true}); return res.json({ok:true}); }
if(db.shops[key]){db.shops[key].disabled=true; save(); res.json({ok:true})}
else res.status(404).json({ok:false})
})
app.post('/api/v1/admin/regenerate',async(req,res)=>{
if(!isAuthed(req)) return res.status(401).json({ok:false});
let oldKey=req.body.apiKey
let oldData=null;
if(useMongo && ShopModel){ oldData=await ShopModel.findById(oldKey); if(!oldData) return res.status(404).json({ok:false}); }
else oldData=db.shops[oldKey];
if(!oldData) return res.status(404).json({ok:false});
let newKey='sm_live_'+crypto.randomBytes(16).toString('hex')
if(useMongo && ShopModel){
 await ShopModel.create({_id:newKey,name:oldData.name,revenue:oldData.revenue,cartCount:oldData.cartCount,createdAt:new Date(),expiresAt:oldData.expiresAt});
 await ShopModel.updateOne({_id:oldKey},{disabled:true});
} else {
 db.shops[newKey]={...oldData,createdAt:new Date()};
 db.shops[oldKey].disabled=true; save();
}
res.json({ok:true,newApiKey:newKey})
})
app.post('/api/v1/cart',async(req,res)=>{
let apiKey=req.headers['x-api-key']
let shop=null;
if(useMongo && ShopModel){ shop=await ShopModel.findById(apiKey); if(!shop) return res.status(401).json({ok:false,msg:'bad key'}); }
else { if(!apiKey||!db.shops[apiKey]) return res.status(401).json({ok:false}); shop=db.shops[apiKey]; }
if(shop.disabled) return res.status(403).json({ok:false,msg:'disabled'});
if(shop.expiresAt && new Date(shop.expiresAt)<new Date()) return res.status(403).json({ok:false,msg:'expired'});
let idemKey=req.headers['x-idempotency-key']
if(idemKey&&idempotency[idemKey]) return res.json(idempotency[idemKey])
let cart=req.body.cart||[]
let session=req.body.session||'unknown'
let total=0
cart.forEach(i=>{total+= (i.price||0)*(i.qty||1)})
if(useMongo && CartModel){
 shop.revenue+=total; shop.cartCount+=1; await shop.save();
 await CartModel.create({apiKey,session,cart,total,time:new Date()});
} else {
 shop.revenue+=total; shop.cartCount+=1;
 db.carts.push({apiKey,session,cart,total,time:new Date()});
 if(db.carts.length>2000) db.carts=db.carts.slice(-2000);
 save()
}
let valasz={ok:true,received:cart.length,total}
if(idemKey) idempotency[idemKey]=valasz
res.json(valasz)
})

function getWeek(d){
let date=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()))
let dayNum=date.getUTCDay()||7
date.setUTCDate(date.getUTCDate()+4-dayNum)
let yearStart=new Date(Date.UTC(date.getUTCFullYear(),0,1))
let weekNo=Math.ceil(( ( (date - yearStart)/86400000)+1)/7)
return date.getUTCFullYear()+'-W'+String(weekNo).padStart(2,'0')
}
app.get('/',(req,res)=>{res.send('<h1>SM Modul V6 NOBOX - PRO Fut! DB: '+(useMongo?'MongoDB Atlas ✅':'file')+'</h1><a href="/admin">Admin</a>')})
app.listen(process.env.PORT||10000,()=>console.log('SM Modul V6 NOBOX PRO Fut'))
