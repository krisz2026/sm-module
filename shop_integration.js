// SM Modul v1 - vegleges shop_integration
document.addEventListener("DOMContentLoaded",()=>{
 const API_URL = "https://krisz2026-sm-modul.onrender.com/api/v1/cart"
 const API_KEY = "IDE_JON_MAJD_A_KULCSOD"
 let session = localStorage.getItem("sm_session")
 if(!session){
  session = "SM-"+Math.random().toString(36).slice(2,10)+"-"+Date.now()
  localStorage.setItem("sm_session", session)
 }
 async function sendCart(cartData){
  try{
   let idempotencyKey = session + "-" + JSON.stringify(cartData).length + "-" + Date.now()
   let res = await fetch(API_URL, {
    method:"POST",
    headers:{
     "Content-Type":"application/json",
     "x-api-key": API_KEY,
     "x-idempotency-key": idempotencyKey
    },
    body:JSON.stringify({ cart: cartData, session: session })
   })
   let data = await res.json()
   console.log("SM Valasz:", data)
   return data
  }catch(err){
   console.log("SM Hiba:", err)
  }
 }
 window.SM = { sendCart: sendCart, session: session }
 window.addEventListener("sm_cart_changed", (e)=>{
  if(e.detail && e.detail.length>0) sendCart(e.detail)
 })
 console.log("SM Modul betoltve, session:", session)
})
