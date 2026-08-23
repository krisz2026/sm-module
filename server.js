const express = require('express')
const cors = require('cors')
const app = express()
app.use(cors())
app.use(express.json())
let bevetelek = 0
app.post('/api/cart', (req,res)=>{
let cart = req.body.cart || []
let osszeg = 0
cart.forEach(i=>{ osszeg+= (i.price||0)*(i.qty||1) })
let fee = Math.round(osszeg*0.02)
bevetelek+=fee
res.json({ok:true, fee:fee, total:osszeg, bevetel:bevetelek})
})
app.get('/', (req,res)=>{
res.send('SM Modul fut! Bevetel: '+bevetelek+' Ft')
})
app.listen(3000, ()=>{console.log('Fut')})
