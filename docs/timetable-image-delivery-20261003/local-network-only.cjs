// Test runner guard; production modules are never configured by this file.
const original=globalThis.fetch;
globalThis.fetch=(input,options)=>{
 const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('TEST_EXTERNAL_NETWORK_FORBIDDEN');
 return original(input,options);
};
