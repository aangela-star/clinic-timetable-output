const SHEET_NAME = 'Schedules';
const HEADERS = ['month_key', 'data_json', 'schema_version', 'updated_at'];
const SCHEMA_VERSION = 1;

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || '');
    if (action !== 'load') return json_({ ok: false, error: 'UNSUPPORTED_ACTION' });

    const monthKey = String(e.parameter.month || '');
    validateMonthKey_(monthKey);

    const sheet = getScheduleSheet_();
    const row = findMonthRow_(sheet, monthKey);
    if (!row) return json_({ ok: true, found: false, month: monthKey });

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
  } catch (err) {
    return json_({ ok: false, error: err.code || 'LOAD_FAILED', message: err.message || String(err) });
  }
}

function doPost(e) {
  let lock;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action !== 'save') return json_({ ok: false, error: 'UNSUPPORTED_ACTION' });

    const monthKey = String(body.month || '');
    validateMonthKey_(monthKey);
    validateScheduleData_(body.data);
    assertMonthTitleMatch_(monthKey, body.data.title);

    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      const error = new Error('目前有另一筆門診資料正在儲存，請稍後再試。');
      error.code = 'SAVE_LOCK_TIMEOUT';
      throw error;
    }

    const sheet = getScheduleSheet_();
    const row = findMonthRow_(sheet, monthKey);
    const now = new Date();
    const values = [monthKey, JSON.stringify(body.data), SCHEMA_VERSION, now];

    if (row) {
      sheet.getRange(row, 1, 1, HEADERS.length).setValues([values]);
    } else {
      sheet.appendRow(values);
    }

    SpreadsheetApp.flush();
    return json_({ ok: true, month: monthKey, schemaVersion: SCHEMA_VERSION, updatedAt: now.toISOString() });
  } catch (err) {
    return json_({ ok: false, error: err.code || 'SAVE_FAILED', message: err.message || String(err) });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function getScheduleSheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) {
    const error = new Error('Apps Script 尚未設定 SPREADSHEET_ID。');
    error.code = 'SPREADSHEET_NOT_CONFIGURED';
    throw error;
  }

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
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

function findMonthRow_(sheet, monthKey) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i += 1) {
    if (String(values[i][0]) === monthKey) return i + 2;
  }
  return null;
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
