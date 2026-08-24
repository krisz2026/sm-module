const express=require('express')
const cors=require('cors')
const crypto=require('crypto')
const app=express()
app.use(cors())
app.use(express.json())
let shops={}
let carts=[]
let idempotency={}
app.get('/',(req,res)=>{res.send('SM Modul v1 fut! - KESZ')})
app.get('/health',(req,res)=>{res.json({ok:true,time:new Date().toISOString()})})
app.get('/generate-my-key',(req,res)=>{
  let k='sm_live_'+crypto.randomBytes(16).toString('hex')
  shops[k]={name:'Shop',bevetel:0,createdAt:new Date()}
  res.send('<h1>KULCSOD:</h1><h2 style="background:#000;color:#0f0;padding:20px;word-break:break-all">'+k+'</h2><p><a href="/test">Teszt oldal</a></p>')
})
app.get('/test',(req,res)=>{
  res.send(`<html><body style="font-family:sans-serif;padding:30px"><h1>SM Modul TESZT</h1><p>Kulcs: sm_live_5fc3c84625d76a40680b4c9932a4d5ec</p><button id="btn" style="padding:20px;font-size:20px;background:green;color:white">KATT IDE TESZTELNI</button><pre id="out" style="margin-top:20px;background:#eee;padding:20px"></pre><script>document.getElementById('btn').onclick=()=>{document.getElementById('out').innerText='Kuldes...';fetch('/api/v1/cart',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':'sm_live_5fc3c84625d76a40680b4c9932a4d5ec','x-idempotency-key':'teszt-'+Date.now()},body:JSON.stringify({session:'teszt_user_telefon',cart:[{id:1,name:'Teszt Termek',qty:1,price:9990}]})}).then(r=>r.json()).then(d=>{document.getElementById('out').innerText=JSON.stringify(d,null,2);alert('SIKER! '+JSON.stringify(d));}).catch(e=>{document.getElementById('out').innerText='HIBA: '+e;alert('HIBA: '+e);})}</script></body></html>`)
})
app.post('/api/v1/admin/create-shop',(req,res)=>{
  let name=req.body.name||'Shop'
  let key='sm_live_'+crypto.randomBytes(16).toString('hex')
  shops[key]={name:name,bevetel:0,createdAt:new Date()}
  res.json({ok:true,apiKey:key,shop:name})
})
app.post('/api/v1/cart',(req,res)=>{
  let apiKey=req.headers['x-api-key']
  if(!apiKey) return res.status(401).json({ok:false,error:'Missing API key'})
  if(!shops[apiKey] && apiKey!=='sm_live_5fc3c84625d76a40680b4c9932a4d5ec'){shops[apiKey]={name:'Auto Shop',createdAt:new Date()}}
  let idemKey=req.headers['x-idempotency-key']
  if(idemKey && idempotency[idemKey]){return res.json(idempotency[idemKey])}
  let cart=req.body.cart||req.body.c||[]
  let session=req.body.session||'unknown'
  carts.push({apiKey,session,cart,time:new Date()})
  let valasz={ok:true,received:cart.length,session:session,shop:shops[apiKey]?.name||'Shop',message:'Kosar elmentve!'}
  if(idemKey) idempotency[idemKey]=valasz
  console.log('KOSAR:',session,cart)
  res.json(valasz)
})
app.get('/api/v1/admin/stats',(req,res)=>{res.json({shops:Object.keys(shops).length,carts:carts.length,lastCarts:carts.slice(-5)})})
app.get('/api/v1/admin/carts',(req,res)=>{res.json(carts.slice(-20))})
const PORT=process.env.PORT||10000
app.listen(PORT,()=>console.log('FULL fut port '+PORT))
