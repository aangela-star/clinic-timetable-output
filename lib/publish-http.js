// Bound streamed upstream bodies before buffering them. No request retries here.
async function readBounded(response,limit) {
  const declared=Number(response.headers?.get('content-length'));
  if(Number.isFinite(declared)&&declared>limit)throw Error('UPSTREAM_TOO_LARGE');
  if(!response.body?.getReader) {
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>limit)throw Error('UPSTREAM_TOO_LARGE');return bytes;
  }
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('UPSTREAM_TOO_LARGE');chunks.push(Buffer.from(value));}
    return Buffer.concat(chunks,size);
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
}
module.exports={readBounded};
