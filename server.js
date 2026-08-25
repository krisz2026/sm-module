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
app.get('/',(req,res)=>res.send('SM Modul v3 PRO fut!'))
app.get('/admin',(req,res)=>{
let html=`<html><head><meta name="viewport" content="width=device-width"><style>
body{font-family:sans-serif;padding:20px;background:#f5f5f5}
.card{background:white;padding:15px;margin:10px 0;border-radius:10px;box-shadow:0 2px 5px #0002}
.key{font-family:monospace;background:#000;color:#0f0;padding:10px;word-break:break-all}
button{padding:10px 15px;margin:5px;border:0;border-radius:5px;cursor:pointer}
.danger{background:#d00;color:white}.ok{background:#0a0;color:white}
</style></head><body><h1>SM Admin - Kulcsok</h1>
<div class="card"><h3>Uj bolt + kulcs</h3>
<input id="name" placeholder="Bolt neve" style="padding:10px;width:70%">
<input id="exp" type="number" placeholder="Lejarat napokban (pl 30)" style="padding:10px;width:25%">
<button class="ok" onclick="createShop()">Letrehozas</button></div>
<div id="list"></div>
<script>
async function load(){let r=await fetch('/api/v1/admin/shops');let d=await r.json();let h='';
for(let k in d.shops){let s=d.shops[k];
h+='<div class=card><b>'+s.name+'</b><br><div class=key>'+k+'</div>Bevetel: '+s.revenue+' Ft<br>Lejarat: '+(s.expiresAt||'soha')+'<br>Statusz: '+(s.disabled?'TILTVA':'Aktiv')+'<br>Cartok: '+s.cartCount+'<br><button class=danger onclick="disableKey(\\''+k+'\\')">Tiltas</button><button class=ok onclick="regenKey(\\''+k+'\\')">Ujrageneralas</button><br><a href="/test?key='+k+'"><button>TESZT ehhez a kulcshoz</button></a></div>'}
document.getElementById('list').innerHTML=h}
async function createShop(){let n=document.getElementById('name').value;let e=document.getElementById('exp').value;let r=await fetch('/api/v1/admin/create-shop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,expiresInDays:e})});let d=await r.json();alert('KULCS: '+d.apiKey);load()}
async function disableKey(k){await fetch('/api/v1/admin/disable-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:k})});load()}
async function regenKey(k){let r=await fetch('/api/v1/admin/regenerate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:k})});let d=await r.json();alert('UJ KULCS: '+d.newApiKey);load()}
load()
</script></body></html>`
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
app.get('/api/v1/admin/shops',(req,res)=>{
res.json({ok:true,shops:db.shops})
})
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
if(!apiKey||!db.shops[apiKey]) return res.status(401).json({ok:false,error:'Invalid API key '+apiKey})
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
db.carts.push({apiKey,session,cart,total,time:new Date()})
if(db.carts.length>1000) db.carts=db.carts.slice(-500)
save()
let valasz={ok:true,received:cart.length,total,session,shop:shop.name}
if(idemKey) idempotency[idemKey]=valasz
res.json(valasz)
})
app.get('/api/v1/admin/stats',(req,res)=>{
res.json(db)
})
app.get('/test',(req,res)=>{
let testKey=req.query.key||Object.keys(db.shops).find(k=>!db.shops[k].disabled)||'NINCS_KULCS'
res.send(`<html><body style="font-family:sans-serif;padding:30px"><h1>Teszt - Kulcs: ${testKey}</h1><button id="btn" style="padding:20px;font-size:20px;background:green;color:white">Teszt kosar 9990 Ft kuldese</button><pre id="out" style="margin-top:20px;background:#eee;padding:20px"></pre><script>document.getElementById('btn').onclick=()=>{document.getElementById('out').innerText='Kuldes...';fetch('/api/v1/cart',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':'${testKey}'},body:JSON.stringify({cart:[{price:9990,qty:1,name:'Teszt'}]})}).then(r=>r.json()).then(d=>{document.getElementById('out').innerText=JSON.stringify(d,null,2);alert('SIKER! Bevetel hozzaadva: 9990 Ft');}).catch(e=>{document.getElementById('out').innerText='HIBA: '+e})}</script><p><a href="/admin">Vissza adminra</a></p></body></html>`)
})
app.listen(process.env.PORT||10000,()=>console.log('V3 PRO fut'))
