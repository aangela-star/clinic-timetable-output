'use strict';
const zlib=require('node:zlib');
const {PAGE,hash,imagePath}=require('./publish-job-validation');
async function getBytes(url,fetchImpl=fetch){
 const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache'}});
 if(!r.ok)throw Error('PUBLIC_READ_FAILED');
 const parts=[];let size=0;
 for await(const chunk of r.body){size+=chunk.length;if(size>4*1024*1024)throw Error('PUBLIC_TOO_LARGE');parts.push(Buffer.from(chunk));}
 return Buffer.concat(parts);
}
function targetImage(html){
 const images=html.match(/<img\b[^>]*>/gi)||[];
 const targets=images.filter(x=>/style="width: 675px; height: 1200px;"/.test(x)&&/src="\/upload\//.test(x));
 if(targets.length!==1)throw Error('BASELINE_AMBIGUOUS');
 const src=/\bsrc="([^"]+)"/.exec(targets[0])?.[1];
 if(!imagePath(src))throw Error('BASELINE_AMBIGUOUS');
 return {src,html:targets[0]};
}
function dimensions(bytes){
 if(bytes.length<45||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('INVALID_IMAGE');
 let offset=8,d,channels,idat=[],ended=false,sawData=false;
 while(offset<bytes.length){
  const n=bytes.readUInt32BE(offset);if(n>bytes.length-offset-12)throw Error('INVALID_IMAGE');
  const kind=bytes.subarray(offset+4,offset+8).toString();let crc=0xffffffff;
  for(const byte of bytes.subarray(offset+4,offset+8+n)){crc^=byte;for(let k=0;k<8;k++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
  if(((crc^0xffffffff)>>>0)!==bytes.readUInt32BE(offset+8+n))throw Error('INVALID_IMAGE');
  if(offset===8){
   if(kind!=='IHDR'||n!==13||bytes[offset+16]!==8||![2,6].includes(bytes[offset+17])||bytes[offset+18]||bytes[offset+19]||bytes[offset+20])throw Error('INVALID_IMAGE');
   d={width:bytes.readUInt32BE(offset+8),height:bytes.readUInt32BE(offset+12)};channels=bytes[offset+17]===6?4:3;
   if(d.width!==675||d.height!==1200)throw Error('INVALID_IMAGE');
  }else if(kind==='IDAT'){idat.push(bytes.subarray(offset+8,offset+8+n));sawData=true;}
  else if(kind==='IEND'){if(n!==0||!sawData||offset+12!==bytes.length)throw Error('INVALID_IMAGE');ended=true;}
  else if(kind==='IHDR'||(!['PLTE'].includes(kind)&&kind[0]===kind[0].toUpperCase()))throw Error('INVALID_IMAGE');
  offset+=n+12;
 }
 if(!ended)throw Error('INVALID_IMAGE');
 const row=d.width*channels+1,expected=row*d.height;
 const inflated=zlib.inflateSync(Buffer.concat(idat),{maxOutputLength:expected+1,info:true});
 if(inflated.buffer.length!==expected||inflated.engine.bytesWritten!==Buffer.concat(idat).length)throw Error('INVALID_IMAGE');
 for(let i=0;i<expected;i+=row)if(inflated.buffer[i]>4)throw Error('INVALID_IMAGE');
 return d;
}
async function capture(fetchImpl=fetch){
 const page=await getBytes(PAGE,fetchImpl),target=targetImage(page.toString('utf8'));
 const image=await getBytes('https://www.tainanrehab.com'+encodeURI(target.src).replaceAll('#','%23'),fetchImpl);
 const d=dimensions(image);if(d.width!==675||d.height!==1200)throw Error('INVALID_IMAGE');
 return {page,image,target,baseline:{pageUrl:PAGE,imagePath:target.src,imageDimensions:d,imageBytes:image.length,imageSha256:hash(image),verifiedAt:new Date().toISOString(),requiresRevalidation:true}};
}
function matches(a,b){return ['pageUrl','imagePath','imageBytes','imageSha256'].every(k=>a[k]===b[k])&&a.imageDimensions.width===b.imageDimensions.width&&a.imageDimensions.height===b.imageDimensions.height;}
module.exports={capture,matches,targetImage,getBytes,dimensions};
