'use strict';
const { createHash, randomUUID } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
// Only injected transport. Deployment/provisioning and live calls are separate gates.
function createPilotStore({ request, secret, attemptId = randomUUID() }) {
  if (typeof request !== 'function' || typeof secret !== 'string' || !secret) throw new Error('PILOT_STORE_CONFIG');
  const call = async fields => {
    const result = await request({ action: 'jinanPilotState', secret, ...fields });
    if (!result?.ok) throw new Error('PILOT_STORE_FAILED');
    return result;
  };
  return {
    read: async () => {
      const result = await call({ op: 'read' });
      if (!Object.prototype.hasOwnProperty.call(result, 'state') || (result.state !== null
          && (!result.state || !['PREPARING', 'PREPARED', 'UPLOAD_DISPATCHED', 'UPLOADED', 'SUBMIT_DISPATCHED', 'VERIFIED'].includes(result.state.phase)))) {
        throw new Error('PILOT_STATE_INVALID');
      }
      return result.state;
    },
    prepare: async ({ backup, originalImageHtml, originalSrc, originalStyle, pngSha256 }) => {
      const backupJson = JSON.stringify({ targetPage: 'https://www.tainanrehab.com/time.html',
        originalImageHtml, originalSrc, originalStyle, note: backup.note, publicHtml: backup.publicHtml,
        imageUrl: backup.imageUrl, imageBase64: backup.bytes.toString('base64'),
        imageSha256: backup.imageSha256, contentType: backup.contentType });
      if (hash(backup.bytes) !== backup.imageSha256) throw new Error('PILOT_BACKUP_INVALID');
      const result = await call({ op: 'prepare', attemptId, pngSha256, backupJson, backupSha256: hash(backupJson) });
      if (result.state?.phase !== 'PREPARED' || result.state.attemptId !== attemptId || result.state.backupSha256 !== hash(backupJson) || result.state.pngSha256 !== pngSha256) throw new Error('PILOT_BACKUP_INVALID');
      const recovered = await call({ op: 'backup', attemptId });
      if (recovered.backupJson !== backupJson) throw new Error('PILOT_BACKUP_INVALID');
    },
    advance: async (expected, next, imagePath) => {
      const result = await call({ op: 'advance', attemptId, expected, next, imagePath });
      if (result.state?.attemptId !== attemptId || result.state.phase !== next) throw new Error('PILOT_STATE_CONFLICT');
    },
    // Authorized server-side export; contains old public data, never CMS credentials.
    recover: async id => JSON.parse((await call({ op: 'backup', attemptId: id })).backupJson),
  };
}
module.exports = { createPilotStore };
