(function (global) {
  const LAST_SCHEDULE_MONTH_STORAGE_KEY = "clinic-timetable.last-schedule-month";

  function isValidMonthKey(value) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value || "")) return false;
    return true;
  }

  function inferMonthKeyFromTitle(title) {
    if (typeof title !== "string") return null;
    const match = title.trim().match(/^(\d{3,4})\s*(?:年|[\/.\-])\s*(\d{1,2})\s*月?$/);
    if (!match) return null;

    let year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
    if (year < 1911) year += 1911;
    if (year < 2000 || year > 2200) return null;

    return `${year}-${String(month).padStart(2, "0")}`;
  }

  function getMonthTitleMismatch(monthKey, title) {
    if (!isValidMonthKey(monthKey)) {
      return { code: "INVALID_MONTH_KEY", message: "月份格式必須為 YYYY-MM。" };
    }
    const titleMonthKey = inferMonthKeyFromTitle(title);
    if (titleMonthKey && titleMonthKey !== monthKey) {
      return {
        code: "MONTH_TITLE_MISMATCH",
        message: `儲存月份 ${monthKey} 與門診表標題「${title}」所代表的 ${titleMonthKey} 不一致，已停止儲存。`,
      };
    }
    return null;
  }

  function isValidScheduleData(data) {
    return !!(
      data &&
      typeof data === "object" &&
      typeof data.title === "string" &&
      typeof data.note === "string" &&
      Array.isArray(data.clinics) &&
      data.clinics.length > 0
    );
  }

  function getInitialMonthKey(runtime, title) {
    const fallback = inferMonthKeyFromTitle(title) || "";
    try {
      const storage = runtime && runtime.localStorage;
      if (!storage || typeof storage.getItem !== "function") return fallback;
      const storedMonth = storage.getItem(LAST_SCHEDULE_MONTH_STORAGE_KEY);
      return isValidMonthKey(storedMonth) ? storedMonth : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function rememberLastScheduleMonth(runtime, monthKey) {
    if (!isValidMonthKey(monthKey)) return false;
    try {
      const storage = runtime && runtime.localStorage;
      if (!storage || typeof storage.setItem !== "function") return false;
      storage.setItem(LAST_SCHEDULE_MONTH_STORAGE_KEY, monthKey);
      return true;
    } catch (_) {
      return false;
    }
  }

  function rememberLoadedMonth(runtime, monthKey, payload) {
    if (!payload || payload.ok !== true || payload.found !== true) return false;
    return rememberLastScheduleMonth(runtime, monthKey);
  }

  function rememberSavedMonth(runtime, monthKey, payload) {
    if (!payload || payload.ok !== true) return false;
    return rememberLastScheduleMonth(runtime, monthKey);
  }

  const api = Object.freeze({
    LAST_SCHEDULE_MONTH_STORAGE_KEY,
    getInitialMonthKey,
    isValidMonthKey,
    inferMonthKeyFromTitle,
    getMonthTitleMismatch,
    isValidScheduleData,
    rememberLastScheduleMonth,
    rememberLoadedMonth,
    rememberSavedMonth,
  });

  global.ScheduleSaveLoadCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
