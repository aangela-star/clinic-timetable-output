// Server-only composition. Gates are opt-in and fail closed; never accept config from requests.
const {createHash}=require('node:crypto');
const {createAdapter,createAppsScriptTransport}=require('./publish-store-adapter');
const {readBounded}=require('./publish-http');
const sha=b=>createHash('sha256').update(b).digest('hex');
function secureUrl(value) {
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('INVALID_CONFIG');
  return u.href;
}
function createPublicVerifier({pageUrl,imageUrl,pageSha256,fetchImpl=fetch}) {
  async function read(url,type,limit) {
    const r=await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',headers:{Accept:type},signal:AbortSignal.timeout(15000)});
    if(!r.ok || (r.url && r.url!==url) || !(r.headers.get('content-type')||'').toLowerCase().startsWith(type))throw Error('PUBLIC_BASELINE_DRIFT');
    const b=await readBounded(r,limit);
    if(b.length>limit)throw Error('PUBLIC_BASELINE_DRIFT');
    return b;
  }
  async function checkPage() {
    const bytes=await read(pageUrl,'text/html',1000000);
    if(sha(bytes)!==pageSha256)throw Error('PUBLIC_BASELINE_DRIFT');
    const html=bytes.toString('utf8');
    // Deliberately strict approved HTML contract; unsupported markup fails closed.
    if(/<(?:base|picture)\b/i.test(html))throw Error('PUBLIC_BASELINE_DRIFT');
    const images=html.match(/<img\b[^>]*>/gi)||[];
    const matches=images.filter(tag=>{
      const sources=[...tag.matchAll(/\ssrc\s*=\s*(["'])(.*?)\1/gi)];
      return sources.length===1 && new URL(sources[0][2],pageUrl).href===imageUrl && !/\b(?:srcset|on\w+)\s*=/i.test(tag);
    });
    if(matches.length!==1)throw Error('PUBLIC_BASELINE_DRIFT');
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
    if(!publishEnabled)return {store,adapter:disabled.adapter};
    const pageUrl=secureUrl(config.PUBLISH_PUBLIC_PAGE_URL),imageUrl=secureUrl(config.PUBLISH_PUBLIC_IMAGE_URL);
    if(imageUrl!=='https://clinic-timetable-output.vercel.app/api/publish-image'||pageUrl!=='https://www.tainanrehab.com/time.html'||!/^([a-f0-9]{64})$/.test(config.PUBLISH_PUBLIC_PAGE_SHA256||''))return {store,adapter:disabled.adapter};
    const verifier=createPublicVerifier({pageUrl,imageUrl,pageSha256:config.PUBLISH_PUBLIC_PAGE_SHA256,fetchImpl});
    // Configuration scope is part of every immutable approval's server identity.
    const executorId='vercel-publish-v1:'+sha(JSON.stringify([url,pageUrl,imageUrl,config.PUBLISH_PUBLIC_PAGE_SHA256]));
    const readSchedule=async month=>{const r=await store.request({action:'load',month});if(!r.found||r.month!==month||r.schemaVersion!==1)throw Error('SAVE_REQUIRED');return r.data;};
    return {store,adapter:createAdapter({enabled:true,store,readSchedule,executorId,...verifier})};
  }catch(_){return {store,adapter:disabled.adapter};}
}
module.exports={createProvider,createPublicVerifier};
