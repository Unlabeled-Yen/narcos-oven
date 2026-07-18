/**
 * 排程鎖 · localStorage · Yen 2026-07-04 改為「單日鎖」語意
 *
 * 舊：整週鎖 · key 用 weekStart ISO
 * 新：單日鎖 · key 用該日 ISO（通常是 shipping day）
 *   雇主可以只鎖某個出貨日的排程（防手殘動到）· 其他日仍可調整
 *   持久層用 localStorage · localStorage key 沿用 narcos-week-locks（相容舊 key · 不遷移）
 */
const KEY = "narcos-week-locks";

export function loadDayLocks(): Record<string, true> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** iso 是某一天（通常是 shipping day）· 該日是否鎖定 */
export function isDayLocked(iso: string): boolean {
  if (!iso) return false;
  return !!loadDayLocks()[iso];
}

export function setDayLocked(iso: string, locked: boolean): void {
  if (!iso) return;
  const map = loadDayLocks();
  if (locked) map[iso] = true;
  else delete map[iso];
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota 錯不 loud、讓 UI 端自行讀 loadDayLocks 判斷 */
  }
}

// legacy alias · 舊 code 呼叫這些函式名仍可用
export const loadWeekLocks = loadDayLocks;
export const isWeekLocked = isDayLocked;
export const setWeekLocked = setDayLocked;

// ── 備份 / 還原用 · 讓 backup.ts 不必碰 localStorage key ────────────────
export function dumpDayLocks(): Record<string, true> {
  return loadDayLocks();
}

export function restoreDayLocks(locks: Record<string, true>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(locks));
  } catch {
    /* quota 錯不 loud、讓上層 UI 端自行讀 loadDayLocks 判斷 */
  }
}

export function clearDayLocks(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 同上 */
  }
}
