/**
 * 期間摘要 Excel
 * 月報：每天一列
 * 季/年報：每月一列
 */
import type { Menu, Order } from "../domain/models";
import { periodLabel, summarizeByPeriod, type Period } from "../domain/period";
import { aoaToSheet, buildWorkbook, writeWorkbookBuffer } from "./utils";

export function buildPeriodSummaryWorkbook(
  orders: Order[],
  _menu: Menu,
  period: Period
) {
  const rows = summarizeByPeriod(orders, period);
  const isDay = period.type === "month";
  const header = [
    isDay ? "日期" : "月份",
    "訂單數",
    "總營收",
    "標籤數",
    "賣貨便",
    "面交",
    "宅配",
    "KOL",
    "其他",
  ];
  const out: (string | number)[][] = [header];
  let totOrders = 0;
  let totRevenue = 0;
  let totLabels = 0;
  const totCh: Record<string, number> = {};
  for (const r of rows) {
    const chs: Record<string, number> = { 賣貨便: 0, 面交: 0, 宅配: 0, KOL: 0, 其他: 0 };
    for (const [ch, n] of Object.entries(r.by_channel)) {
      const norm = ch === "賣貨便"
        ? "賣貨便"
        : ch.startsWith("面交")
        ? "面交"
        : ch === "宅配"
        ? "宅配"
        : ch === "KOL"
        ? "KOL"
        : "其他";
      chs[norm] += n;
      totCh[norm] = (totCh[norm] ?? 0) + n;
    }
    out.push([
      r.key,
      r.order_count,
      r.revenue,
      r.label_count,
      chs.賣貨便 || "",
      chs.面交 || "",
      chs.宅配 || "",
      chs.KOL || "",
      chs.其他 || "",
    ]);
    totOrders += r.order_count;
    totRevenue += r.revenue;
    totLabels += r.label_count;
  }
  out.push([
    "合計",
    totOrders,
    totRevenue,
    totLabels,
    totCh.賣貨便 || "",
    totCh.面交 || "",
    totCh.宅配 || "",
    totCh.KOL || "",
    totCh.其他 || "",
  ]);

  const sheet = aoaToSheet(out);
  const label = periodLabel(period);
  return buildWorkbook([{ name: `期間摘要 ${label}`.slice(0, 31), sheet }]);
}

export function writePeriodSummaryExcel(
  orders: Order[],
  menu: Menu,
  period: Period
): Uint8Array {
  return writeWorkbookBuffer(buildPeriodSummaryWorkbook(orders, menu, period));
}
