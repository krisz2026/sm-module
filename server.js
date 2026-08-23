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
 let dij = Math.round(osszeg*0.02)
 bevetelek+=dij
 res.json({ok:true, fee:dij, total:osszeg, bevetelek})
})
app.get('/', (req,res)=>{
 res.send('SM Modul fut! Bevetel: '+bevetelek)
})
app.listen(process.env.PORT || 3000, ()=>{console.log('Fut')})
