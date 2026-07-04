/**
 * 面交 Google Form xlsx parser
 * 對應 docs/spec.md §3 Stage 1-3 + §4 面交 c2 解析
 *
 * Sheet: 表單回覆 1
 * Row 1: header
 * 每列一筆訂單。
 *
 * c2 「在哪邊取貨！」regex 主軌：
 *   地點：中壢/台中/台北/新竹/高雄/桃園/台南/嘉義/澎湖
 *   日期：\d+/\d+
 *   類型：面交/冷凍宅配/宅配/駐店/活動/私定
 *
 * 憲章原則：任何欄位缺 → 進待處理桶（不猜、不 LLM）
 */
import * as XLSX from "xlsx";
import type {
  ChannelId,
  Menu,
  Order,
  OrderItem,
  ParseResult,
  PendingReason,
} from "../domain/models";
import { toNum } from "../domain/utils";
import { explodeToAtoms } from "../domain/menu";
import { readSheetTolerant } from "../domain/xlsx-tolerant";
import { extractInPersonDate, dateToIso } from "../domain/batch-date";
// 工時 / wish_priority 依 Yen 2026-07-03 決策拿掉、parser 不填
import { inPersonOrderId } from "../domain/id-hash";

const SHEET_NAME = "表單回覆 1";

const LOCATION_RE = /(中壢|台中|台北|新竹|高雄|桃園|台南|嘉義|澎湖)/;
const TYPE_RE = /(面交|冷凍宅配|宅配|駐店|活動|私定)/;

/** 每個面交 c7-c20 header 對到 menu.yaml SKU 的 hint。 */
const IN_PERSON_HEADER_TO_SKU: Array<[keyword: string, skuId: string]> = [
  ["肉桂捲四入", "經典肉桂捲4入"],
  ["蘋果肉桂捲四入", "蘋果肉桂捲4入"],
  ["焦糖蘋果肉桂麵包", "方型3入_焦糖蘋果"],
  ["芝麻焙茶奶酥磅蛋糕", "方型3入_芝麻磅"],
  ["鳳梨肉桂奶酥磅蛋糕", "方型3入_鳳梨磅"],
  ["肉桂捲x5", "經典肉桂捲5入含醬"],
  ["蘋果肉桂捲x5", "蘋果肉桂捲5入含醬"],
  ["肉桂捲x3", "混合5入含醬"],
  ["原味巴斯克", "原味巴斯克"],
  ["芝麻巴斯克", "芝麻巴斯克"],
  ["焙茶巴斯克", "焙茶栗子巴斯克"], // ⚠️ 雇主命名——面交簡稱「焙茶巴斯克 $980」實為焙茶栗子
  ["白玉烏龍茶巴斯克", "白玉烏龍茶巴斯克"],
  ["90ml 香料堅果醬", "香料堅果醬90ml"],
  ["240ml 香料堅果醬", "香料堅果醬240ml"],
];

// 長 keyword 優先（防子字串誤命中）
// Yen 2026-07-04 bug fix：
//   舊：substring `includes` + for 找到就 return
//   「蘋果肉桂捲四入」.includes("肉桂捲四入") = true
//   → 先命中「經典肉桂捲4入」 → 蘋果版永遠 match 不到
//   造成 IP-8a1t0h、IP-h88noq 等訂單被錯歸為經典肉桂捲
const IN_PERSON_HEADER_TO_SKU_SORTED = [...IN_PERSON_HEADER_TO_SKU].sort(
  (a, b) => b[0].length - a[0].length
);

function mapHeaderToSku(header: string): string | null {
  for (const [kw, skuId] of IN_PERSON_HEADER_TO_SKU_SORTED) {
    if (header.includes(kw)) return skuId;
  }
  return null;
}

export function parseInPerson(
  buffer: ArrayBuffer,
  sourceFile: string,
  menu: Menu
): ParseResult {
  const wb = XLSX.read(buffer, { type: "array" });
  const sh = wb.Sheets[SHEET_NAME];
  if (!sh) {
    throw new Error(
      `面交檔缺 sheet「${SHEET_NAME}」；實際 sheets：${wb.SheetNames.join(",")}`
    );
  }
  const rows = readSheetTolerant(sh);
  if (rows.length < 2) {
    throw new Error(`面交檔 sheet「${SHEET_NAME}」沒資料`);
  }
  const header = rows[0] ?? [];
  const orders: Order[] = [];
  let rawCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const c2 = r[2];
    const c23 = r[23];

    // 判定「有效面交單」：c2 或 c21(姓名) 或 c23(金額) 至少一有值
    const hasAnyContent =
      isNonEmpty(c2) || isNonEmpty(r[21]) || toNum(c23) !== null;
    if (!hasAnyContent) continue;

    rawCount++;

    const pendingReasons: PendingReason[] = [];

    // ---- Stage 4: 通路+日期抓取 ----
    const c2Text = isNonEmpty(c2) ? String(c2).trim() : "";
    const submitDate = parseSubmitDate(r[0]);
    const locationMatch = LOCATION_RE.exec(c2Text);
    const typeMatch = TYPE_RE.exec(c2Text);
    const batchDate = c2Text ? extractInPersonDate(c2Text, submitDate) : null;

    let channel: ChannelId;
    if (typeMatch?.[1] === "冷凍宅配" || typeMatch?.[1] === "宅配") {
      channel = "宅配";
    } else if (typeMatch?.[1] === "面交" && locationMatch?.[1]) {
      channel = (locationMatch[1] === "中壢"
        ? "面交_中壢"
        : locationMatch[1] === "台中"
        ? "面交_台中"
        : "面交_其他") as ChannelId;
    } else if (typeMatch?.[1]) {
      // 駐店/活動/私定 → 待分類
      channel = "待分類";
      pendingReasons.push({
        code: "AMBIGUOUS_CHANNEL",
        humanMessage: `「在哪邊取貨」欄=「${c2Text}」類型=${typeMatch[1]}、進待分類桶`,
        suggestionConfidence: 0,
      });
    } else {
      channel = "待分類";
      pendingReasons.push({
        code: "AMBIGUOUS_CHANNEL",
        humanMessage: `「在哪邊取貨」欄=「${c2Text.slice(0, 40)}」無法辨識通路類型（不含面交/宅配/駐店等關鍵字）`,
        suggestionConfidence: 0,
      });
    }

    // 新政策（2026-07-03）：無指定日不再是 pending reason，直接進待排讓雇主拖入

    // ---- Stage 2: 品項 (c7-c20 checkbox 數字) ----
    const items: OrderItem[] = [];
    for (let col = 7; col <= 20; col++) {
      const qty = toNum(r[col]);
      if (qty === null || qty <= 0) continue;
      const headerName = String(header[col] ?? "");
      const skuId = mapHeaderToSku(headerName);
      if (!skuId) {
        pendingReasons.push({
          code: "UNKNOWN_PRODUCT",
          humanMessage: `面交欄「${headerName}」找不到對應的 menu SKU`,
          suggestionConfidence: 0,
        });
        continue;
      }
      const perUnitAtoms = explodeToAtoms(skuId, menu);
      items.push({
        productSkuId: skuId,
        rawName: headerName,
        quantity: qty,
        subtotal: null, // 面交沒有 per-item subtotal，總額在 c23
        atoms: perUnitAtoms.map((a) => ({
          atomId: a.atomId,
          count: a.count * qty,
        })),
      });
    }

    // 品項為空 → 進 pending
    if (items.length === 0 && !pendingReasons.some((p) => p.code === "UNKNOWN_PRODUCT")) {
      pendingReasons.push({
        code: "UNKNOWN_PRODUCT",
        humanMessage: "面交單無任何品項欄位有數字",
        suggestionConfidence: 0,
      });
    }

    // ---- 收件人 ----
    const recipientName = isNonEmpty(r[21]) ? String(r[21]).trim() : null;
    const igOrLine = isNonEmpty(r[3]) ? String(r[3]).trim() : null;
    const phone = isNonEmpty(r[22]) ? String(r[22]).trim() : null;

    // ---- Stage 5: 標籤數 = 該筆總品項數（雇主 R2-5）----
    const labelCount = items.reduce((s, it) => s + it.quantity, 0) || 1;

    const submitTimestamp = r[0] instanceof Date ? r[0].toISOString() : (typeof r[0] === "string" ? r[0] : null);
    const orderId = inPersonOrderId({
      recipientName,
      phone,
      submitTimestamp,
      pickupLocation: c2Text || null,
    });
    const status = derivePendingStatus(pendingReasons);

    const now = new Date().toISOString();
    // Yen 2026-07-03：拿掉「客人指定日自動排入」· batchDate 匯入時一律 null、雇主拖入才拍板
    orders.push({
      id: orderId,
      channel,
      status,
      batchDate: null,
      recipient: {
        name: recipientName,
        igOrLine,
        phone,
        address: null,
        convStore: null,
      },
      items,
      revenue: {
        grossTotal: toNum(c23) ?? 0,
        freight: 0,
        discount: 0,
      },
      labelCount,
      pendingReasons,
      rawSource: {
        file: sourceFile,
        sheet: SHEET_NAME,
        rowIndex: i + 1,
        rawStatus: "",
      },
      snapshot: {
        c1_order_date: dateToIso(submitDate),
        c5_status: "in-person",
        c11_conv_store: null,
        c12_product: items.map((it) => `${it.rawName}×${it.quantity}`).join("\n"),
        c17_freight: null,
        c18_discount_seller: 0,
        c19_discount_freight: 0,
        c20_discount_platform: 0,
        c21_total: toNum(c23),
        c22_label_count: null,
        customer_wish_date: batchDate, // Yen 2026-07-04：進 snapshot 讓 diff 偵測客人改期
      },
      order_date: dateToIso(submitDate),
      customer_wish_date: batchDate,
      system_suggested_date: null,
      assignment_source: "pending",
      wish_priority: null,
      estimated_production_hours: null,
      first_seen_at: now,
      last_seen_at: now,
      disappeared_at: null,
      disappeared_resolution: null,
      frozen_after_label_print: false,
      changes: [],
    });
  }

  // wish_priority / estimated_production_hours 拿掉、Order 物件建構時已預設 null

  return {
    orders,
    raw_row_count: rawCount,
    source_file: sourceFile,
  };
}

function isNonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parseSubmitDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return new Date(+m[1]!, +m[2]! - 1, +m[3]!);
  }
  return null;
}

function derivePendingStatus(reasons: PendingReason[]): Order["status"] {
  if (reasons.length === 0) return "confirmed";
  const first = reasons[0]!.code;
  if (first === "AMBIGUOUS_CHANNEL") return "pending_channel";
  if (first === "MISSING_BATCH_DATE") return "pending_batch_date";
  if (first === "UNKNOWN_PRODUCT") return "pending_product";
  return "pending_channel";
}
