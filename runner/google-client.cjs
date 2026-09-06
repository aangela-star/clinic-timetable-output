'use strict';
const URL='https://script.google.com/macros/s/AKfycbz5OXGNDZJWEj2-W1g-1r_SISPjYYcI-7gsUsivt3Rx7-zY6AzpQqqZTIFROVKMU1eh3w/exec';
function createClient({secret,fetchImpl=fetch}){
 if(typeof secret!=='string'||secret.length<32)throw Error('RUNNER_NOT_CONFIGURED');
 return async function(body){
  const r=await fetchImpl(URL,{method:'POST',redirect:'follow',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({...body,secret})});
  if(!r.ok)throw Error('HANDOFF_REQUIRES_CHECK');return r.json();
 };
}
module.exports={createClient};
