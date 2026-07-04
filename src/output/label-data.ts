/**
 * M5 標籤資料抽取（純函式、可 Node 測）
 *
 * 對每筆 confirmed + 有 batchDate 的訂單、展開成標籤資料。
 * 標籤數規則（雇主 confirm #1 + R2-5）：
 *   賣貨便: labelCount = order.labelCount (= c22)
 *   面交/KOL: labelCount = Σ item.quantity
 *
 * 分盒編號：total > 1 時 label 標「N-i」（例 3-1, 3-2, 3-3）
 */
import type { Menu, Order } from "../domain/models";

export type LabelKind = "賣貨便" | "面交" | "宅配" | "KOL" | "待分類";

export type LabelData = {
  order_id: string;
  batch_date: string;
  kind: LabelKind;

  /** 顯示層次：3 行
   *  賣貨便: [單號後五碼, 分盒編號+品項簡稱, 門市]
   *  面交:   [面交_中壢/台中/其他, 分盒編號+品項簡稱, IG 帳號]
   *  KOL:    [KOL, @IG + 分盒編號+品項簡稱, 面交註記]
   */
  top_line: string;
  mid_line: string;
  bottom_line: string;

  /** 分盒編號：single item 為空、multi item 為 "2-1" 等 */
  sub_number: string;

  /** 這筆訂單的第 i 張 / 共 N 張（後端做 assertion 用） */
  index: number;
  total: number;

  /** 產出警告 */
  warning?: string;
};

/**
 * 主入口。
 * @param orders 全部訂單
 * @param menu   含 label_short_forms
 * @param filter { batchDate?: 只印該日；channel?: 只印該通路 }
 */
export function extractLabels(
  orders: Order[],
  menu: Menu,
  filter?: { batchDate?: string; channel?: string }
): LabelData[] {
  const shorts = menu.label_short_forms ?? {};
  const labels: LabelData[] = [];

  const targets = orders.filter((o) => {
    // Yen 2026-07-04：加 shipped · 已確認出貨的訂單仍可能需重印標籤（漏印/遺失）
    if (o.status !== "confirmed" && o.status !== "kol_shipped" && o.status !== "shipped") return false;
    if (!o.batchDate) return false;
    if (filter?.batchDate && o.batchDate !== filter.batchDate) return false;
    if (filter?.channel && o.channel !== filter.channel) return false;
    return true;
  });

  for (const o of targets) {
    // 展開該訂單需要印幾張標籤
    // 每個 item 依 quantity 展開為 N 個 label entry
    const rows: { item_idx: number; sub_of: number; sku_id: string; raw_name: string }[] = [];
    for (const it of o.items) {
      for (let i = 0; i < it.quantity; i++) {
        rows.push({
          item_idx: rows.length,
          sub_of: it.quantity,
          sku_id: it.productSkuId ?? "",
          raw_name: it.rawName,
        });
      }
    }

    // 賣貨便的實際印張數應 = c22（可能 < items.length 若合印）
    // v1: 忽略 c22 vs rows.length 差、直接印 rows。若賣貨便有 mismatch flag 之
    let warning: string | undefined;
    if (o.channel === "賣貨便" && o.labelCount !== rows.length) {
      warning = `c22=${o.labelCount} 但實際品項=${rows.length}、以品項數為準`;
    }

    const total = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const shortLabel = shorts[row.sku_id] ?? row.raw_name.slice(0, 20);
      const subNumber = total > 1 ? `${total}-${i + 1}` : "";
      labels.push(buildLabel(o, subNumber, shortLabel, i + 1, total, warning));
    }
  }

  return labels;
}

function buildLabel(
  o: Order,
  subNumber: string,
  shortLabel: string,
  index: number,
  total: number,
  warning: string | undefined
): LabelData {
  const kind = channelToKind(o.channel);
  const midLineWithSub = subNumber
    ? `${subNumber}  ${shortLabel.replace("\n", "  ")}`
    : shortLabel.replace("\n", "  ");

  if (kind === "賣貨便") {
    // 賣貨便: [後五碼 (大)] / [分盒+品項] / [門市]
    const last5 = o.id.startsWith("CM") ? o.id.slice(-5) : o.id;
    return {
      order_id: o.id,
      batch_date: o.batchDate!,
      kind,
      top_line: last5,
      mid_line: midLineWithSub,
      bottom_line: o.recipient.convStore ?? "",
      sub_number: subNumber,
      index,
      total,
      warning,
    };
  }
  if (kind === "面交" || kind === "宅配") {
    const label = o.channel === "宅配" ? "宅配"
      : o.channel === "面交_中壢" ? "中壢面交"
      : o.channel === "面交_台中" ? "台中面交"
      : "面交";
    return {
      order_id: o.id,
      batch_date: o.batchDate!,
      kind,
      top_line: label,
      mid_line: midLineWithSub,
      bottom_line: o.recipient.igOrLine ?? o.recipient.name ?? "",
      sub_number: subNumber,
      index,
      total,
      warning,
    };
  }
  if (kind === "KOL") {
    const ig = o.recipient.igOrLine ? `@${o.recipient.igOrLine.replace(/^@/, "")}` : "";
    return {
      order_id: o.id,
      batch_date: o.batchDate!,
      kind,
      top_line: "KOL",
      mid_line: ig,
      bottom_line: midLineWithSub,
      sub_number: subNumber,
      index,
      total,
      warning,
    };
  }
  // 待分類
  return {
    order_id: o.id,
    batch_date: o.batchDate!,
    kind: "待分類",
    top_line: "待分類",
    mid_line: midLineWithSub,
    bottom_line: o.recipient.name ?? "",
    sub_number: subNumber,
    index,
    total,
    warning,
  };
}

function channelToKind(channel: Order["channel"]): LabelKind {
  if (channel === "賣貨便") return "賣貨便";
  if (channel.startsWith("面交")) return "面交";
  if (channel === "宅配") return "宅配";
  if (channel === "KOL") return "KOL";
  return "待分類";
}
