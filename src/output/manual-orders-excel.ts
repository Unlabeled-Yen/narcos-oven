/**
 * manual-orders-excel.ts · 手打單匯出 xlsx
 *
 * Yen 2026-07-04：分類（全部手打 / KOL / 駐店 / 彈性 / 宅配 / 面交_*）+ 日期範圍
 *   訂單篩選：id 前綴 MAN- + channel filter + date range（order_date 或 batchDate）
 *   輸出：單一 sheet · 15 欄 · 每張訂單一列（多品項一行合併）
 */
import type { ChannelId, Menu, Order } from "../domain/models";
import { getDisplayName } from "../domain/menu";
import {
  aoaToSheet,
  buildWorkbook,
  writeWorkbookBuffer,
  downloadBlob,
} from "./utils";

export type ManualExportFilter =
  | "全部手打"
  | "KOL"
  | "駐店"
  | "彈性"
  | "宅配"
  | "面交_中壢"
  | "面交_台中"
  | "面交_其他";

export function isManualOrder(o: Order): boolean {
  if (o.id.startsWith("MAN-")) return true;
  if (o.channel === "駐店" || o.channel === "彈性") return true;
  return false;
}

export function filterManualOrders(
  orders: Order[],
  filter: ManualExportFilter,
  dateFrom: string | null, // ISO YYYY-MM-DD or null
  dateTo: string | null
): Order[] {
  return orders.filter((o) => {
    if (!isManualOrder(o)) return false;
    if (filter !== "全部手打" && o.channel !== (filter as ChannelId)) return false;
    if (dateFrom && (!o.order_date || o.order_date < dateFrom)) return false;
    if (dateTo && (!o.order_date || o.order_date > dateTo)) return false;
    return true;
  });
}

function itemsText(o: Order, menu: Menu): string {
  return o.items
    .map((it) => {
      const name = it.productSkuId ? (menu.products[it.productSkuId]?.display_name ?? it.rawName) : it.rawName;
      return `${name}×${it.quantity}`;
    })
    .join("\n");
}

function atomsText(o: Order, menu: Menu): string {
  const m = new Map<string, number>();
  for (const it of o.items) {
    for (const a of it.atoms) {
      m.set(a.atomId, (m.get(a.atomId) ?? 0) + a.count);
    }
  }
  return [...m.entries()].map(([atom, n]) => `${getDisplayName(atom, menu)}×${n}`).join(", ");
}

export function buildManualOrdersWorkbook(
  orders: Order[],
  menu: Menu,
  filter: ManualExportFilter,
  dateFrom: string | null,
  dateTo: string | null
) {
  const list = filterManualOrders(orders, filter, dateFrom, dateTo);

  const header = [
    "訂單編號", "通路", "下單日", "指定出貨日", "出貨日",
    "姓名", "IG/LINE", "電話", "超商店號", "宅配地址",
    "品項", "atoms 展開", "標籤數", "金額", "運費", "折扣", "備註",
  ];

  const rows: (string | number | null)[][] = [header];

  for (const o of list) {
    rows.push([
      o.id,
      o.channel,
      o.order_date ?? "",
      o.customer_wish_date ?? "",
      o.batchDate ?? "",
      o.recipient.name ?? "",
      o.recipient.igOrLine ?? "",
      o.recipient.phone ?? "",
      o.recipient.convStore ?? "",
      o.recipient.address ?? "",
      itemsText(o, menu),
      atomsText(o, menu),
      o.labelCount,
      o.revenue.grossTotal,
      o.revenue.freight,
      o.revenue.discount,
      o.rawSource.rawStatus ?? "",
    ]);
  }

  // 摘要列
  const totalGross = list.reduce((s, o) => s + o.revenue.grossTotal, 0);
  const totalLabels = list.reduce((s, o) => s + o.labelCount, 0);
  rows.push([]);
  rows.push([`合計：${list.length} 單`, "", "", "", "", "", "", "", "", "", "", "", totalLabels, totalGross, "", "", ""]);

  const sheet = aoaToSheet(rows);
  const wb = buildWorkbook([{ name: `手打單_${filter}`, sheet }]);
  return { workbook: wb, count: list.length, totalGross, totalLabels };
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 直接觸發下載
 */
export function exportManualOrders(
  orders: Order[],
  menu: Menu,
  filter: ManualExportFilter,
  dateFrom: string | null,
  dateTo: string | null
): { count: number; totalGross: number; totalLabels: number } {
  const { workbook, count, totalGross, totalLabels } = buildManualOrdersWorkbook(
    orders,
    menu,
    filter,
    dateFrom,
    dateTo
  );
  const buffer = writeWorkbookBuffer(workbook);
  const range = dateFrom || dateTo ? `${dateFrom ?? "全"}_${dateTo ?? "全"}` : "全時段";
  const filename = `手打單_${filter}_${range}_匯出${todayISO()}.xlsx`;
  downloadBlob(buffer, filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  return { count, totalGross, totalLabels };
}
