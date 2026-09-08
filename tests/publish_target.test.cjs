const test=require('node:test'),assert=require('node:assert/strict');
const {targetFingerprint:f}=require('../lib/publish-target');
const page='https://example.invalid/time.html',image='https://example.invalid/poster.png';
const img='<img src="/poster.png" class="poster large" style="width:675px;height:1200px" alt="A &amp; B">';
const wrap=s=>'<html><body><main id="schedule"><div class="slot">'+s+'</div></main><footer>News</footer></body></html>';
const pin=f(wrap(img),page,image);
for(const [label,html] of Object.entries({
 'announcement and footer':wrap(img).replace('News','Changed news <img src="/other.png">'),
 'unrelated picture':wrap(img).replace('News','<picture><source srcset="/other.png 2x"><img src="/other.png"></picture>'),
 'unrelated template svg':wrap(img).replace('News','<template><div>text</div></template><svg><path d="x" /></svg>'),
 'comment false target':wrap(img)+'<!-- <img src="/poster.png"> -->',
 'raw text false targets':wrap(img).replace('News','<script>const x=\'<img src="/poster.png">\';</script><style>.x{content:"<img>"}</style><textarea><img src="/poster.png"></textarea>'),
 'attribute semantics':wrap(img.replace('src="/poster.png" class="poster large"','CLASS="poster  large" SRC="https://example.invalid/poster.png"').replace('&amp;','&#38;')),
 'unquoted URL':wrap(img.replace('src="/poster.png"','src=/poster.png')),
}))test('target fingerprint tolerates '+label,()=>assert.equal(f(html,page,image),pin));
for(const [label,html] of Object.entries({
 'target removal':wrap(''), 'changed src':wrap(img.replace('/poster.png','/other.png')),
 'duplicate':wrap(img+img), 'duplicate attribute':wrap(img.replace('src=', 'SRC="/other.png" src=')),
 'base':wrap(img)+'<base href="/">', 'picture target':wrap('<picture>'+img+'</picture>'),
 'template target':wrap('<template>'+img+'</template>'), 'svg target':wrap('<svg>'+img+'</svg>'),
 'noscript target':wrap('<noscript>'+img+'</noscript>'), 'srcset':wrap(img.replace('src=','srcset="/other.png 2x" src=')),
 'other source aliases target':wrap(img)+'<picture><source srcset="/poster.png 2x"></picture>',
 'data src':wrap(img.replace('src=','data-src="/other.png" src=')),
 'event':wrap(img.replace('src=','onload="go()" src=')),
 'usemap':wrap(img.replace('src=','usemap="#map" src=')),
 'encoded style url':wrap(img.replace('width:675px','background:&#117;rl(x)')),
 'escaped style':wrap(img.replace('width:675px','background:u\\72l(x)')),
 'unbalanced':wrap(img).replace('</main>',''),
 'misnested p':wrap('<p><div>'+img+'</div></p>'),
 'implicit tbody':wrap('<table><tr><td>'+img+'</td></tr></table>'),
 'foster parenting':wrap('<table>'+img+'</table>'),
 'nested button':wrap('<button><button>'+img+'</button></button>'),
 'quoted greater than':wrap(img.replace('A &amp; B','A > B')),
 'unknown entity':wrap(img.replace('&amp;','&unknown;')),
 'raw target only':wrap('<script>'+img+'</script>'),
 'comment target only':wrap('<!-- '+img+' -->'),
 'script escaped state':wrap(img)+'<script><!-- <script></script>',
 'ancestor hidden':wrap(img).replace('id="schedule"','hidden'),
 'unclosed quote':wrap(img.replace('alt="A &amp; B"','alt="oops')),
}))test('target scanner rejects '+label,()=>assert.throws(()=>f(html,page,image),/PUBLIC_BASELINE_DRIFT/));
for(const [label,html] of Object.entries({
 'moved context':wrap(img).replace('class="slot"','class="another"'),
 'changed style whitespace string':wrap(img.replace('width:675px','width: 675px')),
 'ancestor style':wrap(img).replace('id="schedule"','id="schedule" style="display:none"'),
}))test('fingerprint changes on '+label,()=>assert.notEqual(f(html,page,image),pin));
for(const html of [wrap(img)+'<image src="/poster.png">',wrap(img).replace('<footer>News</footer>','</body><body>'),wrap('<h1><h2>'+img+'</h2></h1>'),wrap('<dl><dt><dd>'+img+'</dd></dt></dl>')])test('additional browser repair ambiguity rejected',()=>assert.throws(()=>f(html,page,image)));
test('non-ASCII class whitespace is significant',()=>assert.notEqual(f(wrap(img.replace('poster large','\u00a0poster large')),page,image),pin));
for(const html of [wrap(img.replace('&amp;','&aMp;')),wrap(img)+'<script>x</script ignored>',wrap('<svg><div>foreign breakout</div></svg>'+img),wrap(img).replace('<body>','text<body>')])test('semantic normalization ambiguity fails closed',()=>assert.throws(()=>f(html,page,image)));
test('common semantic ancestor attributes are supported and pinned',()=>{
 const html=wrap(img).replace('<html>','<html lang="zh-Hant" dir="ltr">');
 const a=f(html,page,image);assert.notEqual(a,pin);
 assert.equal(f(html.replace('lang="zh-Hant" dir="ltr"','DIR="ltr" LANG="zh-Hant"'),page,image),a);
 assert.notEqual(f(html.replace('dir="ltr"','dir="rtl"'),page,image),a);
});
test('document mode is pinned and ambiguous doctypes rejected',()=>{
 assert.notEqual(f('<!DOCTYPE html>'+wrap(img),page,image),pin);
 for(const prefix of ['<!DOCTYPE html\u00a0>','<!DOCTYPE html><!DOCTYPE html>'])assert.throws(()=>f(prefix+wrap(img),page,image));
 assert.throws(()=>f(wrap(img)+'<noscript>unrelated scripting-dependent content</noscript>',page,image));
});
