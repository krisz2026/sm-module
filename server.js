const express = require('express')
const cors = require('cors')
const crypto = require('crypto')
const app = express()
app.use(cors())
app.use(express.json())

let shops = {}

app.get('/', (req,res)=>{
 res.send('SM Modul v1 fut!')
})

app.get('/health', (req,res)=>{
 res.json({ ok:true })
})

app.post('/api/v1/admin/create-shop', (req,res)=>{
 let name = req.body.name || 'Teszt Shop'
 let key = 'sm_live_' + crypto.randomBytes(16).toString('hex')
 shops = { name:name, bevetel:0 }
 res.json({ ok:true, apiKey:key, shop:name })
})

app.get('/api/v1/admin/stats', (req,res)=>{
 res.json({ shops:shops })
})

app.listen(process.env.PORT || 10000, ()=>{ console.log('fut') })
