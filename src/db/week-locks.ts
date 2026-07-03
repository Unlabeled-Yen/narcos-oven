/**
 * 週級排程鎖 · localStorage
 *
 * Yen 決策（2026-07-03）：整週鎖 · lock 後卡片變唯讀、完全禁拖、日欄 header 也禁切換
 *   key 用 weekStart ISO（週日開始，跟 SchedulePage 的 weekISO[0] 一致）
 *   持久層用 localStorage（跟 dayOverrides 同層）· 未來要跨裝置再遷 IndexedDB
 */
const KEY = "narcos-week-locks";

export function loadWeekLocks(): Record<string, true> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function isWeekLocked(weekStartISO: string): boolean {
  if (!weekStartISO) return false;
  return !!loadWeekLocks()[weekStartISO];
}

export function setWeekLocked(weekStartISO: string, locked: boolean): void {
  if (!weekStartISO) return;
  const map = loadWeekLocks();
  if (locked) map[weekStartISO] = true;
  else delete map[weekStartISO];
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota 錯不 loud，讓 UI 端自行讀 loadWeekLocks 判斷 */
  }
}
