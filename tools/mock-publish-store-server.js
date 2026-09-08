// LOCAL MOCK ONLY. No production auth, external POST, CMS, or secret configuration.
const http=require('node:http'), fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const {LocalStore}=require('../lib/publish-store-mock');
const {createAdapter,MAX_BODY_BYTES}=require('../lib/publish-store-adapter');
const {createPublishApi}=require('../lib/publish-api');
const {createPublicVerifier}=require('../lib/publish-provider');
const publicHtml='<h1>MOCK 本機模擬 — 非正式官網</h1><img src="/api/publish-image" style="width:675px;height:1200px">';
const {createImageHandler}=require('../api/publish-image');
function createHarness(root) {
  const store=new LocalStore(root), sessions=new Set();
  const adapter=createAdapter({enabled:true,mock:true,store,readSchedule:async month=>store.read('schedule-'+month+'.json',null),
    publicRead:async()=>{const base=`http://127.0.0.1:${server.address().port}`;return createPublicVerifier({pageUrl:base+'/public/jinan',imageUrl:base+'/api/publish-image',pageSha256:crypto.createHash('sha256').update(publicHtml).digest('hex')}).publicRead();}});
  const api=createPublishApi({adapter,identity:req=>req.mockSession});
  const allowed=new Set(['index.html','publish-core.js','schedule-api-config.js','schedule-save-load-core.js','clinic-order.js']);
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(!['localhost','127.0.0.1'].includes((req.headers.host||'').split(':')[0])){res.statusCode=403;return res.end();}
    res.setHeader('Cache-Control','no-store');
    const send=(code,obj)=>{res.statusCode=code;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(obj));};
    const methods=url.pathname==='/api/auth'?['POST']:['/api/schedule','/api/publish'].includes(url.pathname)?['GET','POST']:['GET'];
    if(!methods.includes(req.method))return send(405,{ok:false,error:'METHOD_NOT_ALLOWED'});
    let chunks=[],size=0;
    for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY_BYTES){send(413,{ok:false,error:'BODY_TOO_LARGE'});return;}chunks.push(chunk);}
    req.body=Buffer.concat(chunks).toString();req.query=Object.fromEntries(url.searchParams);
    const session=/mock_session=([a-f0-9-]+)/.exec(req.headers.cookie||'')?.[1];req.mockSession=session;
    if(url.pathname==='/api/auth'){
      const id=crypto.randomUUID();sessions.add(id);res.setHeader('Set-Cookie',`mock_session=${id}; HttpOnly; SameSite=Strict; Path=/`);return send(200,{ok:true,mock:true});
    }
    if(url.pathname==='/api/publish-image')return createImageHandler({store})(req,res);
    if(url.pathname==='/public/jinan'){res.setHeader('Content-Type','text/html');return res.end(publicHtml);}
    if(url.pathname.startsWith('/api/')){
      if(!sessions.has(session))return send(401,{ok:false,error:'AUTH_REQUIRED'});
      if(url.pathname==='/api/publish')return api(req,res);
      if(url.pathname==='/api/schedule'){
        let b;try{b=req.body?JSON.parse(req.body):{};}catch(_){return send(400,{ok:false,error:'INVALID_REQUEST'});}
        const month=req.method==='GET'?url.searchParams.get('month'):b.month;
        if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))return send(400,{ok:false,error:'INVALID_REQUEST'});
        if(req.method==='POST'&&b.action==='save')store.write('schedule-'+month+'.json',b.data);
        const data=store.read('schedule-'+month+'.json',null);return send(200,{ok:true,found:!!data,data,month,schemaVersion:1});
      }
      return send(404,{ok:false});
    }
    // Serve synthetic auth assets; never read repository auth configuration.
    if(url.pathname==='/auth-config.js'){res.setHeader('Content-Type','text/javascript');return res.end('window.CLINIC_AUTH_CONFIG={};');}
    if(url.pathname==='/auth-gate.js'){res.setHeader('Content-Type','text/javascript');return res.end(`window.AuthGate={isAuthenticated:()=>false,verifyPassword:async()=>{await fetch('/api/auth',{method:'POST'});return true;},logout:()=>location.reload()};`);}
    const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!allowed.has(file))return send(404,{ok:false});
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');
    let data=fs.readFileSync(path.join(__dirname,'..',file));
    if(file==='index.html')data=Buffer.from(data.toString().replace('<body class=', '<body data-environment="MOCK" class=').replace('<div id="root">','<div style="background:#fde047;text-align:center">MOCK 本機模擬 — 非正式官網；任意文字登入</div><div id="root">'));
    res.end(data);
  });
  return {server,store};
}
if(require.main===module){const root=process.argv[2];if(!root||!path.resolve(root).startsWith('/private/tmp/'))throw Error('Supply a /private/tmp/ MOCK data directory');const {server}=createHarness(root);const port=Number(process.argv[3]||4174);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local port');server.listen(port,'127.0.0.1',()=>console.log('MOCK only: http://127.0.0.1:'+port));}
module.exports={createHarness};
