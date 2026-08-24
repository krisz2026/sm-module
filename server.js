const express = require('express')
const cors = require('cors')
const crypto = require('crypto')
const app = express()
app.use(cors())
app.use(express.json())

let shops = {}
let processedRequests = new Set()

app.get('/health', (req,res)=>{
 res.json({ status:'ok', uptime:process.uptime(), time:new Date().toISOString() })
})

app.get('/', (req,res)=>{
 let total = Object.values(shops).reduce((s,x)=>s+x.bevetel,0)
 res.send('SM Modul v1 fut! Ossz bevetel: '+total+' | Shopok: '+Object.keys(shops).length)
})

app.post('/api/v1/admin/create-shop', (req,res)=>{
 let name = req.body.name || 'Nevezett shop'
 let key = 'sm_live_' + crypto.randomBytes(16).toString('hex')
 shops = { name:name, bevetel:0, tranzakcio:0, created:new Date() }
 res.json({ ok:true, apiKey:key, shop:name })
})

function checkApiKey(req,res,next){
 let key = req.headers['x-api-key'] || req.body.apiKey || req.query.apiKey
 if(!key ||!shops){
  return res.status(401).json({ ok:false, error:'Hibás vagy hiányzó API kulcs' })
 }
 req.shopKey = key
 req.shop = shops
 next()
}

app.get('/api/v1/verify-key', checkApiKey, (req,res)=>{
 res.json({ ok:true, shop:req.shop.name, bevetel:req.shop.bevetel, tranzakcio:req.shop.tranzakcio })
})

app.post('/api/v1/cart', checkApiKey, (req,res)=>{
 try{
  let idempotencyKey = req.headers['x-idempotency-key'] || ''
  if(idempotencyKey && processedRequests.has(idempotencyKey)){
   return res.json({ ok:true, cached:true, msg:'Mar feldolgozva' })
  }
  let cart = req.body.cart || []
  if(!Array.isArray(cart)) return res.status(400).json({ ok:false, error:'cart nem tomb' })
  let osszeg = 0
  cart.forEach(i=>{ osszeg+= (Number(i.price)||0)*(Number(i.qty)||1) })
  if(osszeg<=0) return res.status(400).json({ ok:false, error:'Ures kosar' })
  let dij = Math.round(osszeg*0.02)
  req.shop.bevetel += dij
  req.shop.tranzakcio += 1
  if(idempotencyKey) processedRequests.add(idempotencyKey)
  if(processedRequests.size>5000) processedRequests.clear()
  res.json({ ok:true, fee:dij, total:osszeg, shop:req.shop.name, shopBevetel:req.shop.bevetel })
 }catch(e){
  console.error(e)
  res.status(500).json({ ok:false, error:'Szerver hiba' })
 }
})

app.get('/api/v1/admin/stats', (req,res)=>{
 res.json({ ok:true, shops:shops, totalShops:Object.keys(shops).length })
})

app.listen(process.env.PORT || 10000, ()=>{ console.log('SM v1 stabil fut') })
