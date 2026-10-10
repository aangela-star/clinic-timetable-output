'use strict';
// Offline evidence only. No CMS adapter, transport, or accepted production candidate.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const contract=JSON.parse(fs.readFileSync(path.join(__dirname,'realhtml-contract.json'),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
function proposeTwoOnly(bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length!==contract.baselineBytes||sha(bytes)!==contract.baselineSha256)throw Error('REALHTML_BASELINE_DRIFT');
  if(sha(bytes.subarray(contract.start,contract.end))!==contract.groupSha256)throw Error('REALHTML_GROUP_DRIFT');
  return Buffer.concat([bytes.subarray(0,contract.start),Buffer.from(contract.replacement),bytes.subarray(contract.end)]);
}
module.exports={contract,sha,proposeTwoOnly};
