/**
 * MCP tools 實作
 * 每個 tool 回傳結構含 sourceOrderIds（憲章 #8 LLM 答案附引用）。
 */
import type { Menu, Order } from "../domain/models";
import { calculateBOM } from "../domain/bom";
import { productionTimeline } from "../domain/production-timeline";
import { suggestScheduleV2 } from "../domain/scheduler-v2";
import {
  filterByPeriod,
  periodLabel,
  summarizeByPeriod,
  type Period,
} from "../domain/period";
import { makeDayTypeOf } from "../domain/day-type";
import { effectiveShipDate } from "../domain/effective-ship-date";
import { checkReleaseGate } from "../domain/release-gate";

/**
 * #6 2026-08-06：MCP server 沒有瀏覽器 localStorage，拿不到雇主在網頁上設的
 * 單日 override（narcos-day-overrides）——只能用 menu.scheduling 的星期幾
 * 預設規則。這是已知落差、不是這裡能補的（要補得先把 day override 也匯進
 * state.json），但用「星期幾預設」規則本來就比完全不解析出貨日（純看原始
 * batchDate）更準，仍是淨改善。
 */
function mcpDayTypeOf(menu: Menu) {
  return makeDayTypeOf(menu, {});
}

/**
 * get_pending_batches: 找出所有需要排出爐日的訂單
 */
export function getPendingBatches(orders: Order[]) {
  const pending = orders.filter(
    (o) => o.assignment_source === "pending" && o.status === "confirmed"
  );
  return {
    count: pending.length,
    sourceOrderIds: pending.map((o) => o.id),
    orders: pending.map((o) => ({
      id: o.id,
      channel: o.channel,
      customer_wish_date: o.customer_wish_date,
      recipient_name: o.recipient.name,
      total: o.revenue.grossTotal,
    })),
  };
}

/**
 * query_batch: 查某天的所有訂單
 */
export function queryBatch(orders: Order[], date: string, menu: Menu) {
  const batchOrders = orders.filter(
    (o) => o.batchDate === date && (o.status === "confirmed" || o.status === "kol_shipped")
  );
  const atomTotals: Record<string, number> = {};
  let totalRevenue = 0;
  let totalLabels = 0;
  const byChannel: Record<string, number> = {};
  for (const o of batchOrders) {
    totalRevenue += o.revenue.grossTotal;
    totalLabels += o.labelCount;
    byChannel[o.channel] = (byChannel[o.channel] ?? 0) + 1;
    for (const it of o.items) {
      for (const a of it.atoms) {
        atomTotals[a.atomId] = (atomTotals[a.atomId] ?? 0) + a.count;
      }
    }
  }
  return {
    batch_date: date,
    order_count: batchOrders.length,
    total_revenue: totalRevenue,
    total_labels: totalLabels,
    by_channel: byChannel,
    atom_totals: atomTotals,
    menu_units: Object.fromEntries(
      Object.entries(atomTotals).map(([a]) => [a, menu.atoms[a]?.unit ?? ""])
    ),
    sourceOrderIds: batchOrders.map((o) => o.id),
  };
}

/**
 * get_bom: 該批次備料清單
 */
export function getBom(orders: Order[], date: string, menu: Menu) {
  const bom = calculateBOM(date, orders, menu);
  return {
    batch_date: date,
    order_count: bom.order_count,
    lines: bom.lines,
    warnings: bom.warnings,
    sourceOrderIds: orders
      .filter((o) => o.batchDate === date && o.status === "confirmed")
      .map((o) => o.id),
  };
}

/**
 * get_timeline: 該批次製作時程回推
 */
export function getTimeline(orders: Order[], date: string, menu: Menu) {
  const tl = productionTimeline(date, orders, menu);
  return {
    batch_date: date,
    steps: tl.steps,
    sourceOrderIds: orders
      .filter((o) => o.batchDate === date && o.status === "confirmed")
      .map((o) => o.id),
  };
}

/**
 * period_summary: 期間摘要（月/季/年）
 */
export function getPeriodSummary(orders: Order[], period: Period, menu: Menu) {
  const dayTypeOf = mcpDayTypeOf(menu);
  const summary = summarizeByPeriod(orders, period, dayTypeOf);
  const filtered = filterByPeriod(orders, period, dayTypeOf).filter(
    (o) => o.status === "confirmed" || o.status === "kol_shipped"
  );
  return {
    period: periodLabel(period),
    granularity: period.type === "month" ? "day" : "month",
    row_count: summary.length,
    summary,
    total_orders: filtered.length,
    total_revenue: filtered.reduce((s, o) => s + o.revenue.grossTotal, 0),
    total_labels: filtered.reduce((s, o) => s + o.labelCount, 0),
    sourceOrderIds: filtered.map((o) => o.id),
  };
}

/**
 * get_payout: 分潤（可加 period filter）
 */
export function getPayout(orders: Order[], menu: Menu, period?: Period) {
  const dayTypeOf = mcpDayTypeOf(menu);
  const filtered = period
    ? filterByPeriod(orders, period, dayTypeOf).filter((o) => o.status === "confirmed")
    : orders.filter((o) => o.status === "confirmed" && effectiveShipDate(o, dayTypeOf));
  const byDate = new Map<string, Order[]>();
  for (const o of filtered) {
    const d = effectiveShipDate(o, dayTypeOf)!;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(o);
  }
  const batches = [] as {
    date: string;
    count: number;
    revenue: number;
    brand_50: number;
    chef_30: number;
    marketing_20: number;
  }[];
  let tCount = 0, tRevenue = 0;
  for (const d of [...byDate.keys()].sort()) {
    const list = byDate.get(d)!;
    const revenue = list.reduce((s, o) => s + o.revenue.grossTotal, 0);
    batches.push({
      date: d,
      count: list.length,
      revenue,
      brand_50: Math.round(revenue * 0.5),
      chef_30: Math.round(revenue * 0.3),
      marketing_20: Math.round(revenue * 0.2),
    });
    tCount += list.length;
    tRevenue += revenue;
  }
  return {
    period: period ? periodLabel(period) : "all",
    total_orders: tCount,
    total_revenue: tRevenue,
    total_brand: Math.round(tRevenue * 0.5),
    total_chef: Math.round(tRevenue * 0.3),
    total_marketing: Math.round(tRevenue * 0.2),
    batches,
    sourceOrderIds: filtered.map((o) => o.id),
  };
}

/**
 * search_orders: search by 姓名 / IG / phone (substring match)
 */
export function searchOrders(orders: Order[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return { query, count: 0, matches: [], sourceOrderIds: [] };
  const matches = orders.filter((o) => {
    const name = o.recipient.name?.toLowerCase() ?? "";
    const ig = o.recipient.igOrLine?.toLowerCase() ?? "";
    const phone = o.recipient.phone?.toLowerCase() ?? "";
    return name.includes(q) || ig.includes(q) || phone.includes(q) || o.id.toLowerCase().includes(q);
  });
  return {
    query,
    count: matches.length,
    matches: matches.map((o) => ({
      id: o.id,
      channel: o.channel,
      status: o.status,
      batchDate: o.batchDate,
      recipient: o.recipient,
      total: o.revenue.grossTotal,
    })),
    sourceOrderIds: matches.map((o) => o.id),
  };
}

/**
 * get_disappeared_pending: 消失待決議清單（憲章 #9）
 */
export function getDisappearedPending(orders: Order[]) {
  const list = orders.filter(
    (o) => o.status === "disappeared_pending_resolution"
  );
  return {
    count: list.length,
    orders: list.map((o) => ({
      id: o.id,
      channel: o.channel,
      recipient_name: o.recipient.name,
      batchDate: o.batchDate,
      last_seen_at: o.last_seen_at,
      disappeared_at: o.disappeared_at,
      total: o.revenue.grossTotal,
      frozen_after_label_print: o.frozen_after_label_print,
    })),
    sourceOrderIds: list.map((o) => o.id),
  };
}

/**
 * suggest_next_schedule: 系統目前對 pending 訂單的排程建議（read-only view）
 */
export function suggestNextSchedule(orders: Order[], menu: Menu) {
  const r = suggestScheduleV2(orders, menu);
  const strictCount = r.suggestions.filter((s) => s.wish_priority === "strict").length;
  const flexibleCount = r.suggestions.length - strictCount;
  return {
    suggestion_count: r.suggestions.length,
    strict_count: strictCount,
    flexible_count: flexibleCount,
    unscheduled_count: r.unscheduled.length,
    suggestions: r.suggestions,
    unscheduled: r.unscheduled,
    sourceOrderIds: [
      ...r.suggestions.map((s) => s.order_id),
      ...r.unscheduled.map((u) => u.order_id),
    ],
  };
}

/**
 * release_status: 憲章 gate 狀態（能不能產出 Excel/PDF）
 */
export function getReleaseStatus(orders: Order[]) {
  return checkReleaseGate(orders);
}
