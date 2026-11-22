const SHEET_NAME = 'Schedules';
const HEADERS = ['month_key', 'data_json', 'schema_version', 'updated_at'];
const SCHEMA_VERSION = 1;
const SERVER_SECRET_PROPERTY = 'CLINIC_SERVER_SECRET';
const READ_ONLY_LOAD_ACTION = 'loadReadOnly';

function doGet() {
  return json_({ ok: false, error: 'METHOD_NOT_ALLOWED' });
}

function doPost(e) {
  let lock;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    assertServerSecret_(body.secret);
    if (body.action === 'publish') return publishRequest_(body);
    if (body.action === 'prepareValidation') return prepareValidationRequest_(body, e && e.postData && e.postData.contents);

    const action = String(body.action || '');
    const monthKey = String(body.month || '');
    validateMonthKey_(monthKey);

    // The browser-facing read. Separate from 'load' because 'load' shares getScheduleSheet_()
    // with 'save', and that helper creates the Schedules sheet and writes its header row. A read
    // must never do that, so this path is read-only by construction.
    if (action === READ_ONLY_LOAD_ACTION) return readOnlyLoadRequest_(monthKey);

    if (action === 'load') {
      const sheet = getScheduleSheet_();
      const rows = findMonthRows_(sheet, monthKey);
      if (!rows.length) return json_({ ok: true, found: false, month: monthKey });

      const row = rows[rows.length - 1];
      const values = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
      const data = JSON.parse(values[1]);
      validateScheduleData_(data);
      assertMonthTitleMatch_(monthKey, data.title);

      return json_({
        ok: true,
        found: true,
        month: monthKey,
        schemaVersion: Number(values[2]) || SCHEMA_VERSION,
        data: data,
        updatedAt: values[3] instanceof Date ? values[3].toISOString() : String(values[3] || ''),
      });
    }

    if (action !== 'save') return json_({ ok: false, error: 'UNSUPPORTED_ACTION' });

    validateScheduleData_(body.data);
    assertMonthTitleMatch_(monthKey, body.data.title);

    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      const error = new Error('目前有另一筆門診資料正在儲存，請稍後再試。');
      error.code = 'SAVE_LOCK_TIMEOUT';
      throw error;
    }

    const sheet = getScheduleSheet_();
    const rows = findMonthRows_(sheet, monthKey);
    const row = rows.length ? rows[rows.length - 1] : sheet.getLastRow() + 1;
    const now = new Date();
    const values = [monthKey, JSON.stringify(body.data), SCHEMA_VERSION, now];

    sheet.getRange(row, 1).setNumberFormat('@');
    sheet.getRange(row, 1, 1, HEADERS.length).setValues([values]);

    for (let i = rows.length - 2; i >= 0; i -= 1) {
      sheet.deleteRow(rows[i]);
    }

    SpreadsheetApp.flush();
    return json_({ ok: true, month: monthKey, schemaVersion: SCHEMA_VERSION, updatedAt: now.toISOString() });
  } catch (err) {
    return json_({ ok: false, error: err.code || 'REQUEST_FAILED', message: err.message || String(err) });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

// Read-only month read. It calls nothing that can create, initialise or modify anything:
//   - a missing Schedules sheet is REPORTED, never inserted;
//   - an empty sheet is REPORTED, never given a header row;
//   - unexpected headers and unreadable stored data fail closed, never get repaired;
//   - no ScriptLock is taken and SpreadsheetApp.flush() is never called.
// 'found: false' here means "nothing stored for this month", which is also the honest answer when
// storage has not been initialised yet: initialising it is a write and belongs to 'save'.
function readOnlyLoadRequest_(monthKey) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    const error = new Error('此 Apps Script 必須綁定門診資料 Google Sheet。');
    error.code = 'BOUND_SPREADSHEET_NOT_FOUND';
    throw error;
  }

  const sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) return readOnlyMiss_(monthKey, 'SHEET_MISSING');

  const lastRow = sheet.getLastRow();
  if (lastRow === 0) return readOnlyMiss_(monthKey, 'SHEET_EMPTY');

  assertHeadersReadOnly_(sheet);
  const rows = findMonthRows_(sheet, monthKey);
  if (!rows.length) return readOnlyMiss_(monthKey, 'MONTH_MISSING');

  const row = rows[rows.length - 1];
  const values = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];

  let data;
  try {
    data = JSON.parse(values[1]);
  } catch (err) {
    const error = new Error('該月份已儲存的資料無法解析，已停止讀取（未修改任何資料）。');
    error.code = 'INVALID_STORED_DATA';
    throw error;
  }
  validateScheduleData_(data);
  assertMonthTitleMatch_(monthKey, data.title);

  return json_({
    ok: true,
    found: true,
    readOnly: true,
    month: monthKey,
    schemaVersion: Number(values[2]) || SCHEMA_VERSION,
    data: data,
    updatedAt: values[3] instanceof Date ? values[3].toISOString() : String(values[3] || ''),
  });
}

function readOnlyMiss_(monthKey, storage) {
  return json_({ ok: true, found: false, readOnly: true, month: monthKey, storage: storage });
}

// Header check without the initialisation branch ensureHeaders_ has.
function assertHeadersReadOnly_(sheet) {
  const actual = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0].map(String);
  if (actual.join('|') !== HEADERS.join('|')) {
    const error = new Error('Schedules 工作表欄位不符合預期，已停止讀寫。');
    error.code = 'INVALID_SHEET_HEADERS';
    throw error;
  }
}

function assertServerSecret_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty(SERVER_SECRET_PROPERTY);
  if (!expected) {
    const error = new Error('Apps Script 尚未設定伺服器密鑰。');
    error.code = 'SERVER_SECRET_NOT_CONFIGURED';
    throw error;
  }
  if (typeof provided !== 'string' || provided !== expected) {
    const error = new Error('未授權的門診資料請求。');
    error.code = 'UNAUTHORIZED';
    throw error;
  }
}

function getScheduleSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    const error = new Error('此 Apps Script 必須綁定門診資料 Google Sheet。');
    error.code = 'BOUND_SPREADSHEET_NOT_FOUND';
    throw error;
  }

  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  } else {
    ensureHeaders_(sheet);
  }
  return sheet;
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }

  const actual = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0].map(String);
  if (actual.join('|') !== HEADERS.join('|')) {
    const error = new Error('Schedules 工作表欄位不符合預期，已停止讀寫。');
    error.code = 'INVALID_SHEET_HEADERS';
    throw error;
  }
}

function monthCellToKey_(value) {
  if (typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Taipei', 'yyyy-MM');
  }
  return String(value || '');
}

function findMonthRows_(sheet, monthKey) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const range = sheet.getRange(2, 1, lastRow - 1, 1);
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const rows = [];
  for (let i = 0; i < values.length; i += 1) {
    const displayedMonth = displayValues[i][0];
    const rowMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(displayedMonth)
      ? displayedMonth : monthCellToKey_(values[i][0]);
    if (rowMonth === monthKey) rows.push(i + 2);
  }
  return rows;
}

function validateMonthKey_(monthKey) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    const error = new Error('月份格式必須為 YYYY-MM。');
    error.code = 'INVALID_MONTH_KEY';
    throw error;
  }
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
    const error = new Error('儲存月份 ' + monthKey + ' 與門診表標題「' + title + '」所代表的 ' + titleMonthKey + ' 不一致，已停止操作。');
    error.code = 'MONTH_TITLE_MISMATCH';
    throw error;
  }
}

function validateScheduleData_(data) {
  if (!data || typeof data !== 'object' || typeof data.title !== 'string' || typeof data.note !== 'string' || !Array.isArray(data.clinics) || data.clinics.length === 0) {
    const error = new Error('門診資料格式不完整。');
    error.code = 'INVALID_SCHEDULE_DATA';
    throw error;
  }
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
