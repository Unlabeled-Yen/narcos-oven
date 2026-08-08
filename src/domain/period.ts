/**
 * 期間篩選 helper（純函式）
 * 支援月 / 季 / 年 / 全部
 *
 * #6 2026-08-06：一律用「有效出貨日」（effectiveShipDate）分期間，不是原始
 * batchDate——工單/出貨明細/印標籤本來就用出貨日，這裡跟上，同一張單不會
 * 出現「這頁歸 7 月、那頁歸 8 月」的落差。dayTypeOf 由呼叫端注入（跟
 * day-type.ts / compute-dashboard.ts 同一個模式），維持純函式可測。
 */
import type { Order } from "./models";
import type { DayType } from "./day-type";
import { effectiveShipDate } from "./effective-ship-date";

export type PeriodType = "all" | "month" | "quarter" | "year";

export type Period =
  | { type: "all" }
  | { type: "month"; year: number; month: number /* 1-12 */ }
  | { type: "quarter"; year: number; quarter: 1 | 2 | 3 | 4 }
  | { type: "year"; year: number };

/**
 * 期間對應的 YYYY-MM-DD 起訖（含起、含訖）。
 */
export function periodBounds(p: Period): { start: string; end: string } | null {
  if (p.type === "all") return null;
  const y = p.year;
  if (p.type === "year") {
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  if (p.type === "quarter") {
    const startMonth = (p.quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return {
      start: `${y}-${pad(startMonth)}-01`,
      end: `${y}-${pad(endMonth)}-${lastDayOfMonth(y, endMonth)}`,
    };
  }
  return {
    start: `${y}-${pad(p.month)}-01`,
    end: `${y}-${pad(p.month)}-${lastDayOfMonth(y, p.month)}`,
  };
}

/** 依有效出貨日過濾。訂單無有效出貨日一律不入期間報表。 */
export function filterByPeriod(
  orders: Order[],
  period: Period,
  dayTypeOf: (iso: string) => DayType
): Order[] {
  const bounds = periodBounds(period);
  if (!bounds) return orders.filter((o) => !!effectiveShipDate(o, dayTypeOf));
  return orders.filter((o) => {
    const d = effectiveShipDate(o, dayTypeOf);
    return d !== null && d >= bounds.start && d <= bounds.end;
  });
}

/** 檔名用的期間標籤，例：2026-07 / 2026-Q3 / 2026 / all */
export function periodLabel(p: Period): string {
  if (p.type === "all") return "all";
  if (p.type === "year") return String(p.year);
  if (p.type === "quarter") return `${p.year}-Q${p.quarter}`;
  return `${p.year}-${pad(p.month)}`;
}

/** 掃 orders 給出可選的年份、月份、季度、for UI dropdown */
export function getAvailablePeriods(
  orders: Order[],
  dayTypeOf: (iso: string) => DayType
): {
  years: number[];
  yearMonths: Record<number, number[]>; // year → months (1-12)
  yearQuarters: Record<number, number[]>; // year → quarters (1-4)
} {
  const years = new Set<number>();
  const yearMonths: Record<number, Set<number>> = {};
  for (const o of orders) {
    const shipDate = effectiveShipDate(o, dayTypeOf);
    if (!shipDate) continue;
    const m = /^(\d{4})-(\d{2})/.exec(shipDate);
    if (!m) continue;
    const y = parseInt(m[1]!, 10);
    const mo = parseInt(m[2]!, 10);
    years.add(y);
    if (!yearMonths[y]) yearMonths[y] = new Set();
    yearMonths[y].add(mo);
  }
  const yearQuarters: Record<number, number[]> = {};
  for (const [y, ms] of Object.entries(yearMonths)) {
    const yi = parseInt(y, 10);
    const qs = new Set<number>();
    for (const mo of ms) qs.add(Math.floor((mo - 1) / 3) + 1);
    yearQuarters[yi] = [...qs].sort();
  }
  const yearMonthArr: Record<number, number[]> = {};
  for (const [y, ms] of Object.entries(yearMonths)) {
    yearMonthArr[parseInt(y, 10)] = [...ms].sort((a, b) => a - b);
  }
  return {
    years: [...years].sort(),
    yearMonths: yearMonthArr,
    yearQuarters,
  };
}

/**
 * 期間內每個粒度（月報=日、季報=月、年報=月）的摘要行。
 */
export type PeriodSummaryRow = {
  key: string; // YYYY-MM-DD or YYYY-MM
  order_count: number;
  revenue: number;
  label_count: number;
  by_channel: Record<string, number>;
};

export function summarizeByPeriod(
  orders: Order[],
  period: Period,
  dayTypeOf: (iso: string) => DayType
): PeriodSummaryRow[] {
  const filtered = filterByPeriod(orders, period, dayTypeOf).filter(
    (o) => o.status === "confirmed" || o.status === "kol_shipped"
  );
  const granularity = period.type === "month" ? "day" : "month"; // 月報看日、季/年報看月
  const bucket = new Map<string, PeriodSummaryRow>();
  for (const o of filtered) {
    const shipDate = effectiveShipDate(o, dayTypeOf);
    if (!shipDate) continue;
    const key = granularity === "day" ? shipDate : shipDate.slice(0, 7);
    if (!bucket.has(key)) {
      bucket.set(key, {
        key,
        order_count: 0,
        revenue: 0,
        label_count: 0,
        by_channel: {},
      });
    }
    const r = bucket.get(key)!;
    r.order_count++;
    r.revenue += o.revenue.grossTotal;
    r.label_count += o.labelCount;
    r.by_channel[o.channel] = (r.by_channel[o.channel] ?? 0) + 1;
  }
  return [...bucket.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// ---- utils ----
function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0).getDate();
  return pad(d);
}
