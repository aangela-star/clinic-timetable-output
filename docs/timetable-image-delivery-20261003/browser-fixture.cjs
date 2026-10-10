// Requires only preinstalled local dependencies; never contacts a live website.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const deps=process.argv[2];if(!deps)throw Error('Pass existing node_modules directory');
const {chromium}=require(path.join(deps,'playwright'));
const sharp=require(path.join(deps,'sharp'));
const dir=__dirname,fixture=path.join(dir,'fixture');
(async()=>{
 // Synthetic geometry/readability specimen; no physicians, clinic hours or patient facts.
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="2160" height="3840"><rect width="2160" height="3840" fill="#fff"/><rect x="60" y="60" width="2040" height="1800" fill="#d9efe9"/><rect x="60" y="1980" width="2040" height="1800" fill="#dfebf8"/><g font-family="sans-serif" font-size="100" fill="#193747" text-anchor="middle"><text x="1080" y="300">SYNTHETIC POSTER</text><text x="1080" y="520">TOP PANEL — NO CLINIC FACTS</text><text x="1080" y="2200">SYNTHETIC POSTER</text><text x="1080" y="2420">BOTTOM PANEL — NO CLINIC FACTS</text></g></svg>';
 const png=await sharp(Buffer.from(svg)).png().toBuffer();fs.writeFileSync(path.join(fixture,'synthetic-poster.png'),png);
 // Standalone offline preview intentionally uses local synthetic bytes.
 const candidate=fs.readFileSync(path.join(fixture,'candidate.html'),'utf8');
 const preview=candidate.replace('https://clinic-timetable-output.vercel.app/api/publish-image','synthetic-poster.png');
 fs.writeFileSync(path.join(fixture,'preview.html'),preview);
 const browser=await chromium.launch();
 try{
  for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
   const ctx=await browser.newContext({viewport,isMobile:device==='mobile',hasTouch:device==='mobile'});
   let external=0;await ctx.route(/^https?:/,route=>{external++;return route.abort();});
   const page=await ctx.newPage();await page.goto(pathToFileURL(path.join(fixture,'preview.html')).href);
   await page.locator('img').evaluate(i=>i.decode());
   assert.deepEqual(await page.locator('img').evaluate(i=>[i.naturalWidth,i.naturalHeight]),[2160,3840]);
   const box=await page.locator('img').boundingBox();assert.ok(Math.abs(box.width/box.height-1080/1920)<0.001);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.equal(await page.locator('#notice').textContent(),'SYNTHETIC NOTICE — 原公告需以正式備份逐字保留');
   assert.equal(await page.locator('#booking').getAttribute('href'),'#synthetic-booking');assert.equal(external,0);
   await page.screenshot({path:path.join(dir,device+'.png'),fullPage:true});
   console.log(device+' PASS: decoded 2160x3840; proportional; no overflow; preserved notice/link; zero external requests');
   await ctx.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
