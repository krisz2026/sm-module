const express=require('express')
const cors=require('cors')
const crypto=require('crypto')
const fs=require('fs')
const app=express()
app.use(cors())
app.use(express.json())
let DB_FILE='./db.json'
let db={shops:{},carts:[]}
if(fs.existsSync(DB_FILE)){try{db=JSON.parse(fs.readFileSync(DB_FILE))}catch(e){}}
function save(){fs.writeFileSync(DB_FILE,JSON.stringify(db))}
let idempotency={}

app.get('/',(req,res)=>res.send('SM Modul V4 Dashboard fut!'))

app.get('/admin',(req,res)=>{
let html=`<html><head><meta name="viewport" content="width=device-width"><style>
body{font-family:sans-serif;padding:15px;background:#f5f5f5;margin:0}
.card{background:white;padding:15px;margin:10px 0;border-radius:12px;box-shadow:0 2px 8px #0001}
.key{font-family:monospace;background:#111;color:#0f0;padding:10px;border-radius:6px;word-break:break-all;font-size:13px}
button{padding:10px 14px;margin:4px;border:0;border-radius:6px;cursor:pointer;font-weight:600}
.danger{background:#e11;color:white}.ok{background:#0a7a0a;color:white}.gray{background:#eee}
h1{margin:10px 0}.stat{font-size:24px;font-weight:800}
canvas{max-width:100%}
.tab{padding:10px 15px;background:#ddd;border-radius:8px;margin:2px;cursor:pointer;display:inline-block}
.tab.active{background:#111;color:white}
</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head><body>
<h1>SM Admin - PRO Dashboard</h1>
<div class="card">
<h3>Uj bolt + kulcs</h3>
<input id="name" placeholder="Bolt neve" style="padding:10px;width:60%">
<input id="exp" type="number" placeholder="Lejarat nap" style="padding:10px;width:30%">
<button class="ok" onclick="createShop()">Letrehozas</button>
</div>

<div class="card">
<h3>Osszesites</h3>
<div style="display:flex;gap:15px;flex-wrap:wrap">
<div><div>Ossz bevetel</div><div class="stat" id="totalRev">0 Ft</div></div>
<div><div>Ossz kosar</div><div class="stat" id="totalCart">0</div></div>
<div><div>Aktiv kulcs</div><div class="stat" id="totalShop">0</div></div>
</div>
</div>

<div class="card">
<div><span class="tab active" id="tab-daily" onclick="showChart('daily')">Napi</span>
<span class="tab" id="tab-weekly" onclick="showChart('weekly')">Heti</span>
<span class="tab" id="tab-monthly" onclick="showChart('monthly')">Havi</span></div>
<canvas id="revChart" height="180"></canvas>
</div>

<div class="card">
<canvas id="shopChart" height="140"></canvas>
<p style="font-size:12px;color:#666">Shoponkenti bevetel</p>
</div>

<div id="list"></div>

<script>
let chartRev=null
let chartShop=null
let analyticsData=null

async function load(){
let r=await fetch('/api/v1/admin/shops')
let d=await r.json()
let h=''
let totalRev=0, totalCart=0, active=0
for(let k in d.shops){let s=d.shops[k]; if(!s.disabled) active++; totalRev+=s.revenue||0; totalCart+=s.cartCount||0;
h+='<div class=card><b>'+s.name+'</b><br><div class=key>'+k+'</div>Bevetel: '+(s.revenue||0)+' Ft<br>Lejarat: '+(s.expiresAt||'soha')+'<br>Statusz: '+(s.disabled?'TILTVA':'Aktiv')+'<br>Cartok: '+(s.cartCount||0)+'<br><button class=danger onclick="disableKey(\\''+k+'\\')">Tiltas</button><button class=ok onclick="regenKey(\\''+k+'\\')">Ujrageneralas</button><br><a href="/test?key='+k+'"><button class=gray>TESZT ehhez</button></a></div>'}
document.getElementById('list').innerHTML=h
document.getElementById('totalRev').innerText=totalRev+' Ft'
document.getElementById('totalCart').innerText=totalCart
document.getElementById('totalShop').innerText=active

// analytics
let a=await fetch('/api/v1/admin/analytics').then(r=>r.json())
analyticsData=a
drawShopChart(a.perShop)
showChart('daily')
}

function showChart(type){
document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'))
document.getElementById('tab-'+type).classList.add('active')
let labels=[], data=[]
if(type==='daily'){labels=analyticsData.daily.map(x=>x.date); data=analyticsData.daily.map(x=>x.revenue)}
if(type==='weekly'){labels=analyticsData.weekly.map(x=>x.week); data=analyticsData.weekly.map(x=>x.revenue)}
if(type==='monthly'){labels=analyticsData.monthly.map(x=>x.month); data=analyticsData.monthly.map(x=>x.revenue)}
drawRevChart(labels,data,type)
}

function drawRevChart(labels,data,type){
let ctx=document.getElementById('revChart')
if(chartRev) chartRev.destroy()
chartRev=new Chart(ctx,{type:'bar',data:{labels:labels,datasets:[{label:type+' bevetel Ft',data:data,backgroundColor:'#111'}]},options:{responsive:true,plugins:{legend:{display:false}}}})
}
function drawShopChart(perShop){
let ctx=document.getElementById('shopChart')
if(chartShop) chartShop.destroy()
let labels=Object.values(perShop).map(s=>s.name)
let data=Object.values(perShop).map(s=>s.revenue)
chartShop=new Chart(ctx,{type:'doughnut',data:{labels:labels,datasets:[{data:data,backgroundColor:['#111','#0a7a0a','#e11','#036','#f90','#06f']}]},options:{responsive:true}})
}

async function createShop(){let n=document.getElementById('name').value;let e=document.getElementById('exp').value;let r=await fetch('/api/v1/admin/create-shop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,expiresInDays:e})});let d=await r.json();alert('KULCS: '+d.apiKey);load()}
async function disableKey(k){await fetch('/api/v1/admin/disable-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:k})});load()}
async function regenKey(k){let r=await fetch('/api/v1/admin/regenerate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:k})});let d=await r.json();alert('UJ KULCS: '+d.newApiKey);load()}
load()
</script>
</body></html>`
res.send(html)
})

app.post('/api/v1/admin/create-shop',(req,res)=>{
let name=req.body.name||'Shop'
let expiresInDays=parseInt(req.body.expiresInDays)||0
let key='sm_live_'+crypto.randomBytes(16).toString('hex')
let expiresAt=null
if(expiresInDays>0){expiresAt=new Date();expiresAt.setDate(expiresAt.getDate()+expiresInDays)}
db.shops[key]={name, revenue:0, cartCount:0, createdAt:new Date(), expiresAt, disabled:false}
save()
res.json({ok:true,apiKey:key,shop:name,expiresAt})
})
app.get('/api/v1/admin/shops',(req,res)=>{res.json({ok:true,shops:db.shops})})
app.post('/api/v1/admin/disable-key',(req,res)=>{
let key=req.body.apiKey
if(db.shops[key]){db.shops[key].disabled=true;save();res.json({ok:true})}
else res.status(404).json({ok:false})
})
app.post('/api/v1/admin/regenerate',(req,res)=>{
let oldKey=req.body.apiKey
let oldData=db.shops[oldKey]
if(!oldData) return res.status(404).json({ok:false})
let newKey='sm_live_'+crypto.randomBytes(16).toString('hex')
db.shops[newKey]={...oldData,createdAt:new Date()}
db.shops[oldKey].disabled=true
save()
res.json({ok:true,newApiKey:newKey})
})
app.post('/api/v1/cart',(req,res)=>{
let apiKey=req.headers['x-api-key']
if(!apiKey||!db.shops[apiKey]) return res.status(401).json({ok:false,error:'Invalid API key'})
let shop=db.shops[apiKey]
if(shop.disabled) return res.status(403).json({ok:false,error:'Key disabled'})
if(shop.expiresAt && new Date(shop.expiresAt)<new Date()) return res.status(403).json({ok:false,error:'Key expired'})
let idemKey=req.headers['x-idempotency-key']
if(idemKey&&idempotency[idemKey]) return res.json(idempotency[idemKey])
let cart=req.body.cart||[]
let session=req.body.session||'unknown'
let total=0
cart.forEach(i=>{total+= (i.price||0)*(i.qty||1)})
shop.revenue+=total
shop.cartCount+=1
db.carts.push({apiKey,session,cart,total,time:new Date().toISOString()})
if(db.carts.length>2000) db.carts=db.carts.slice(-1000)
save()
let valasz={ok:true,received:cart.length,total,session,shop:shop.name}
if(idemKey) idempotency[idemKey]=valasz
res.json(valasz)
})

// ANALITIKA - napi / heti / havi
app.get('/api/v1/admin/analytics',(req,res)=>{
let dailyMap={}
let weeklyMap={}
let monthlyMap={}
let perShop={}
db.carts.forEach(c=>{
let d=new Date(c.time)
let day=d.toISOString().slice(0,10)
let month=d.toISOString().slice(0,7)
let week=getWeek(d)
dailyMap[day]=(dailyMap[day]||0)+c.total
weeklyMap[week]=(weeklyMap[week]||0)+c.total
monthlyMap[month]=(monthlyMap[month]||0)+c.total
if(!perShop[c.apiKey]) perShop[c.apiKey]={name:db.shops[c.apiKey]?db.shops[c.apiKey].name:c.apiKey.slice(0,10), revenue:0, count:0}
perShop[c.apiKey].revenue+=c.total
perShop[c.apiKey].count+=1
})
let daily=Object.keys(dailyMap).sort().slice(-14).map(date=>({date,revenue:dailyMap[date]}))
let weekly=Object.keys(weeklyMap).sort().slice(-12).map(week=>({week,revenue:weeklyMap[week]}))
let monthly=Object.keys(monthlyMap).sort().slice(-12).map(month=>({month,revenue:monthlyMap[month]}))
if(daily.length===0) daily=[{date:new Date().toISOString().slice(0,10),revenue:0}]
res.json({daily,weekly,monthly,perShop})
})

function getWeek(d){
let date=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()))
let dayNum=date.getUTCDay()||7
date.setUTCDate(date.getUTCDate()+4-dayNum)
let yearStart=new Date(Date.UTC(date.getUTCFullYear(),0,1))
let weekNo=Math.ceil(( ( (date - yearStart)/86400000)+1)/7)
return date.getUTCFullYear()+'-W'+String(weekNo).padStart(2,'0')
}

app.get('/api/v1/admin/stats',(req,res)=>{res.json(db)})
app.get('/test',(req,res)=>{
let testKey=req.query.key||Object.keys(db.shops).find(k=>!db.shops[k].disabled)||'NINCS_KULCS'
res.send(`<html><body style="font-family:sans-serif;padding:30px"><h1>Teszt - Kulcs: ${testKey}</h1><button id="btn" style="padding:20px;font-size:20px;background:green;color:white">Teszt kosar 9990 Ft kuldese</button><pre id="out" style="margin-top:20px;background:#eee;padding:20px"></pre><script>document.getElementById('btn').onclick=()=>{document.getElementById('out').innerText='Kuldes...';fetch('/api/v1/cart',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':'${testKey}'},body:JSON.stringify({cart:[{price:9990,qty:1,name:'Teszt'}]})}).then(r=>r.json()).then(d=>{document.getElementById('out').innerText=JSON.stringify(d,null,2);alert('SIKER! Bevetel hozzaadva: 9990 Ft');}).catch(e=>{document.getElementById('out').innerText='HIBA: '+e})}</script><p><a href="/admin">Vissza adminra</a></p></body></html>`)
})
app.listen(process.env.PORT||10000,()=>console.log('V4 Dashboard fut'))
