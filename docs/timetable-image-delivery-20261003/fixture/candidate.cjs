// Offline fixture only. This is NOT an approved production fingerprint or CMS writer.
const {createHash}=require('node:crypto');
const SOURCE_SHA256='f2cf70f3b9e796fef2a7478fb9ddf1da3673c81e66cd9a3d01702dc40f6b703b';
const imageUrl='https://clinic-timetable-output.vercel.app/api/publish-image';
const group='<div id="timetable-images">\n<img src="/upload/未命名(1).png" alt="晉安門診表">\n<img src="/upload/未命名1.png" alt="毅安門診表">\n</div>';
function candidate(html,{neutralText=false}={}) {
 if(createHash('sha256').update(html).digest('hex')!==SOURCE_SHA256 || html.split(group).length!==2)throw Error('FIXTURE_DRIFT');
 let result=html.replace(group,'<div id="timetable-images">\n<img src="'+imageUrl+'" alt="晉安與毅安醫師門診表" width="2160" height="3840" style="display:block;width:100%;max-width:1080px;height:auto">\n</div>');
 // Separate, explicitly unapproved text proposal, never the default image-only diff.
 if(neutralText)result=result.replaceAll('１１５年10月醫師門診表','醫師門診表');
 return result;
}
module.exports={candidate,imageUrl,SOURCE_SHA256};
