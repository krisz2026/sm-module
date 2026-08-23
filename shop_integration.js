document.addEventListener("DOMContentLoaded",()=>{
let s=localStorage.getItem("sm_session")
if(!s){
s="SM-"+Math.random().toString(36).slice(2,9)
localStorage.setItem("sm_session",s)
}
async function sendCart(c){
try{
let r=await fetch("https://krisz2026-sm-modul.onrender.com/api/cart",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({session:s,cart:c})
})
let d=await r.json()
console.log("Valasz:",d)
}catch(e){console.log("Hiba:",e)}
}
window.addEventListener("sm_cart_changed",(e)=>{
sendCart(e.detail)
})
})
