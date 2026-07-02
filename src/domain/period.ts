/**
 * 期間篩選 helper（純函式）
 * 支援月 / 季 / 年 / 全部
 */
import type { Order } from "./models";

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

/** 依 batchDate 過濾。訂單無 batchDate 一律不入期間報表。 */
export function filterByPeriod(orders: Order[], period: Period): Order[] {
  const bounds = periodBounds(period);
  if (!bounds) return orders.filter((o) => !!o.batchDate);
  return orders.filter(
    (o) => o.batchDate !== null && o.batchDate >= bounds.start && o.batchDate <= bounds.end
  );
}

/** 檔名用的期間標籤，例：2026-07 / 2026-Q3 / 2026 / all */
export function periodLabel(p: Period): string {
  if (p.type === "all") return "all";
  if (p.type === "year") return String(p.year);
  if (p.type === "quarter") return `${p.year}-Q${p.quarter}`;
  return `${p.year}-${pad(p.month)}`;
}

/** 掃 orders 給出可選的年份、月份、季度、for UI dropdown */
export function getAvailablePeriods(orders: Order[]): {
  years: number[];
  yearMonths: Record<number, number[]>; // year → months (1-12)
  yearQuarters: Record<number, number[]>; // year → quarters (1-4)
} {
  const years = new Set<number>();
  const yearMonths: Record<number, Set<number>> = {};
  for (const o of orders) {
    if (!o.batchDate) continue;
    const m = /^(\d{4})-(\d{2})/.exec(o.batchDate);
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
  period: Period
): PeriodSummaryRow[] {
  const filtered = filterByPeriod(orders, period).filter(
    (o) => o.status === "confirmed" || o.status === "kol_shipped"
  );
  const granularity = period.type === "month" ? "day" : "month"; // 月報看日、季/年報看月
  const bucket = new Map<string, PeriodSummaryRow>();
  for (const o of filtered) {
    if (!o.batchDate) continue;
    const key = granularity === "day" ? o.batchDate : o.batchDate.slice(0, 7);
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
