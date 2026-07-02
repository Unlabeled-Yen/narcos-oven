/**
 * 出貨資料總覽 Excel
 * 每個 batch_date 一 sheet、列出該批所有訂單明細
 * 對應原「＠ 參考 目前 AI 提供內容/出貨總覽.xlsx」的格式
 */
import type { Menu, Order } from "../domain/models";
import {
  aoaToSheet,
  buildWorkbook,
  ordersForOutput,
  writeWorkbookBuffer,
} from "./utils";

function last5(orderId: string): string {
  if (orderId.startsWith("CM")) {
    return orderId.slice(-5);
  }
  if (orderId.startsWith("IP-")) return "面交";
  if (orderId.startsWith("KOL-")) return "KOL";
  return orderId.slice(-5);
}

function formatItems(o: Order, menu: Menu): string {
  const lines = o.items.map((it) => {
    const displayName = it.productSkuId
      ? menu.products[it.productSkuId]?.display_name ?? it.productSkuId
      : it.rawName;
    return `${displayName}  ×${it.quantity}`;
  });
  return lines.join("\n");
}

function contactLine(o: Order): string {
  if (o.recipient.igOrLine) return o.recipient.igOrLine;
  if (o.recipient.phone) return o.recipient.phone;
  return "";
}

export function buildOverviewWorkbook(orders: Order[], menu: Menu) {
  const outputOrders = ordersForOutput(orders);
  const byDate = new Map<string, Order[]>();
  for (const o of outputOrders) {
    const d = o.batchDate!;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(o);
  }
  const sheets: { name: string; sheet: ReturnType<typeof aoaToSheet> }[] = [];

  for (const d of [...byDate.keys()].sort()) {
    const batchOrders = byDate.get(d)!;
    const header = [
      "#",
      "單號後五碼",
      "姓名",
      "取件門市/通路",
      "訂購商品",
      "金額",
      "IG / LINE",
      "標籤數",
    ];
    const rows: (string | number)[][] = [header];
    let idx = 1;
    for (const o of batchOrders) {
      rows.push([
        idx++,
        last5(o.id),
        o.recipient.name ?? "",
        o.recipient.convStore ?? o.channel,
        formatItems(o, menu),
        o.revenue.grossTotal || "",
        contactLine(o),
        o.labelCount,
      ]);
    }
    // 品項統計小計
    rows.push([]);
    rows.push(["品項統計", "顆/罐", "", "", "", "", "", ""]);
    const atomCount = new Map<string, number>();
    for (const o of batchOrders) {
      for (const it of o.items) {
        for (const a of it.atoms) {
          atomCount.set(a.atomId, (atomCount.get(a.atomId) ?? 0) + a.count);
        }
      }
    }
    for (const [atomId, n] of [...atomCount.entries()].sort((a, b) => b[1] - a[1])) {
      const unit = menu.atoms[atomId]?.unit ?? "";
      rows.push([atomId, `${n} ${unit}`.trim(), "", "", "", "", "", ""]);
    }

    const sheet = aoaToSheet(rows);
    if (sheet["!cols"]) {
      // 增加訂購商品欄寬
      sheet["!cols"][4] = { wch: 45 };
    }
    sheets.push({ name: d, sheet });
  }

  if (sheets.length === 0) {
    // 空資料時建一個提示 sheet
    const sheet = aoaToSheet([["（本次無 confirmed 訂單）"]]);
    sheets.push({ name: "空", sheet });
  }

  return buildWorkbook(sheets);
}

export function writeOverviewExcel(orders: Order[], menu: Menu): Uint8Array {
  return writeWorkbookBuffer(buildOverviewWorkbook(orders, menu));
}
