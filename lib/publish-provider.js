// Server-only composition. Gates are opt-in and fail closed; never accept config from requests.
const {createHash}=require('node:crypto');
const {createAdapter,createPointerOnlyAdapter,createAppsScriptTransport}=require('./publish-store-adapter');
const {readBounded}=require('./publish-http');
const {targetFingerprint}=require('./publish-target');
const sha=b=>createHash('sha256').update(b).digest('hex');
function secureUrl(value) {
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('INVALID_CONFIG');
  return u.href;
}
function createPublicVerifier({pageUrl,imageUrl,targetSha256,pageSha256,fetchImpl=fetch}) {
  async function read(url,type,limit) {
    const r=await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',headers:{Accept:type},signal:AbortSignal.timeout(15000)});
    if(!r.ok || (r.url && r.url!==url) || !(r.headers.get('content-type')||'').toLowerCase().startsWith(type))throw Error('PUBLIC_BASELINE_DRIFT');
    const b=await readBounded(r,limit);
    if(b.length>limit)throw Error('PUBLIC_BASELINE_DRIFT');
    return b;
  }
  async function checkPage() {
    const bytes=await read(pageUrl,'text/html',1000000);
    const fingerprint=targetFingerprint(bytes.toString('utf8'),pageUrl,imageUrl);
    // Preserve the frozen LOCAL harness's stricter whole-page pin. Production
    // composition never supplies this legacy argument; no environment fallback.
    const page=new URL(pageUrl),image=new URL(imageUrl);
    const legacyLocal=targetSha256===undefined&&page.protocol==='http:'&&page.hostname==='127.0.0.1'&&image.origin===page.origin&&/^[a-f0-9]{64}$/.test(pageSha256||'');
    if(legacyLocal?sha(bytes)!==pageSha256:fingerprint!==targetSha256)throw Error('PUBLIC_BASELINE_DRIFT');
  }
  return {checkPage,async publicRead(){await checkPage();return read(imageUrl,'image/png',2500000);}};
}
function createProvider({config=process.env,fetchImpl=fetch,getSecret=()=>require('./server-session').getServerSecret()}={}) {
  const disabled={adapter:createAdapter(),store:undefined};
  const imageEnabled=config.PUBLISH_IMAGE_ENABLED==='true';
  const publishEnabled=config.PUBLISH_FLOW_ENABLED==='true';
  if(!imageEnabled)return disabled;
  let store;
  try {
    const url=secureUrl(require('../api/schedule').APPS_SCRIPT_WEB_APP_URL);
    store=createAppsScriptTransport({url,secret:getSecret(),fetchImpl,enabled:true});
    if(!publishEnabled)return {store,adapter:createPointerOnlyAdapter({store})};
    const pageUrl=secureUrl(config.PUBLISH_PUBLIC_PAGE_URL),imageUrl=secureUrl(config.PUBLISH_PUBLIC_IMAGE_URL);
    if(imageUrl!=='https://clinic-timetable-output.vercel.app/api/publish-image'||pageUrl!=='https://www.tainanrehab.com/time.html'||!/^([a-f0-9]{64})$/.test(config.PUBLISH_PUBLIC_TARGET_SHA256||''))return {store,adapter:disabled.adapter};
    const verifier=createPublicVerifier({pageUrl,imageUrl,targetSha256:config.PUBLISH_PUBLIC_TARGET_SHA256,fetchImpl});
    // Configuration scope is part of every immutable approval's server identity.
    const executorId='vercel-publish-v1:'+sha(JSON.stringify([url,pageUrl,imageUrl,config.PUBLISH_PUBLIC_TARGET_SHA256]));
    const readSchedule=async month=>{const r=await store.request({action:'load',month});if(!r.found||r.month!==month||r.schemaVersion!==1)throw Error('SAVE_REQUIRED');return r.data;};
    return {store,adapter:createAdapter({enabled:true,store,readSchedule,executorId,...verifier})};
  }catch(_){return {store,adapter:disabled.adapter};}
}
module.exports={createProvider,createPublicVerifier};
