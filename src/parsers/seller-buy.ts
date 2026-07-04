/**
 * 賣貨便 xlsx parser
 * 對應 docs/spec.md §3 Stage 1-3
 *
 * 處理原則（憲章原則 1）：
 * - 所有 numeric 欄位必經 toNum
 * - 訂單延續行合併（c0-c11 空白代表延續上列）
 * - 付款狀態 filter (c5) → pending_payment（雇主 confirm #3）
 * - 金額對帳: A + B - C - D - E === c21（防護 #2）
 * - 品項 lookup 失敗 → pending_product
 * - c22 = 標籤數（雇主 confirm #1）
 */
import * as XLSX from "xlsx";
import type {
  Menu,
  Order,
  OrderItem,
  PendingReason,
  ParseResult,
} from "../domain/models";
import { toNum } from "../domain/utils";
import { explodeToAtoms } from "../domain/menu";
import { lookupSkuStrict } from "../domain/menu-lookup";
import { readSheetTolerant } from "../domain/xlsx-tolerant";
import {
  extractSellerBuyShippingDate,
  dateToIso,
  parseSellerBuyOrderDate,
} from "../domain/batch-date";
// 工時 / wish_priority 依 Yen 2026-07-03 決策拿掉、parser 不填

const SHEET_NAME = "非訂單匯入";
const HEADER_ROW_COUNT = 3; // 前 3 列是 header/title

/**
 * 讀 xlsx buffer、輸出 ParseResult。
 */
export function parseSellerBuy(
  buffer: ArrayBuffer,
  sourceFile: string,
  menu: Menu
): ParseResult {
  const wb = XLSX.read(buffer, { type: "array" });
  const sh = wb.Sheets[SHEET_NAME];
  if (!sh) {
    throw new Error(
      `賣貨便檔案缺 sheet「${SHEET_NAME}」，實際 sheets：${wb.SheetNames.join(",")}`
    );
  }

  // ⚠️ 賣貨便匯出的 xlsx 常有 broken !ref（宣告 A1:AMO3 但實際資料延伸到 row 60+）
  // 直接信 SheetJS sheet_to_json 會靜默漏掉全部資料。手動掃 cell keys 找真實範圍。
  const rows = readSheetTolerant(sh);

  const orders: Order[] = [];
  let current: WipOrder | null = null;
  let rawRowCount = 0;

  for (let i = HEADER_ROW_COUNT; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const c4 = r[4]; // 訂單編號
    const c12 = r[12]; // 商品名稱

    // ⚠️ 賣貨便延續行 c4 可能也填了同 order_id（merged cells 匯出），
    // 不能單看 c4 有值就當新訂單。必須 c4 值跟上一筆不同才算新訂單。
    const c4Str = isNonEmpty(c4) ? c4.trim() : null;
    const isNewOrder = c4Str !== null && c4Str !== current?.order_id;

    if (isNewOrder) {
      if (current) orders.push(finalizeOrder(current, menu));
      current = beginOrder(r, i + 1, sourceFile);
      rawRowCount++;
    } else if (isNonEmpty(c12) && current) {
      // 延續品項行（c4 可能空或等於上一筆）
      current.items.push(makeRawItem(r));
    }
  }
  if (current) orders.push(finalizeOrder(current, menu));

  // wish_priority / estimated_production_hours 拿掉、Order 物件建構時已預設 null

  return {
    orders,
    raw_row_count: rawRowCount,
    source_file: sourceFile,
  };
}

// ---------- 內部 helpers ----------

type RawItem = {
  name: string;
  price: number | null;
  qty: number | null;
  subtotal: number | null;
};

type WipOrder = {
  order_id: string;
  status_raw: string;
  c22: number | null;
  freight: number | null;
  discount: number;
  total: number | null;
  notes: string;
  items: RawItem[];
  recipient_name: string | null;
  conv_store: string | null;
  order_date: Date | null;
  rowIndex: number;
  sourceFile: string;
};

function isNonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function beginOrder(r: unknown[], rowIndex: number, sourceFile: string): WipOrder {
  return {
    order_id: String(r[4]).trim(),
    status_raw: r[5] != null ? String(r[5]) : "",
    c22: toNum(r[22]),
    freight: toNum(r[17]),
    discount: (toNum(r[18]) ?? 0) + (toNum(r[19]) ?? 0) + (toNum(r[20]) ?? 0),
    total: toNum(r[21]),
    notes: r[28] != null ? String(r[28]).trim() : "",
    items: r[12] != null ? [makeRawItem(r)] : [],
    recipient_name: r[7] != null ? String(r[7]).trim() : null,
    conv_store: r[11] != null ? String(r[11]).trim() : null,
    order_date: parseSellerBuyOrderDate(r[3]),
    rowIndex,
    sourceFile,
  };
}

function makeRawItem(r: unknown[]): RawItem {
  return {
    name: String(r[12] ?? "").trim(),
    price: toNum(r[13]),
    qty: toNum(r[15]),
    subtotal: toNum(r[16]),
  };
}

function finalizeOrder(w: WipOrder, menu: Menu): Order {
  const pendingReasons: PendingReason[] = [];

  // ---- 憲章 Stage 1: 付款 filter ----
  const paid = w.status_raw.includes("付款完成");
  if (!paid) {
    pendingReasons.push({
      code: "PAYMENT_NOT_CONFIRMED",
      humanMessage: `訂單 ${w.order_id} 尚未付款（狀態：${w.status_raw.split("\n")[0]}）`,
      suggestionConfidence: 0,
    });
  }

  // ---- Stage 4: 出爐日抓取（從指定出貨日 marker）----
  let batchDate: string | null = null;
  for (const raw of w.items) {
    if (raw.name.includes("指定出貨日")) {
      batchDate = extractSellerBuyShippingDate(raw.name, w.order_date);
      break;
    }
  }
  // 憲章新政策（2026-07-03）：無指定日不再是需要 resolve 的 pending reason
  // 訂單直接進待排列表、由雇主拖到日欄拍板；待排 UI 已有「有指定日 / 無指定日」分類

  // ---- Stage 2: Menu lookup + Combo 拆解 ----
  const items: OrderItem[] = [];
  for (const raw of w.items) {
    // 跳過「指定出貨日 marker」
    if (raw.name.includes("指定出貨日")) continue;

    const result = lookupSkuStrict(raw.name, menu);
    if (result.kind !== "found") {
      const humanMessage = result.kind === "none"
        ? `賣貨便「商品名稱」欄=「${raw.name.slice(0, 50)}」無法對到 menu.yaml SKU`
        : `賣貨便「商品名稱」欄=「${raw.name.slice(0, 50)}」match 多個 SKU 候選（${result.candidates.join(" / ")}）· ${result.reason}`;
      pendingReasons.push({
        code: "UNKNOWN_PRODUCT",
        humanMessage,
        suggestionConfidence: 0,
      });
      items.push({
        productSkuId: null,
        rawName: raw.name,
        quantity: raw.qty ?? 1,
        subtotal: raw.subtotal,
        atoms: [],
      });
      continue;
    }
    const skuId = result.skuId;
    const qty = raw.qty ?? 1;
    const perUnitAtoms = explodeToAtoms(skuId, menu);
    items.push({
      productSkuId: skuId,
      rawName: raw.name,
      quantity: qty,
      subtotal: raw.subtotal,
      atoms: perUnitAtoms.map((a) => ({ atomId: a.atomId, count: a.count * qty })),
    });
  }

  // ---- Stage 3: 金額對帳 ----
  if (w.total !== null) {
    const subSum = items.reduce((s, it) => s + (it.subtotal ?? 0), 0);
    const expected = subSum + (w.freight ?? 0) - w.discount;
    const diff = Math.abs(expected - w.total);
    if (diff > 2) {
      pendingReasons.push({
        code: "AMOUNT_MISMATCH",
        humanMessage: `金額不符：預期 $${expected} vs 實際 c21 $${w.total}（差 $${diff}）`,
        suggestionConfidence: 0,
      });
    }
  }

  // ---- Stage 5: 標籤數 (雇主 confirm #1 每箱一張) ----
  const labelCount = w.c22 !== null ? Math.max(1, Math.floor(w.c22)) : 1;

  // ---- 決定 status（優先度：付款 > 品項未歸類 > 金額不符 > 缺出爐日）----
  const status: Order["status"] = deriveStatus(pendingReasons);

  const now = new Date().toISOString();
  // c12_product 只留品項名（保持乾淨、指定出貨日走專用欄位 customer_wish_date 監控）
  const productKey = w.items
    .filter((it) => !it.name.includes("指定出貨日"))
    .map((it) => it.name)
    .join("\n");

  // Yen 2026-07-03：拿掉「客人指定日自動排入」· batchDate 匯入時一律 null、雇主拖入才拍板
  //   customer_wish_date 仍保留、供待排 chip「📌 指定 MM/DD」提示
  return {
    id: w.order_id,
    channel: "賣貨便",
    status,
    batchDate: null,
    recipient: {
      name: w.recipient_name,
      igOrLine: null,
      phone: null,
      address: null,
      convStore: w.conv_store,
    },
    items,
    revenue: {
      grossTotal: w.total ?? 0,
      freight: w.freight ?? 0,
      discount: w.discount,
    },
    labelCount,
    pendingReasons,
    rawSource: {
      file: w.sourceFile,
      sheet: SHEET_NAME,
      rowIndex: w.rowIndex,
      rawStatus: w.status_raw,
    },
    snapshot: {
      c1_order_date: dateToIso(w.order_date),
      c5_status: w.status_raw,
      c11_conv_store: w.conv_store,
      c12_product: productKey,
      c17_freight: w.freight,
      c18_discount_seller: 0, // 單獨欄記錄一起累加為 discount、diff 時全體比較
      c19_discount_freight: 0,
      c20_discount_platform: w.discount, // 統一放這（M3 保守做法）
      c21_total: w.total,
      c22_label_count: w.c22,
      customer_wish_date: batchDate, // Yen 2026-07-04：進 snapshot 讓 diff 偵測客人改期
    },
    order_date: dateToIso(w.order_date),
    customer_wish_date: batchDate,
    system_suggested_date: null,
    assignment_source: "pending",
    wish_priority: null, // 稍後 derive
    estimated_production_hours: null, // 稍後 derive
    first_seen_at: now,
    last_seen_at: now,
    disappeared_at: null,
    disappeared_resolution: null,
    frozen_after_label_print: false,
    changes: [],
  };
}

function deriveStatus(reasons: PendingReason[]): Order["status"] {
  if (reasons.length === 0) return "confirmed";
  // 優先度
  for (const p of reasons) {
    if (p.code === "PAYMENT_NOT_CONFIRMED") return "pending_payment";
  }
  for (const p of reasons) {
    if (p.code === "UNKNOWN_PRODUCT") return "pending_product";
  }
  for (const p of reasons) {
    if (p.code === "AMOUNT_MISMATCH") return "pending_amount";
  }
  for (const p of reasons) {
    if (p.code === "MISSING_BATCH_DATE") return "pending_batch_date";
  }
  return "pending_amount";
}
