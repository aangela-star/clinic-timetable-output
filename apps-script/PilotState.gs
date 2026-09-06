// Single controlled Jinan pilot. No leases, expiry, reset, delete or automatic
// recovery: every uncertain dispatch remains blocked across instances/restarts.
const PILOT_STATE_KEY = 'JINAN_PILOT_STATE_V1';
const PILOT_BACKUP_SHEET = 'JinanPilotBackup';
const PILOT_BACKUP_HEADERS = ['attempt_id', 'chunk_index', 'backup_base64'];
function pilotFail_(code) { const error = new Error(code); error.code = code; throw error; }
function pilotHash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function pilotState_(body) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('JINAN_PILOT_STATE_ENABLED') !== 'true') pilotFail_('PILOT_DISABLED');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) pilotFail_('PILOT_LOCK_TIMEOUT');
  try {
    const raw = props.getProperty(PILOT_STATE_KEY);
    const state = raw ? JSON.parse(raw) : null;
    if (body.op === 'read') return { ok: true, state: state };
    if (body.op === 'backup') {
      if (!state || body.attemptId !== state.attemptId || state.phase === 'PREPARING') pilotFail_('PILOT_BACKUP_UNAVAILABLE');
      return { ok: true, backupJson: pilotReadBackup_(state) };
    }
    if (body.op === 'prepare') {
      if (state) pilotFail_('PILOT_ALREADY_RESERVED');
      if (!/^[a-f0-9-]{36}$/.test(body.attemptId || '') || !/^[a-f0-9]{64}$/.test(body.pngSha256 || '')) pilotFail_('PILOT_INVALID_REQUEST');
      if (typeof body.backupJson !== 'string' || body.backupJson.length > 2000000 || pilotHash_(body.backupJson) !== body.backupSha256) pilotFail_('PILOT_BACKUP_INVALID');
      const data = JSON.parse(body.backupJson);
      if (data.targetPage !== 'https://www.tainanrehab.com/time.html' || typeof data.originalImageHtml !== 'string'
          || typeof data.note !== 'string' || typeof data.publicHtml !== 'string' || typeof data.imageBase64 !== 'string'
          || typeof data.originalSrc !== 'string' || typeof data.originalStyle !== 'string'
          || !/^https:\/\/www\.tainanrehab\.com\/upload\//.test(data.imageUrl || '')
          || !/^[a-f0-9]{64}$/.test(data.imageSha256 || '')) pilotFail_('PILOT_BACKUP_INVALID');
      const originalBytes = Utilities.base64Decode(data.imageBase64);
      const imageHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, originalBytes)
        .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
      if (!originalBytes.length || imageHash !== data.imageSha256) pilotFail_('PILOT_BACKUP_INVALID');
      const next = { attemptId: body.attemptId, phase: 'PREPARING', pngSha256: body.pngSha256,
        backupSha256: body.backupSha256, backupStart: 0, backupCount: 0 };
      // Reservation precedes sheet creation/write: interrupted preparation blocks.
      props.setProperty(PILOT_STATE_KEY, JSON.stringify(next));
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) pilotFail_('BOUND_SPREADSHEET_NOT_FOUND');
      let sheet = ss.getSheetByName(PILOT_BACKUP_SHEET);
      if (!sheet) { sheet = ss.insertSheet(PILOT_BACKUP_SHEET); sheet.getRange(1, 1, 1, 3).setValues([PILOT_BACKUP_HEADERS]); }
      if (sheet.getRange(1, 1, 1, 3).getValues()[0].join('|') !== PILOT_BACKUP_HEADERS.join('|')) pilotFail_('PILOT_BACKUP_HEADERS');
      const encoded = Utilities.base64Encode(body.backupJson, Utilities.Charset.UTF_8);
      const rows = [];
      for (let i = 0; i < encoded.length; i += 30000) rows.push([body.attemptId, String(rows.length), encoded.slice(i, i + 30000)]);
      next.backupStart = sheet.getLastRow() + 1;
      next.backupCount = rows.length;
      sheet.getRange(next.backupStart, 1, rows.length, 3).setNumberFormat('@').setValues(rows);
      SpreadsheetApp.flush();
      pilotReadBackup_(next);
      next.phase = 'PREPARED';
      props.setProperty(PILOT_STATE_KEY, JSON.stringify(next));
      return { ok: true, state: next };
    }
    if (body.op === 'advance') {
      if (!state || body.attemptId !== state.attemptId || body.expected !== state.phase) pilotFail_('PILOT_STATE_CONFLICT');
      const transitions = { PREPARED: 'UPLOAD_DISPATCHED', UPLOAD_DISPATCHED: 'UPLOADED', UPLOADED: 'SUBMIT_DISPATCHED', SUBMIT_DISPATCHED: 'VERIFIED' };
      if (!Object.prototype.hasOwnProperty.call(transitions, state.phase) || transitions[state.phase] !== body.next) pilotFail_('PILOT_STATE_CONFLICT');
      if (body.next === 'UPLOAD_DISPATCHED' || body.next === 'SUBMIT_DISPATCHED') pilotReadBackup_(state);
      if (body.next === 'UPLOADED') {
        if (!/^\/upload\/[A-Za-z0-9_.%()-]+\.png$/.test(body.imagePath || '') || /%2e|%2f|%5c/i.test(body.imagePath)) pilotFail_('PILOT_INVALID_REQUEST');
        state.imagePath = body.imagePath;
      }
      state.phase = body.next;
      props.setProperty(PILOT_STATE_KEY, JSON.stringify(state));
      return { ok: true, state: state };
    }
    pilotFail_('PILOT_INVALID_REQUEST');
  } finally { lock.releaseLock(); }
}
function pilotReadBackup_(state) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PILOT_BACKUP_SHEET);
  if (!sheet || !state.backupCount || state.backupStart < 2) pilotFail_('PILOT_BACKUP_UNAVAILABLE');
  const rows = sheet.getRange(state.backupStart, 1, state.backupCount, 3).getValues();
  const encoded = rows.map(function (row, i) {
    if (String(row[0]) !== state.attemptId || String(row[1]) !== String(i)) pilotFail_('PILOT_BACKUP_CORRUPT');
    return String(row[2]);
  }).join('');
  const json = Utilities.newBlob(Utilities.base64Decode(encoded)).getDataAsString('UTF-8');
  if (pilotHash_(json) !== state.backupSha256) pilotFail_('PILOT_BACKUP_CORRUPT');
  return json;
}
