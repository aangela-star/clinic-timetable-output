'use strict';
// Offline only: preserve URLs, filenames, bytes and previously recorded hashes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=__dirname;
const runtime=Object.freeze({react:'18.3.1',reactDOM:'18.3.1-next-f1338f8080-20240426',babel:'8.0.4'});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function inspect(a,b){
 assert.equal(a.status,'available',a.url);assert.equal(sha(b),a.sha256,'Asset hash changed: '+a.url);assert.equal(b.length,a.bytes);
 let contentType,fontFormat;
 if(a.file.endsWith('.js')){
  contentType='application/javascript';assert.ok(a.expectedVersion && b.includes(Buffer.from(a.expectedVersion)),'Missing version marker: '+a.url);
  if(a.url==='https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js'){
   assert.equal(a.sha256,'35f4f974f4b2bcd44da73963347f8952e341f83909e4498227d4e26b98f66f0d');
   const text=b.toString();assert.ok(text.startsWith('/**\n * @license React\n * react-dom.production.min.js'));
   assert.ok(text.includes('Q.version="'+runtime.reactDOM+'"'),'ReactDOM export differs from exact pinned runtime');
  }
 }else if(a.file.endsWith('.css'))contentType='text/css';
 else{
  const magic=b.subarray(0,4).toString('hex');
  const formats={'00010000':['ttf','font/ttf'],'74727565':['ttf','font/ttf'],'4f54544f':['otf','font/otf'],'774f4646':['woff','font/woff'],'774f4632':['woff2','font/woff2']};
  assert.ok(formats[magic],'Unknown font signature: '+a.file);[fontFormat,contentType]=formats[magic];
 }
 return {...a,contentType,...(fontFormat?{fontFormat}:{}),...(a.url.includes('react-dom@')?{expectedRuntimeVersion:runtime.reactDOM}:{})};
}
module.exports={runtime,inspect};
