// Conservative static HTML subset, NOT an HTML5/browser-equivalent parser.
// Explicit nesting only; no implied ends, foster parenting, scripting DOM or CSS
// analysis. Human review of the real page remains mandatory before Stage 3.
const {createHash}=require('node:crypto');
const fail=()=>{throw Error('PUBLIC_BASELINE_DRIFT');};
const space=c=>/[\t\n\f\r ]/.test(c||'');
const voids=new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const raw=new Set(['script','style','textarea','title']);
const blocked=new Set(['picture','template','svg','math','noscript','select','object','iframe']);
const contextAttrs=new Set(['id','class','style','lang','dir','title','role','aria-label','aria-labelledby','aria-hidden']);
const blocks=new Set('address article aside blockquote div dl fieldset footer form h1 h2 h3 h4 h5 h6 header hr main nav ol p pre section table ul'.split(' '));
function decode(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);|&/gi,(all,entity)=>{
    if(!entity)fail();
    if(entity[0]!=='#'){const named={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'};if(!Object.hasOwn(named,entity))fail();return named[entity];}
    const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
    if(n<32||n>0x10ffff||(n>=0x7f&&n<=0x9f)||(n>=0xd800&&n<=0xdfff))fail();
    return String.fromCodePoint(n);
  });
}
function targetFingerprint(html,pageUrl,imageUrl) {
  if(typeof html!=='string'||Buffer.byteLength(html)>1000000||/[\u0000\ufffd]/.test(html))fail();
  const stack=[],targets=[],singletons=new Set();let i=0,doctype=false,seenToken=false;
  const supported=new Set(('html head body title style script textarea address article aside blockquote div dl dt dd fieldset legend footer form h1 h2 h3 h4 h5 h6 header main nav ol li p pre section ul a abbr b bdi bdo br button cite code data del details dfn dialog em figure figcaption hr i img input ins kbd label link mark meta meter optgroup option output picture progress q rp rt ruby s samp select small source span strong sub summary sup table caption col colgroup tbody td tfoot th thead time tr u var wbr video audio track canvas template svg math path g circle rect line polygon polyline ellipse defs symbol use text noscript area embed param').split(' '));
  const canonical=(node,target=false)=>[node.name,Object.keys(node.attrs).sort().filter(k=>target||contextAttrs.has(k)).map(k=>{
    let v=decode(node.attrs[k]);
    // Only class token whitespace is semantically collapsible. Preserve all other
    // value whitespace (including CSS strings); normalize URL via the URL parser.
    if(k==='class')v=v.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g,'').split(/[\t\n\f\r ]+/).join(' ');
    if(target&&k==='src')v=new URL(v,pageUrl).href;
    return [k,v];
  })];
  while(i<html.length) {
    if(html[i]!=='<'){const end=html.indexOf('<',i);const text=html.slice(i,end<0?html.length:end);if(/[^\t\n\f\r ]/.test(text)&&(['html','head'].includes(stack.at(-1)?.name)||(singletons.has('html')&&!stack.length)))fail();if(stack.some(n=>['table','tbody','thead','tfoot','tr'].includes(n.name))&&!stack.some(n=>['td','th'].includes(n.name))&&/[^\t\n\f\r ]/.test(text))fail();i=end<0?html.length:end;continue;}
    if(html.startsWith('<!--',i)){const end=html.indexOf('-->',i+4);if(end<0||/--|<!/.test(html.slice(i+4,end)))fail();i=end+3;continue;}
    if(/^<!doctype html[\t\n\f\r ]*>/i.test(html.slice(i))){if(doctype||seenToken)fail();doctype=true;i+=html.slice(i).match(/^<!doctype html[\t\n\f\r ]*>/i)[0].length;continue;}
    seenToken=true;
    i++;const closing=html[i]==='/';if(closing)i++;
    const start=i;while(/[a-z0-9-]/i.test(html[i]||''))i++;
    const name=html.slice(start,i).toLowerCase();if(!/^[a-z][a-z0-9-]*$/.test(name))fail();
    const attrs=Object.create(null);let self=false;
    for(;;){const hadSpace=space(html[i]);while(space(html[i]))i++;if(html[i]==='>'){i++;break;}if(html[i]==='/'&&html[i+1]==='>'){self=true;i+=2;break;}if(closing||!hadSpace||i>=html.length)fail();
      const a=i;while(/[^\t\n\f\r />="'<`]/.test(html[i]||'')&&i<html.length)i++;
      const key=html.slice(a,i).toLowerCase();if(!key||Object.hasOwn(attrs,key)||!/^[a-z_:][a-z0-9_:.-]*$/.test(key))fail();
      while(space(html[i]))i++;let value='';
      if(html[i]==='='){i++;while(space(html[i]))i++;const quote=html[i];if(quote==='"'||quote==="'"){i++;const v=i;while(i<html.length&&html[i]!==quote)i++;if(i===html.length)fail();value=html.slice(v,i++);if(/[<>]/.test(value))fail();}else{const v=i;while(i<html.length&&!space(html[i])&&html[i]!=='>')i++;value=html.slice(v,i);if(!value||/["'<=`]/.test(value))fail();}}
      attrs[key]=value;
    }
    if(name==='base'||name==='noscript')fail();
    if(closing){if(self||voids.has(name)||stack.pop()?.name!==name)fail();continue;}
    if(!supported.has(name))fail();
    if(['html','head','body'].includes(name)){if(singletons.has(name))fail();singletons.add(name);}
    if(singletons.has('html')&&!stack.length&&name!=='html')fail();
    const foreign=stack.some(n=>['svg','math'].includes(n.name));
    if(foreign&&!['svg','math','path','g','circle','rect','line','polygon','polyline','ellipse','defs','symbol','use','text'].includes(name))fail();
    if(self&&!voids.has(name)&&!foreign&&name!=='svg'&&name!=='math')fail();
    // Reject browser tree-repair cases rather than infer an HTML5 tree.
    const parent=stack.at(-1)?.name;
    if(parent==='html'&&!['head','body'].includes(name))fail();
    if(parent==='head'&&!['title','style','script','meta','link'].includes(name))fail();
    if(name==='body'&&stack.some(n=>n.name==='body'))fail();
    if((['dt','dd'].includes(name)&&stack.some(n=>['dt','dd'].includes(n.name)))||(/^h[1-6]$/.test(name)&&stack.some(n=>/^h[1-6]$/.test(n.name))))fail();
    if((blocks.has(name)&&stack.some(n=>n.name==='p'))||(['a','button','form','li','dt','dd','option','h1','h2','h3','h4','h5','h6'].includes(name)&&stack.some(n=>n.name===name)))fail();
    const parents={thead:['table'],tbody:['table'],tfoot:['table'],tr:['thead','tbody','tfoot'],td:['tr'],th:['tr'],colgroup:['table'],col:['colgroup']};
    if(parents[name]&&!parents[name].includes(parent))fail();
    if(['table','thead','tbody','tfoot','tr','colgroup'].includes(parent)&&!({table:['thead','tbody','tfoot','caption','colgroup'],thead:['tr'],tbody:['tr'],tfoot:['tr'],tr:['td','th'],colgroup:['col']}[parent].includes(name)))fail();
    if((name==='html'&&stack.length)||(name==='head'&&parent!=='html')||(name==='body'&&parent!=='html'))fail();
    const node={name,attrs};
    if(name==='img'||name==='source') {
      const src=attrs.src===undefined?null:new URL(decode(attrs.src),pageUrl).href;
      // Alternate-source lists on unrelated images are allowed only when none
      // could name the protected URL. Complex/ambiguous lists fail closed.
      for(const key of ['srcset','data-srcset'])if(attrs[key]!==undefined){
        const list=decode(attrs[key]);
        for(const part of list.split(',')){const tokens=part.trim().split(/\s+/);if(!tokens[0]||tokens.length>2||(tokens[1]&&!/^\d+(?:\.\d+)?[wx]$/.test(tokens[1])))fail();if(new URL(tokens[0],pageUrl).href===imageUrl)fail();}
      }
      if(attrs['data-src']!==undefined&&new URL(decode(attrs['data-src']),pageUrl).href===imageUrl)fail();
      if(src===imageUrl){
        if(name!=='img'||stack.some(n=>blocked.has(n.name)||n.name==='head'))fail();
        // Explicit small static target attribute contract: unknown attrs require
        // review, so lazy loaders/events/responsive sources cannot silently pass.
        if(Object.keys(attrs).some(k=>!['src','id','class','style','alt','title','width','height','loading','decoding','fetchpriority'].includes(k)))fail();
        const style=decode(attrs.style||'');if(/\\|\/\*|url\s*\(|image\s*\(|image-set|content\s*:/i.test(style))fail();
        if(stack.some(n=>Object.keys(n.attrs).some(k=>!contextAttrs.has(k))))fail();
        const context=stack.slice(-4).map(n=>canonical(n));
        const record=JSON.stringify([doctype?'html-doctype':'no-doctype',canonical(node,true),context]);if(Buffer.byteLength(record)>16384)fail();targets.push(record);
      }
    }
    if(raw.has(name)){
      const end=new RegExp('</'+name+'(?=[\\t\\n\\f\\r />])','ig');end.lastIndex=i;const match=end.exec(html);if(!match)fail();
      const tail=html.slice(end.lastIndex).match(/^[\t\n\f\r ]*>/);if(!tail)fail();
      end.lastIndex+=tail[0].length;
      // Script escaped/double-escaped states are outside this subset.
      if(name==='script'&&/<!--|<script/i.test(html.slice(i,match.index)))fail();
      i=end.lastIndex;continue;
    }
    if(['plaintext','xmp','iframe','noembed','noframes'].includes(name))fail();
    if(!voids.has(name)&&!self)stack.push(node);
    if(stack.length>128)fail();
  }
  if(stack.length||targets.length!==1)fail();
  return createHash('sha256').update(targets[0]).digest('hex');
}
module.exports={targetFingerprint};
