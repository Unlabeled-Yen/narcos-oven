/**
 * 分潤統計 Excel
 * 對應「＠ 參考 目前 AI 提供內容/分潤統計.xlsx」格式 + 雇主 confirm #5
 *
 * 每個 batch_date 一列：筆數、總營收、品牌 50%、主廚 30%、行銷 20%、
 * 物流實付估算、淨營收
 */
import type { Menu, Order } from "../domain/models";
import { aoaToSheet, buildWorkbook, ordersForOutput, pendingBatchLabel, writeWorkbookBuffer } from "./utils";

const BRAND_RATIO = 0.5;
const CHEF_RATIO = 0.3;
const MARKETING_RATIO = 0.2;

/** 依 order.channel 找 logistics_cost 對應 key。 */
function logisticsCostFor(o: Order, menu: Menu): number {
  const table = menu.logistics_cost ?? {};
  if (o.channel === "賣貨便") {
    // 賣貨便有 c17 運費、但那是「買家付的、店家再付給物流」
    // 用 menu.yaml 「賣貨便_超商」or「賣貨便_宅配」預設
    // 這裡簡化：用 freight 有值 → 假設實付跟 freight 差不多；否則用預設
    return table["賣貨便_超商"] ?? 60;
  }
  if (o.channel === "宅配") return table["宅配"] ?? 130;
  if (o.channel.startsWith("面交")) return table["面交"] ?? 0;
  if (o.channel === "KOL") return table["KOL"] ?? 60;
  return 0;
}

export function buildPayoutWorkbook(orders: Order[], menu: Menu) {
  const outputOrders = ordersForOutput(orders);
  const byDate = new Map<string, Order[]>();
  for (const o of outputOrders) {
    const d = pendingBatchLabel(o);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(o);
  }

  const header = [
    "批次",
    "筆數",
    "總營收",
    "品牌 50%",
    "主廚 30%",
    "行銷 20%",
    "物流實付估算",
    "淨營收（總 − 物流）",
    "備註",
  ];
  const rows: (string | number)[][] = [header];
  let totalCount = 0;
  let totalRevenue = 0;
  let totalLogistics = 0;

  for (const d of [...byDate.keys()].sort()) {
    const batchOrders = byDate.get(d)!;
    let revenue = 0;
    let logistics = 0;
    for (const o of batchOrders) {
      revenue += o.revenue.grossTotal;
      logistics += logisticsCostFor(o, menu);
    }
    const brand = Math.round(revenue * BRAND_RATIO);
    const chef = Math.round(revenue * CHEF_RATIO);
    const marketing = Math.round(revenue * MARKETING_RATIO);
    const net = revenue - logistics;
    rows.push([
      d,
      batchOrders.length,
      revenue,
      brand,
      chef,
      marketing,
      logistics,
      net,
      "",
    ]);
    totalCount += batchOrders.length;
    totalRevenue += revenue;
    totalLogistics += logistics;
  }

  // 合計
  const totalBrand = Math.round(totalRevenue * BRAND_RATIO);
  const totalChef = Math.round(totalRevenue * CHEF_RATIO);
  const totalMarketing = Math.round(totalRevenue * MARKETING_RATIO);
  const totalNet = totalRevenue - totalLogistics;
  rows.push([
    "合計",
    totalCount,
    totalRevenue,
    totalBrand,
    totalChef,
    totalMarketing,
    totalLogistics,
    totalNet,
    "",
  ]);

  // 註解
  rows.push([]);
  rows.push([
    "⚠️ 品牌 50% 未扣除食材+包材（雇主 R2-4 承諾之後提供）；物流成本用 menu.yaml logistics_cost 預設值",
  ]);
  rows.push([
    "⚠️ v1 賣貨便運費算「總營收」（雇主 R2-5 confirm：錢到店家再付物流）",
  ]);

  const sheet = aoaToSheet(rows);
  return buildWorkbook([{ name: "分潤統計", sheet }]);
}

export function writePayoutExcel(orders: Order[], menu: Menu): Uint8Array {
  return writeWorkbookBuffer(buildPayoutWorkbook(orders, menu));
}
