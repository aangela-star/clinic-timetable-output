/* Shared synchronous transaction engine. Caller MUST hold the durable store lock.
 * saveJob must flush before savePointer; pointer is one atomic record. */
function publishStoreOperation(io, op, input) {
  if (!['pointer','prepare','confirm','reconcile'].includes(op)) throw Error('INVALID_REQUEST');
  const pointer = io.pointer();
  if (pointer.targetPointerId !== 'jinan-website/current' || !Number.isSafeInteger(pointer.pointerVersion) || pointer.pointerVersion < 0 || pointer.pointerVersion >= Number.MAX_SAFE_INTEGER || typeof pointer.pointerEtag !== 'string' || !pointer.pointerEtag) throw Error('INVALID_BASELINE');
  if (op === 'pointer') return pointer;
  if (op === 'prepare') {
    if (input.targetPointerId !== 'jinan-website/current' || !input.session || !input.executorId) throw Error('INVALID_REQUEST');
    if (input.baseline.pointerVersion !== pointer.pointerVersion || input.baseline.pointerEtag !== pointer.pointerEtag || input.baseline.pngSha256 !== pointer.pngSha256) return {status:'STALE_BASELINE'};
    const approvalId = io.random();
    const job = Object.assign({}, input, {approvalId, nonce:io.random(), expiresAt:io.now()+300000, status:'PREPARED'});
    job.blobId = io.stage(input.pngBase64, input.pngSha256, input.monthKey);
    delete job.pngBase64;
    io.saveJob(job);
    return {status:'PREPARED', approvalId, nonce:job.nonce, pngSha256:job.pngSha256, baseline:job.baseline, targetPointerId:job.targetPointerId, executorId:job.executorId, confirmedBySession:job.session, expiresAt:job.expiresAt};
  }
  const job = io.job(input.approvalId);
  if (!job || job.session !== input.session || job.nonce !== input.nonce || job.executorId !== input.executorId) return {status:'INVALID_APPROVAL'};
  if (op === 'reconcile' || job.status !== 'PREPARED') return {status:'RECONCILE', job, pointer};
  if (op !== 'confirm') throw Error('INVALID_REQUEST');
  if (job.expiresAt < io.now()) return {status:'EXPIRED_APPROVAL'};
  if (job.baseline.pointerVersion !== pointer.pointerVersion || job.baseline.pointerEtag !== pointer.pointerEtag || job.baseline.pngSha256 !== pointer.pngSha256) return {status:'STALE_BASELINE'};
  if (io.hashBlob(job.blobId) !== job.pngSha256) return {status:'INVALID_PNG'};
  // Durable intent BEFORE mutation. Any restart after this point reconciles only.
  job.status = 'MUTATING';
  io.saveJob(job);
  const next = {pointerVersion:pointer.pointerVersion+1, pointerEtag:io.random(), blobId:job.blobId, pngSha256:job.pngSha256, approvalId:job.approvalId, nonce:job.nonce, targetPointerId:job.targetPointerId};
  io.savePointer(next);
  job.status = 'CONSUMED';
  io.saveJob(job);
  return {status:'RECONCILE', job, pointer:next};
}
if (typeof module !== 'undefined') module.exports = {publishStoreOperation};
