// Offline observation only: no hash here represents approval.
const fs=require('node:fs'),path=require('node:path');
const {targetFingerprint:f}=require('../../lib/publish-target');
const c=require('./realhtml-contract.json'),dir=__dirname;
const raw=fs.readFileSync(path.join(dir,'real-public.html'),'utf8');
const proposal=fs.readFileSync(path.join(dir,'proposal-two-preserve-third.NOT-APPROVABLE.html'),'utf8');
const mock='https://mock.invalid/poster.png',first=c.images[4].raw.match(/src="([^"]+)"/)[1];
const three=raw.replace(first,mock),two=proposal.replace(c.imageUrl,mock);
const cases={three,two,threeWithProposalStyle:three.replace('<img alt="" src="'+mock+'" />','<img alt="" src="'+mock+'" style="max-width:100%;height:auto;" />'),changedMonth:three.replaceAll('10月','11月'),swappedOtherImages:three.replace(c.images[5].raw,'SWAP').replace(c.third.raw,c.images[5].raw).replace('SWAP',c.third.raw),changedBreaks:three.replace(c.images[4].raw.replace(first,mock)+'<br />',c.images[4].raw.replace(first,mock)+'<br /><br />')};
fs.writeFileSync(path.join(dir,'three-images.MOCK-ONLY.html'),three);
fs.writeFileSync(path.join(dir,'comparisons.json'),JSON.stringify(Object.fromEntries(Object.entries(cases).map(([k,v])=>[k,f(v,c.pageUrl,mock)])),null,2)+'\n');
