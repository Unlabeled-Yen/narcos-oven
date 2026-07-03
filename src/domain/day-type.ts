/**
 * 日類型（出貨/工作/休息）判定 + 訂單歸屬批次計算。
 *
 * SchedulePage 用 localStorage("narcos-day-overrides") 記單日 override、
 * fallback 到 menu.scheduling 的星期幾預設。
 *
 * LabelsPage / BatchDetail 等其他頁需要判定「某個訂單屬於哪個出貨批」時、
 * 用此模組的 shippingDayFor(iso) — 從該日開始往後找第一個 shipping day、
 * 就是該訂單實際的批次日期。
 *
 * 例：訂單 batchDate = 07/05（週日 · 工作日）→ shippingDayFor("2026-07-05") = 07/07（週二 · 出貨）
 *   → 標籤上該訂單歸屬 07/07 出貨批。
 */
import type { Menu } from "./models";

export type DayType = "ship" | "work" | "rest";

export type DayOverrides = Record<string, DayType>;

const OVERRIDE_KEY = "narcos-day-overrides";

export function loadDayOverrides(): DayOverrides {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function makeDayTypeOf(menu: Menu, overrides: DayOverrides) {
  const menuShippingWeekdays = new Set(menu.scheduling?.shipping_weekdays ?? [2]);
  const menuWorkingWeekdays = new Set(
    menu.scheduling?.working_weekdays ?? [0, 1, 2, 3, 4, 5, 6]
  );
  return function dayTypeOf(iso: string): DayType {
    if (iso in overrides) return overrides[iso]!;
    const wd = new Date(iso).getDay();
    if (menuShippingWeekdays.has(wd)) return "ship";
    if (menuWorkingWeekdays.has(wd)) return "work";
    return "rest";
  };
}

/**
 * 從 iso 起（含 iso 自身）往後找第一個 shipping day、上限 30 天。
 * 若 iso 已是 shipping → 回傳 iso 自己。
 * 若掃 30 天沒找到（不應該發生）→ 回傳 iso（fallback）。
 */
export function shippingDayFor(
  iso: string,
  dayTypeOf: (iso: string) => DayType
): string {
  const d = new Date(iso);
  for (let i = 0; i < 30; i++) {
    const s = toIsoLocal(d);
    if (dayTypeOf(s) === "ship") return s;
    d.setDate(d.getDate() + 1);
  }
  return iso;
}

function toIsoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
