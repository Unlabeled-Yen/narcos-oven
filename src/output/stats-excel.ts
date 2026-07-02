/**
 * 出爐統計 Excel
 * 對應原「＠ 參考 目前 AI 提供內容/出爐統計.xlsx」格式：
 *   品項 (atom) × 出爐日 × 通路 = 顆數
 *
 * 通路標題形式:
 *   6/23 賣貨便 / 6/23 面交 / 6/23 KOL / 7/07 賣貨便 / ...
 */
import type { Menu, Order } from "../domain/models";
import { aoaToSheet, buildWorkbook, ordersForOutput, writeWorkbookBuffer } from "./utils";

type Channel = "賣貨便" | "面交" | "宅配" | "KOL" | "其他";

function normalizeChannel(orderChannel: string): Channel {
  if (orderChannel === "賣貨便") return "賣貨便";
  if (orderChannel.startsWith("面交")) return "面交";
  if (orderChannel === "宅配") return "宅配";
  if (orderChannel === "KOL") return "KOL";
  return "其他";
}

const CHANNEL_ORDER: Channel[] = ["賣貨便", "面交", "宅配", "KOL", "其他"];

export function buildStatsWorkbook(orders: Order[], menu: Menu) {
  const outputOrders = ordersForOutput(orders);
  const atoms = Object.keys(menu.atoms);

  // 收集所有 batch_date × channel 組合
  const dateChannels = new Map<string, Set<Channel>>();
  for (const o of outputOrders) {
    const d = o.batchDate!;
    const ch = normalizeChannel(o.channel);
    if (!dateChannels.has(d)) dateChannels.set(d, new Set());
    dateChannels.get(d)!.add(ch);
  }
  const dates = [...dateChannels.keys()].sort();
  const columns: { date: string; channel: Channel; label: string }[] = [];
  for (const d of dates) {
    for (const ch of CHANNEL_ORDER) {
      if (dateChannels.get(d)!.has(ch)) {
        columns.push({ date: d, channel: ch, label: `${d}\n${ch}` });
      }
    }
  }

  // 每個 (atom, date, channel) 的計數
  const counts = new Map<string, number>();
  for (const o of outputOrders) {
    const d = o.batchDate!;
    const ch = normalizeChannel(o.channel);
    for (const it of o.items) {
      for (const a of it.atoms) {
        const key = `${a.atomId}||${d}||${ch}`;
        counts.set(key, (counts.get(key) ?? 0) + a.count);
      }
    }
  }

  // 建表
  const header = ["品項", ...columns.map((c) => c.label), "合計"];
  const rows: (string | number)[][] = [header];
  const colSums = new Array(columns.length).fill(0);
  for (const atomId of atoms) {
    let rowSum = 0;
    const rowData: (string | number)[] = [
      `${atomId}${menu.atoms[atomId] ? ` (${menu.atoms[atomId].unit})` : ""}`,
    ];
    for (let ci = 0; ci < columns.length; ci++) {
      const col = columns[ci]!;
      const n = counts.get(`${atomId}||${col.date}||${col.channel}`) ?? 0;
      rowData.push(n || "");
      rowSum += n;
      colSums[ci] += n;
    }
    rowData.push(rowSum || "");
    // 只保留有數字的列
    if (rowSum > 0) rows.push(rowData);
  }
  // 合計列
  const totalRow: (string | number)[] = ["合計"];
  for (let ci = 0; ci < columns.length; ci++) totalRow.push(colSums[ci] || "");
  totalRow.push(colSums.reduce((s, n) => s + n, 0));
  rows.push(totalRow);

  const sheet = aoaToSheet(rows);
  // 標題那欄字寬
  if (sheet["!cols"]) sheet["!cols"][0] = { wch: 22 };

  return buildWorkbook([{ name: "出爐統計", sheet }]);
}

export function writeStatsExcel(orders: Order[], menu: Menu): Uint8Array {
  return writeWorkbookBuffer(buildStatsWorkbook(orders, menu));
}
