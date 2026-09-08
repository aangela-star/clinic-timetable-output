// Fixed public image resource, composed lazily behind the server image gate.
const {createHash}=require('node:crypto');
function createImageHandler({store}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method!=='GET'){res.statusCode=405;return res.end();}
    if(!store){res.statusCode=503;return res.end();}
    try{const p=await store.call('pointer');const bytes=await store.bytes(p.blobId);if(p.targetPointerId!=='jinan-website/current'||createHash('sha256').update(bytes).digest('hex')!==p.pngSha256)throw Error('INVALID_PNG');res.setHeader('Content-Type','image/png');res.end(bytes);}
    catch(_){res.statusCode=404;res.end();}
  };
}
module.exports=(req,res)=>createImageHandler({store:require('../lib/publish-provider').createProvider().store})(req,res);module.exports.createImageHandler=createImageHandler;
