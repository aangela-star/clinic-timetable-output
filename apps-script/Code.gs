const SHEET_NAME = 'Schedules';
const LEGACY_HEADERS = ['month_key', 'data_json', 'schema_version', 'updated_at'];
const HEADERS = LEGACY_HEADERS;
const FINAL_HEADERS = [
  'version_id',
  'month_key',
  'version_date',
  'version_seq',
  'parent_version_id',
  'expected_latest_version_id',
  'save_request_id',
  'data_json',
  'schema_version',
  'saved_at',
];
const SCHEMA_VERSION = 1;
const SERVER_SECRET_PROPERTY = 'CLINIC_SERVER_SECRET';
const CURRENT_VERSION_PROPERTY = 'CURRENT_SCHEDULE_VERSION_ID';
const MIGRATION_STATE_PROPERTY = 'SCHEDULE_VERSION_MIGRATION_STATE';
const TIMEZONE = 'Asia/Taipei';
const MAX_ID_LENGTH = 128;
const MAX_SCHEDULE_DATA_JSON_LENGTH = 45000;
const CLINIC_IDENTITIES = {
  jinan: { ids: ['jinan', 'clinic-1'], name: '晉安復健科診所 醫師門診表' },
  yian: { ids: ['yian', 'clinic-2'], name: '毅安診所 醫師門診表' },
};

function doGet() {
  return json_({ ok: false, error: 'METHOD_NOT_ALLOWED' });
}

function doPost(e) {
  let lock;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    assertServerSecret_(body.secret);

    const action = String(body.action || '');
    if (action === 'load') return legacyLoad_(body);
    if (action === 'save') return legacySave_(body);
    if (action === 'saveVersion') return saveVersion_(body);
    if (action === 'loadCurrent') return loadCurrent_(body);
    if (action === 'loadLatestForMonth') return loadLatestForMonth_(body);
    if (action === 'listVersions') return listVersions_(body);
    if (action === 'loadVersion') return loadVersion_(body);
    if (action === 'setCurrentVersion') {
      const request = normalizeSetCurrentRequest_(body);
      lock = LockService.getScriptLock();
      if (!lock.tryLock(10000)) throw codedError_('SAVE_LOCK_TIMEOUT', '目前有另一筆門診資料正在儲存，請稍後再試。');
      return setCurrentVersionInsideLock_(request);
    }

    return json_({ ok: false, error: 'UNSUPPORTED_ACTION' });
  } catch (err) {
    return json_({ ok: false, error: err.code || 'REQUEST_FAILED', message: err.message || String(err) });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function legacyLoad_(body) {
  let lock;
  try {
    const monthKey = String(body.month || '');
    validateMonthKey_(monthKey);

    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw codedError_('SAVE_LOCK_TIMEOUT', '目前有另一筆門診資料正在儲存，請稍後再試。');
    assertNoMigrationState_();

    const sheet = getScheduleSheet_();
    ensureLegacyHeaders_(sheet, 'LEGACY_ACTION_UNAVAILABLE_AFTER_MIGRATION');
    const rows = findLegacyMonthRows_(sheet, monthKey);
    if (!rows.length) return json_({ ok: true, found: false, month: monthKey });

    const row = rows[rows.length - 1];
    const values = sheet.getRange(row, 1, 1, LEGACY_HEADERS.length).getValues()[0];
    const data = JSON.parse(values[1]);
    validateLegacyScheduleData_(data);
    assertMonthTitleMatch_(monthKey, data.title);

    return json_({
      ok: true,
      found: true,
      month: monthKey,
      schemaVersion: Number(values[2]) || SCHEMA_VERSION,
      data: data,
      updatedAt: isDate_(values[3]) ? values[3].toISOString() : String(values[3] || ''),
    });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function legacySave_(body) {
  let lock;
  try {
    const monthKey = String(body.month || '');
    validateMonthKey_(monthKey);
    validateLegacyScheduleData_(body.data);
    assertMonthTitleMatch_(monthKey, body.data.title);

    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw codedError_('SAVE_LOCK_TIMEOUT', '目前有另一筆門診資料正在儲存，請稍後再試。');
    assertNoMigrationState_();

    const sheet = getScheduleSheet_();
    ensureLegacyHeaders_(sheet, 'LEGACY_ACTION_UNAVAILABLE_AFTER_MIGRATION');
    const rows = findLegacyMonthRows_(sheet, monthKey);
    const row = rows.length ? rows[rows.length - 1] : sheet.getLastRow() + 1;
    const now = new Date();
    const values = [monthKey, JSON.stringify(body.data), SCHEMA_VERSION, now];

    sheet.getRange(row, 1).setNumberFormat('@');
    sheet.getRange(row, 1, 1, LEGACY_HEADERS.length).setValues([values]);

    for (let i = rows.length - 2; i >= 0; i -= 1) {
      sheet.deleteRow(rows[i]);
    }

    SpreadsheetApp.flush();
    return json_({ ok: true, month: monthKey, schemaVersion: SCHEMA_VERSION, updatedAt: now.toISOString() });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function saveVersion_(body) {
  const request = normalizeSaveVersionRequest_(body);
  let lock;
  try {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw codedError_('SAVE_LOCK_TIMEOUT', '目前有另一筆門診資料正在儲存，請稍後再試。');

    const sheet = getFinalScheduleSheet_();
    const rows = readFinalRows_(sheet);
    const existingReplay = findSaveRequest_(rows, request.saveRequestId);
    if (existingReplay) return replayOrReject_(existingReplay, request);

    if (request.parentVersionId && !findVersionById_(rows, request.parentVersionId)) {
      throw codedError_('PARENT_VERSION_NOT_FOUND', '找不到指定的來源版本。');
    }

    const latest = findLatestForMonth_(rows, request.monthKey);
    const latestId = latest ? latest.versionId : null;
    if (latestId !== request.expectedLatestVersionId) {
      return json_({
        ok: false,
        error: 'STALE_BASE',
        latestVersionId: latestId,
        actualLatestVersion: latest ? versionPayload_(latest, false) : null,
      });
    }

    const now = new Date();
    const versionDate = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd');
    const versionSeq = nextVersionSeq_(rows, request.monthKey, versionDate);
    const versionId = generateUniqueVersionId_(rows);
    const values = [
      versionId,
      request.monthKey,
      versionDate,
      versionSeq,
      request.parentVersionId || '',
      request.expectedLatestVersionId || '',
      request.saveRequestId,
      request.canonicalDataJson,
      request.schemaVersion,
      now,
    ];

    const appendRow = sheet.getLastRow() + 1;
    sheet.getRange(appendRow, 1, 1, FINAL_HEADERS.length).setValues([values]);
    SpreadsheetApp.flush();
    const saved = readFinalRows_(sheet).filter((row) => row.versionId === versionId)[0];
    if (!saved || !appendedVersionMatchesRequest_(saved, request, {
      versionId,
      versionDate,
      versionSeq,
      savedAt: now.toISOString(),
    })) {
      throw codedError_('VERSION_APPEND_VERIFY_FAILED', '版本寫入後驗證失敗。');
    }
    return json_({ ok: true, created: true, idempotentReplay: false, version: versionPayload_(saved, true) });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function loadCurrent_() {
  const sheet = getFinalScheduleSheet_();
  const rows = readFinalRows_(sheet);
  const versionId = PropertiesService.getScriptProperties().getProperty(CURRENT_VERSION_PROPERTY);
  if (!versionId) return json_({ ok: true, found: false, currentScheduleVersionId: null });
  const row = findVersionById_(rows, versionId);
  if (!row) return json_({ ok: false, error: 'CURRENT_VERSION_INVALID', currentVersionId: versionId, currentScheduleVersionId: versionId });
  return json_({ ok: true, found: true, currentVersionId: versionId, currentScheduleVersionId: versionId, version: versionPayload_(row, true) });
}

function loadLatestForMonth_(body) {
  const monthKey = String(body.monthKey || '');
  validateMonthKey_(monthKey);
  const sheet = getFinalScheduleSheet_();
  const row = findLatestForMonth_(readFinalRows_(sheet), monthKey);
  if (!row) return json_({ ok: true, found: false, monthKey: monthKey });
  return json_({ ok: true, found: true, version: versionPayload_(row, true) });
}

function listVersions_(body) {
  const monthKey = String(body.monthKey || '');
  validateMonthKey_(monthKey);
  const sheet = getFinalScheduleSheet_();
  const currentScheduleVersionId = PropertiesService.getScriptProperties().getProperty(CURRENT_VERSION_PROPERTY) || null;
  const rows = readFinalRows_(sheet).filter((row) => row.monthKey === monthKey);
  rows.sort((a, b) => rowOrder_(b) - rowOrder_(a));
  return json_({
    ok: true,
    monthKey: monthKey,
    currentVersionId: currentScheduleVersionId,
    currentScheduleVersionId: currentScheduleVersionId,
    versions: rows.map((row) => {
      const payload = versionPayload_(row, false);
      payload.isCurrent = row.versionId === currentScheduleVersionId;
      return payload;
    }),
  });
}

function loadVersion_(body) {
  const versionId = String(body.versionId || '');
  validateVersionId_(versionId);
  const sheet = getFinalScheduleSheet_();
  const row = findVersionById_(readFinalRows_(sheet), versionId);
  if (!row) return json_({ ok: false, error: 'VERSION_NOT_FOUND', versionId: versionId });
  return json_({ ok: true, found: true, version: versionPayload_(row, true) });
}

function setCurrentVersionInsideLock_(request) {
  const sheet = getFinalScheduleSheet_();
  const rows = readFinalRows_(sheet);
  const target = findVersionById_(rows, request.versionId);
  if (!target) throw codedError_('VERSION_NOT_FOUND', '找不到指定版本。');
  const properties = PropertiesService.getScriptProperties();
  const current = properties.getProperty(CURRENT_VERSION_PROPERTY) || null;
  if (current === request.versionId) {
    return json_({
      ok: true,
      changed: false,
      currentVersionId: current,
      currentScheduleVersionId: current,
      version: versionPayload_(target, false),
    });
  }
  if (current !== request.expectedCurrentVersionId) {
    return json_({ ok: false, error: 'CURRENT_VERSION_CHANGED', currentVersionId: current, currentScheduleVersionId: current });
  }
  properties.setProperty(CURRENT_VERSION_PROPERTY, request.versionId);
  const confirmed = properties.getProperty(CURRENT_VERSION_PROPERTY) || null;
  if (confirmed !== request.versionId) throw codedError_('CURRENT_VERSION_VERIFY_FAILED', '目前版本設定後驗證失敗。');
  return json_({
    ok: true,
    changed: true,
    currentVersionId: confirmed,
    currentScheduleVersionId: confirmed,
    version: versionPayload_(target, false),
  });
}

function normalizeSaveVersionRequest_(body) {
  const monthKey = String(body.monthKey || '');
  validateMonthKey_(monthKey);
  const saveRequestId = String(body.saveRequestId || '').trim();
  validateSaveRequestId_(saveRequestId);
  const parentVersionId = normalizeNullableVersionId_(body.parentVersionId);
  const expectedLatestVersionId = normalizeNullableVersionId_(body.expectedLatestVersionId);
  const schemaVersion = Number(body.schemaVersion || SCHEMA_VERSION);
  if (schemaVersion !== SCHEMA_VERSION) throw codedError_('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported schema version.');
  const data = normalizeScheduleData_(body.data, monthKey);
  const canonicalDataJson = canonicalJson_(data);
  if (canonicalDataJson.length > MAX_SCHEDULE_DATA_JSON_LENGTH) throw codedError_('SCHEDULE_PAYLOAD_TOO_LARGE', '門診資料過大，已停止儲存。');
  return {
    monthKey,
    schemaVersion,
    saveRequestId,
    parentVersionId,
    expectedLatestVersionId,
    data,
    canonicalDataJson,
  };
}

function normalizeSetCurrentRequest_(body) {
  const versionId = String(body.versionId || '').trim();
  validateVersionId_(versionId);
  return {
    versionId,
    expectedCurrentVersionId: normalizeNullableVersionId_(body.expectedCurrentVersionId),
  };
}

function normalizeScheduleData_(data, monthKey) {
  validateLegacyScheduleData_(data);
  assertMonthTitleMatch_(monthKey, data.title);
  const normalized = deepClone_(data);
  if (normalized.note == null) normalized.note = '';
  if (typeof normalized.note !== 'string') throw codedError_('INVALID_SCHEDULE_DATA', '門診資料格式不完整。');
  const seen = {};
  normalized.clinics = normalized.clinics.map((clinic) => {
    if (!clinic || typeof clinic !== 'object') throw codedError_('INVALID_CLINIC_IDENTITY', '門診身份格式不正確。');
    const id = canonicalClinicId_(clinic.id);
    if (!id || clinic.name !== CLINIC_IDENTITIES[id].name) throw codedError_('INVALID_CLINIC_IDENTITY', '門診身份格式不正確。');
    if (seen[id]) throw codedError_('DUPLICATE_CLINIC_IDENTITY', '門診身份重複。');
    seen[id] = true;
    const copy = deepClone_(clinic);
    copy.id = id;
    if (!Array.isArray(copy.changes)) throw codedError_('INVALID_SCHEDULE_DATA', '門診資料格式不完整。');
    if (copy.schedule == null || typeof copy.schedule !== 'object' || Array.isArray(copy.schedule)) throw codedError_('INVALID_SCHEDULE_DATA', '門診資料格式不完整。');
    return copy;
  });
  if (!seen.jinan || !seen.yian || normalized.clinics.length !== 2) {
    throw codedError_('MISSING_CLINIC_IDENTITY', '門診身份缺少晉安或毅安。');
  }
  normalized.clinics.sort((a, b) => (a.id < b.id ? -1 : 1));
  return normalized;
}

function canonicalClinicId_(id) {
  if (CLINIC_IDENTITIES.jinan.ids.indexOf(id) !== -1) return 'jinan';
  if (CLINIC_IDENTITIES.yian.ids.indexOf(id) !== -1) return 'yian';
  return null;
}

function replayOrReject_(row, request) {
  if (
    row.monthKey === request.monthKey &&
    row.parentVersionId === request.parentVersionId &&
    row.expectedLatestVersionId === request.expectedLatestVersionId &&
    row.saveRequestId === request.saveRequestId &&
    row.schemaVersion === request.schemaVersion &&
    row.dataJson === request.canonicalDataJson
  ) {
    return json_({ ok: true, created: false, idempotentReplay: true, version: versionPayload_(row, true) });
  }
  return json_({ ok: false, error: 'IDEMPOTENCY_KEY_REUSE', versionId: row.versionId });
}

function getScheduleSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw codedError_('BOUND_SPREADSHEET_NOT_FOUND', '此 Apps Script 必須綁定門診資料 Google Sheet。');

  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, LEGACY_HEADERS.length).setValues([LEGACY_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getFinalScheduleSheet_() {
  const sheet = getExistingScheduleSheet_();
  ensureFinalHeaders_(sheet);
  return sheet;
}

function getExistingScheduleSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw codedError_('BOUND_SPREADSHEET_NOT_FOUND', '此 Apps Script 必須綁定門診資料 Google Sheet。');
  const sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) throw codedError_('SCHEDULE_SHEET_NOT_FOUND', '找不到 Schedules 工作表。');
  return sheet;
}

function ensureLegacyHeaders_(sheet, finalSchemaErrorCode) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, LEGACY_HEADERS.length).setValues([LEGACY_HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }
  const finalActual = sheet.getRange(1, 1, 1, FINAL_HEADERS.length).getValues()[0].map(String);
  if (finalActual.join('|') === FINAL_HEADERS.join('|')) {
    throw codedError_(finalSchemaErrorCode || 'INVALID_SHEET_HEADERS', 'Schedules 工作表已遷移到版本格式，舊版讀寫已停用。');
  }
  const actual = sheet.getRange(1, 1, 1, LEGACY_HEADERS.length).getValues()[0].map(String);
  if (actual.join('|') !== LEGACY_HEADERS.join('|')) throw codedError_('INVALID_SHEET_HEADERS', 'Schedules 工作表欄位不符合預期，已停止讀寫。');
}

function ensureHeaders_(sheet) {
  ensureLegacyHeaders_(sheet);
}

function assertNoMigrationState_() {
  if (PropertiesService.getScriptProperties().getProperty(MIGRATION_STATE_PROPERTY)) {
    throw codedError_('MIGRATION_INCOMPLETE', '偵測到未完成的版本遷移，已停止。');
  }
}

function ensureFinalHeaders_(sheet) {
  const actual = sheet.getRange(1, 1, 1, FINAL_HEADERS.length).getValues()[0].map(String);
  if (actual.join('|') !== FINAL_HEADERS.join('|')) throw codedError_('FINAL_SCHEMA_REQUIRED', 'Schedules 工作表尚未遷移到版本格式。');
}

function readFinalRows_(sheet) {
  ensureFinalHeaders_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, FINAL_HEADERS.length).getValues();
  const rows = [];
  const seenIds = {};
  const seenMonthDateSeq = {};
  const seenSaveRequests = {};
  const latestByMonth = {};
  for (let i = 0; i < values.length; i += 1) {
    const row = parseFinalRow_(values[i], i + 2);
    if (seenIds[row.versionId]) throw codedError_('MALFORMED_VERSION_HISTORY', '版本資料含有重複 version_id。');
    const seqKey = row.monthKey + '|' + row.versionDate + '|' + row.versionSeq;
    if (seenMonthDateSeq[seqKey]) throw codedError_('MALFORMED_VERSION_HISTORY', '版本資料含有重複序號。');
    if (seenSaveRequests[row.saveRequestId]) throw codedError_('MALFORMED_VERSION_HISTORY', '版本資料含有重複 save_request_id。');
    if (row.parentVersionId && !seenIds[row.parentVersionId]) throw codedError_('MALFORMED_VERSION_HISTORY', '版本資料 parent_version_id 指向不存在或較新的版本。');
    const priorLatestId = latestByMonth[row.monthKey] || null;
    if (row.expectedLatestVersionId !== priorLatestId) throw codedError_('MALFORMED_VERSION_HISTORY', '版本資料 expected_latest_version_id 與月份歷史不一致。');
    seenIds[row.versionId] = true;
    seenMonthDateSeq[seqKey] = true;
    seenSaveRequests[row.saveRequestId] = row;
    rows.push(row);
    latestByMonth[row.monthKey] = row.versionId;
  }
  return rows;
}

function parseFinalRow_(values, rowNumber) {
  const versionId = String(values[0] || '');
  validateVersionId_(versionId);
  const monthKey = monthCellToKey_(values[1]);
  validateMonthKey_(monthKey);
  const versionDate = String(values[2] || '');
  if (!isValidDateString_(versionDate)) throw codedError_('MALFORMED_VERSION_HISTORY', '版本日期格式錯誤。');
  const versionSeq = Number(values[3]);
  if (!Number.isInteger(versionSeq) || versionSeq < 1) throw codedError_('MALFORMED_VERSION_HISTORY', '版本序號格式錯誤。');
  const parentVersionId = normalizeNullableVersionId_(values[4]);
  const expectedLatestVersionId = normalizeNullableVersionId_(values[5]);
  const saveRequestId = String(values[6] || '').trim();
  try {
    validateSaveRequestId_(saveRequestId);
  } catch (_) {
    throw codedError_('MALFORMED_VERSION_HISTORY', 'save_request_id 格式錯誤。');
  }
  let data;
  try {
    data = JSON.parse(String(values[7] || ''));
  } catch (_) {
    throw codedError_('MALFORMED_VERSION_HISTORY', '版本資料 JSON 格式錯誤。');
  }
  try {
    data = normalizeScheduleData_(data, monthKey);
  } catch (err) {
    throw codedError_('MALFORMED_VERSION_HISTORY', err.message || '版本資料格式錯誤。');
  }
  const schemaVersion = Number(values[8]);
  if (!isSupportedSchemaVersionCell_(values[8])) throw codedError_('MALFORMED_VERSION_HISTORY', 'schema_version 格式錯誤。');
  if (!isDate_(values[9])) throw codedError_('MALFORMED_VERSION_HISTORY', 'saved_at 格式錯誤。');
  return {
    rowNumber,
    versionId,
    monthKey,
    versionDate,
    versionSeq,
    parentVersionId,
    expectedLatestVersionId,
    saveRequestId,
    dataJson: canonicalJson_(data),
    data: data,
    schemaVersion,
    savedAt: values[9].toISOString(),
  };
}

function generateUniqueVersionId_(rows) {
  const existing = {};
  rows.forEach((row) => { existing[row.versionId] = true; });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const versionId = 'sv_' + Utilities.getUuid();
    if (!existing[versionId]) return versionId;
  }
  throw codedError_('VERSION_ID_COLLISION_EXHAUSTED', '版本 ID 產生重複，已停止寫入。');
}

function appendedVersionMatchesRequest_(row, request, generated) {
  return row.versionId === generated.versionId &&
    row.monthKey === request.monthKey &&
    row.versionDate === generated.versionDate &&
    row.versionSeq === generated.versionSeq &&
    row.parentVersionId === request.parentVersionId &&
    row.expectedLatestVersionId === request.expectedLatestVersionId &&
    row.saveRequestId === request.saveRequestId &&
    row.dataJson === request.canonicalDataJson &&
    row.schemaVersion === request.schemaVersion &&
    row.savedAt === generated.savedAt;
}

function findSaveRequest_(rows, saveRequestId) {
  return rows.filter((row) => row.saveRequestId === saveRequestId)[0] || null;
}

function findVersionById_(rows, versionId) {
  return rows.filter((row) => row.versionId === versionId)[0] || null;
}

function findLatestForMonth_(rows, monthKey) {
  const matches = rows.filter((row) => row.monthKey === monthKey);
  if (!matches.length) return null;
  matches.sort((a, b) => rowOrder_(b) - rowOrder_(a));
  return matches[0];
}

function nextVersionSeq_(rows, monthKey, versionDate) {
  let max = 0;
  rows.forEach((row) => {
    if (row.monthKey === monthKey && row.versionDate === versionDate) max = Math.max(max, row.versionSeq);
  });
  return max + 1;
}

function rowOrder_(row) {
  return row.rowNumber || 0;
}

function versionPayload_(row, includeData) {
  const payload = {
    versionId: row.versionId,
    monthKey: row.monthKey,
    versionDate: row.versionDate,
    versionSeq: row.versionSeq,
    parentVersionId: row.parentVersionId,
    expectedLatestVersionId: row.expectedLatestVersionId,
    saveRequestId: row.saveRequestId,
    schemaVersion: row.schemaVersion,
    savedAt: row.savedAt,
    displayName: row.versionDate + ' V' + row.versionSeq,
  };
  if (includeData) payload.data = row.data;
  return payload;
}

function normalizeNullableVersionId_(value) {
  if (value === null || value === undefined || value === '') return null;
  const versionId = String(value).trim();
  validateVersionId_(versionId);
  return versionId;
}

function validateVersionId_(versionId) {
  if (versionId.length > MAX_ID_LENGTH || !/^sv_[A-Za-z0-9_-]+$/.test(versionId)) throw codedError_('INVALID_VERSION_ID', 'versionId 格式不正確。');
}

function validateSaveRequestId_(saveRequestId) {
  if (!saveRequestId || saveRequestId.length > MAX_ID_LENGTH || !/^[A-Za-z0-9._:-]+$/.test(saveRequestId)) {
    throw codedError_('INVALID_SAVE_REQUEST_ID', 'saveRequestId 格式不正確。');
  }
}

function monthCellToKey_(value) {
  if (typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  if (isDate_(value)) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || TIMEZONE, 'yyyy-MM');
  }
  return String(value || '');
}

function findLegacyMonthRows_(sheet, monthKey) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const rows = [];
  for (let i = 0; i < values.length; i += 1) {
    if (monthCellToKey_(values[i][0]) === monthKey) rows.push(i + 2);
  }
  return rows;
}

function findMonthRows_(sheet, monthKey) {
  return findLegacyMonthRows_(sheet, monthKey);
}

function validateMonthKey_(monthKey) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) throw codedError_('INVALID_MONTH_KEY', '月份格式必須為 YYYY-MM。');
}

function inferMonthKeyFromTitle_(title) {
  if (typeof title !== 'string') return null;
  const match = title.trim().match(/^(\d{3,4})\s*(?:年|[\/.\-])\s*(\d{1,2})\s*月?$/);
  if (!match) return null;

  let year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  if (year < 1911) year += 1911;
  if (year < 2000 || year > 2200) return null;
  return year + '-' + String(month).padStart(2, '0');
}

function assertMonthTitleMatch_(monthKey, title) {
  const titleMonthKey = inferMonthKeyFromTitle_(title);
  if (titleMonthKey && titleMonthKey !== monthKey) {
    throw codedError_('MONTH_TITLE_MISMATCH', '儲存月份 ' + monthKey + ' 與門診表標題「' + title + '」所代表的 ' + titleMonthKey + ' 不一致，已停止操作。');
  }
}

function validateLegacyScheduleData_(data) {
  if (!data || typeof data !== 'object' || typeof data.title !== 'string' || typeof data.note !== 'string' || !Array.isArray(data.clinics) || data.clinics.length === 0) {
    throw codedError_('INVALID_SCHEDULE_DATA', '門診資料格式不完整。');
  }
}

function migrateLegacySchedulesToVersions_() {
  let lock;
  try {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw codedError_('SAVE_LOCK_TIMEOUT', '目前有另一筆門診資料正在儲存，請稍後再試。');
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const properties = PropertiesService.getScriptProperties();
    if (properties.getProperty(MIGRATION_STATE_PROPERTY)) throw codedError_('MIGRATION_INCOMPLETE', '偵測到未完成的版本遷移，已停止。');
    const sheet = getExistingScheduleSheet_();
    const firstCells = sheet.getRange(1, 1, 1, FINAL_HEADERS.length).getValues()[0].map(String);
    if (firstCells.join('|') === FINAL_HEADERS.join('|')) {
      readFinalRows_(sheet);
      return { ok: true, migrated: false, idempotent: true };
    }
    ensureLegacyHeaders_(sheet);
    const legacyRows = validateLegacyRowsForMigration_(sheet);
    const stamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMddHHmmss');
    const backupName = SHEET_NAME + '_legacy_backup_' + stamp;
    const replacedLegacyName = SHEET_NAME + '_legacy_replaced_' + stamp;
    const buildName = SHEET_NAME + '_version_build_' + stamp;
    properties.setProperty(MIGRATION_STATE_PROPERTY, JSON.stringify({
      status: 'in_progress',
      backupSheetName: backupName,
      replacedLegacyName: replacedLegacyName,
      buildSheetName: buildName,
      startedAt: new Date().toISOString(),
    }));
    sheet.copyTo(spreadsheet).setName(backupName);
    const finalSheet = spreadsheet.insertSheet(buildName);
    finalSheet.getRange(1, 1, 1, FINAL_HEADERS.length).setValues([FINAL_HEADERS]);
    finalSheet.setFrozenRows(1);
    legacyRows.forEach((row, index) => {
      finalSheet.getRange(index + 2, 1, 1, FINAL_HEADERS.length).setValues([[
        'sv_migration_' + row.monthKey.replace('-', '') + '_' + String(index + 1),
        row.monthKey,
        Utilities.formatDate(row.updatedAt, TIMEZONE, 'yyyy-MM-dd'),
        1,
        '',
        '',
        'migration_' + row.monthKey + '_' + row.updatedAt.toISOString(),
        canonicalJson_(row.data),
        row.schemaVersion,
        row.updatedAt,
      ]]);
    });
    SpreadsheetApp.flush();
    readFinalRows_(finalSheet);
    sheet.setName(replacedLegacyName);
    finalSheet.setName(SHEET_NAME);
    readFinalRows_(getExistingScheduleSheet_());
    properties.deleteProperty(CURRENT_VERSION_PROPERTY);
    properties.deleteProperty(MIGRATION_STATE_PROPERTY);
    return { ok: true, migrated: true, backupSheetName: backupName, currentVersionId: null };
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function rollbackVersionMigration_(backupSheetName) {
  let lock;
  try {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw codedError_('SAVE_LOCK_TIMEOUT', '目前有另一筆門診資料正在儲存，請稍後再試。');
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const properties = PropertiesService.getScriptProperties();
    const requestedBackupName = String(backupSheetName || '');
    validateBackupSheetName_(requestedBackupName);
    const existingState = validateRollbackMigrationState_(properties.getProperty(MIGRATION_STATE_PROPERTY), requestedBackupName);
    const backupName = existingState ? existingState.backupSheetName : requestedBackupName;
    const backup = spreadsheet.getSheetByName(backupName);
    const active = spreadsheet.getSheetByName(SHEET_NAME);
    if (!backup && existingState && existingState.status === 'in_progress' && active && isLegacyHeaderSheet_(active)) {
      validateLegacyBackupSheet_(active);
      properties.deleteProperty(MIGRATION_STATE_PROPERTY);
      return { ok: true, restored: false, recovered: true };
    }
    if (!backup) throw codedError_('BACKUP_SHEET_NOT_FOUND', '找不到備份工作表。');
    validateLegacyBackupSheet_(backup);

    const stamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMddHHmmss');
    const preservedVersionDataName = existingState && existingState.preservedVersionDataName ?
      existingState.preservedVersionDataName :
      SHEET_NAME + '_version_data_' + stamp;
    validateVersionDataSheetName_(preservedVersionDataName);

    if (existingState && existingState.buildSheetName) {
      const buildSheet = spreadsheet.getSheetByName(existingState.buildSheetName);
      if (buildSheet) readFinalRows_(buildSheet);
    }

    if (active && isLegacyHeaderSheet_(active)) {
      validateLegacyBackupSheet_(active);
      if (!legacySheetsMatch_(active, backup)) throw codedError_('INVALID_ACTIVE_LEGACY_ROLLBACK_STATE', '目前 Schedules 與備份內容不一致，已停止復原。');
      properties.deleteProperty(CURRENT_VERSION_PROPERTY);
      properties.deleteProperty(MIGRATION_STATE_PROPERTY);
      return { ok: true, restored: false };
    }

    if (active) {
      readFinalRows_(active);
      if (spreadsheet.getSheetByName(preservedVersionDataName)) throw codedError_('ROLLBACK_DESTINATION_CONFLICT', '版本資料保留工作表名稱已存在，已停止復原。');
    } else if (spreadsheet.getSheetByName(SHEET_NAME)) {
      throw codedError_('ROLLBACK_DESTINATION_CONFLICT', 'Schedules 工作表名稱衝突，已停止復原。');
    }

    properties.setProperty(MIGRATION_STATE_PROPERTY, JSON.stringify({
      status: 'rollback_in_progress',
      backupSheetName: backupName,
      preservedVersionDataName: preservedVersionDataName,
      startedAt: existingState && existingState.startedAt ? existingState.startedAt : new Date().toISOString(),
    }));
    if (active) active.setName(preservedVersionDataName);
    const restored = backup.copyTo(spreadsheet).setName(SHEET_NAME);
    validateLegacyBackupSheet_(restored);
    properties.deleteProperty(CURRENT_VERSION_PROPERTY);
    properties.deleteProperty(MIGRATION_STATE_PROPERTY);
    return { ok: true, restored: true };
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function validateBackupSheetName_(name) {
  if (!/^Schedules_legacy_backup_\d{14}$/.test(name)) throw codedError_('INVALID_BACKUP_SHEET_NAME', '備份工作表名稱不符合遷移備份格式。');
}

function validateVersionDataSheetName_(name) {
  if (!/^Schedules_version_data_\d{14}$/.test(name)) throw codedError_('INVALID_MIGRATION_STATE', '復原狀態的版本資料工作表名稱不正確。');
}

function validateMigrationSheetName_(name, prefix) {
  if (name && !new RegExp('^Schedules_' + prefix + '_\\d{14}$').test(name)) throw codedError_('INVALID_MIGRATION_STATE', '遷移狀態的工作表名稱不正確。');
}

function validateMigrationStateSheetName_(state, key, prefix) {
  const value = state[key];
  if (typeof value !== 'string' || !new RegExp('^Schedules_' + prefix + '_\\d{14}$').test(value)) {
    throw codedError_('INVALID_MIGRATION_STATE', '遷移狀態的工作表名稱不正確。');
  }
  return value;
}

function validateMigrationStateBackupName_(state) {
  const value = state.backupSheetName;
  if (typeof value !== 'string' || !/^Schedules_legacy_backup_\d{14}$/.test(value)) {
    throw codedError_('INVALID_MIGRATION_STATE', '遷移狀態的備份工作表名稱不正確。');
  }
  return value;
}

function validateMigrationStateStartedAt_(state) {
  if (typeof state.startedAt !== 'string' || !isDate_(new Date(state.startedAt))) {
    throw codedError_('INVALID_MIGRATION_STATE', '遷移狀態時間格式不正確。');
  }
}

function validateMigrationStateKnownKeys_(state) {
  const allowed = {
    status: true,
    backupSheetName: true,
    replacedLegacyName: true,
    buildSheetName: true,
    preservedVersionDataName: true,
    startedAt: true,
  };
  Object.keys(state).forEach((key) => {
    if (!allowed[key]) throw codedError_('INVALID_MIGRATION_STATE', '遷移狀態含有未知欄位，已停止復原。');
  });
}

function validateRollbackMigrationState_(rawState, requestedBackupName) {
  if (!rawState) return null;
  let state;
  try {
    state = JSON.parse(rawState);
  } catch (_) {
    throw codedError_('INVALID_MIGRATION_STATE', '遷移狀態格式不正確，已停止復原。');
  }
  if (!state || typeof state !== 'object') throw codedError_('INVALID_MIGRATION_STATE', '遷移狀態格式不正確，已停止復原。');
  if (state.status !== 'in_progress' && state.status !== 'rollback_in_progress') {
    throw codedError_('INVALID_MIGRATION_STATE', '未知的遷移狀態，已停止復原。');
  }
  validateMigrationStateKnownKeys_(state);
  validateMigrationStateBackupName_(state);
  if (state.backupSheetName !== requestedBackupName) throw codedError_('ROLLBACK_BACKUP_MISMATCH', '復原備份與遷移狀態不一致。');
  validateMigrationStateStartedAt_(state);
  if (state.status === 'in_progress') {
    validateMigrationStateSheetName_(state, 'replacedLegacyName', 'legacy_replaced');
    validateMigrationStateSheetName_(state, 'buildSheetName', 'version_build');
    if (state.preservedVersionDataName !== undefined) validateMigrationStateSheetName_(state, 'preservedVersionDataName', 'version_data');
  } else {
    validateMigrationStateSheetName_(state, 'preservedVersionDataName', 'version_data');
    if (state.replacedLegacyName !== undefined) validateMigrationStateSheetName_(state, 'replacedLegacyName', 'legacy_replaced');
    if (state.buildSheetName !== undefined) validateMigrationStateSheetName_(state, 'buildSheetName', 'version_build');
  }
  return state;
}

function validateLegacyBackupSheet_(sheet) {
  if (!isLegacyHeaderSheet_(sheet)) throw codedError_('INVALID_SHEET_HEADERS', '備份工作表欄位不符合預期，已停止復原。');
  validateLegacyRowsForMigration_(sheet);
}

function isLegacyHeaderSheet_(sheet) {
  if (!sheet || sheet.getLastRow() === 0) return false;
  const finalActual = sheet.getRange(1, 1, 1, FINAL_HEADERS.length).getValues()[0].map(String);
  if (finalActual.join('|') === FINAL_HEADERS.join('|')) return false;
  const actual = sheet.getRange(1, 1, 1, LEGACY_HEADERS.length).getValues()[0].map(String);
  return actual.join('|') === LEGACY_HEADERS.join('|');
}

function legacySheetsMatch_(a, b) {
  if (a.getLastRow() !== b.getLastRow()) return false;
  const rowCount = a.getLastRow();
  if (rowCount === 0) return false;
  const aValues = a.getRange(1, 1, rowCount, LEGACY_HEADERS.length).getValues();
  const bValues = b.getRange(1, 1, rowCount, LEGACY_HEADERS.length).getValues();
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < LEGACY_HEADERS.length; column += 1) {
      if (comparableCellValue_(aValues[row][column]) !== comparableCellValue_(bValues[row][column])) return false;
    }
  }
  return true;
}

function comparableCellValue_(value) {
  return isDate_(value) ? value.toISOString() : String(value == null ? '' : value);
}

function validateLegacyRowsForMigration_(sheet) {
  ensureLegacyHeaders_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, LEGACY_HEADERS.length).getValues();
  const rows = [];
  const seenMonths = {};
  for (let i = 0; i < values.length; i += 1) {
    const monthKey = monthCellToKey_(values[i][0]);
    validateMonthKey_(monthKey);
    if (seenMonths[monthKey]) throw codedError_('MIGRATION_DUPLICATE_MONTH', 'Legacy sheet has duplicate month rows.');
    seenMonths[monthKey] = true;
    let parsed;
    try {
      parsed = JSON.parse(String(values[i][1] || ''));
    } catch (_) {
      throw codedError_('MIGRATION_INVALID_JSON', 'Legacy sheet has invalid JSON.');
    }
    const data = normalizeScheduleData_(parsed, monthKey);
    const updatedAt = values[i][3];
    if (!isDate_(updatedAt)) throw codedError_('MIGRATION_INVALID_TIMESTAMP', 'Legacy sheet has invalid timestamp.');
    if (!isSupportedSchemaVersionCell_(values[i][2])) throw codedError_('MIGRATION_INVALID_SCHEMA_VERSION', 'Legacy sheet has invalid schema_version.');
    rows.push({ monthKey, data, schemaVersion: SCHEMA_VERSION, updatedAt });
  }
  return rows;
}

function isValidDateString_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parts = value.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] &&
    date.getUTCMonth() === parts[1] - 1 &&
    date.getUTCDate() === parts[2];
}

function isSupportedSchemaVersionCell_(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value === SCHEMA_VERSION;
  if (typeof value === 'string') return String(SCHEMA_VERSION) === value.trim();
  return false;
}

function canonicalJson_(value) {
  return JSON.stringify(sortValue_(value));
}

function sortValue_(value) {
  if (Array.isArray(value)) return value.map(sortValue_);
  if (value && typeof value === 'object' && !isDate_(value)) {
    const output = {};
    Object.keys(value).sort().forEach((key) => {
      output[key] = sortValue_(value[key]);
    });
    return output;
  }
  return value === undefined ? null : value;
}

function isDate_(value) {
  return value && typeof value.getTime === 'function' && !isNaN(value.getTime());
}

function deepClone_(value) {
  return JSON.parse(JSON.stringify(value));
}

function codedError_(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertServerSecret_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty(SERVER_SECRET_PROPERTY);
  if (!expected) throw codedError_('SERVER_SECRET_NOT_CONFIGURED', 'Apps Script 尚未設定伺服器密鑰。');
  if (typeof provided !== 'string' || provided !== expected) throw codedError_('UNAUTHORIZED', '未授權的門診資料請求。');
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
