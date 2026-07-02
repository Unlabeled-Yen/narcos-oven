/**
 * KOL 合作 xlsx parser
 * 對應 docs/spec.md §3 Stage 1-4 + 雇主 confirm #6, #7, R2-5
 *
 * Sheet: 未完成（雇主 confirm 只用這個 sheet）
 * Row 1: header
 * 一位 KOL 佔連續 3-5 列（提供品項有多個 → 一列一個 c5）
 *
 * 合成規則：
 *   c1（折扣碼）或 c2（IG 帳號）有值 = 新一筆 KOL 開始
 *
 * c6=True（已寄出）→ status=kol_shipped、不進本批出爐量
 * c4 寄貨時間解析（datetime / ISO 字串 / M/D）→ batchDate
 * 「擇一」品項（如「一盒巴斯克蛋糕：口味擇一」）→ pending_kol_choice
 */
import * as XLSX from "xlsx";
import type {
  Menu,
  Order,
  OrderItem,
  ParseResult,
  PendingReason,
} from "../domain/models";
import { explodeToAtoms, lookupSku } from "../domain/menu";
import { readSheetTolerant } from "../domain/xlsx-tolerant";
import { extractKolShippingDate } from "../domain/batch-date";
import { deriveOrderWishPriority, estimateOrderHours } from "../domain/production-time";

const SHEET_NAME = "未完成";
const CHOICE_KEYWORD_RE = /擇一|口味擇一|請選/;

/** KOL 品項字串對到 SKU 的 hint。 */
function mapKolProductToSku(raw: string, menu: Menu): string | null {
  const trimmed = raw.replace(/^◆\s*/, "").trim();
  // 先試 menu 的 alias/signature
  const direct = lookupSku(trimmed, menu);
  if (direct) return direct;
  // 常見 KOL 口語 fallback
  if (/四入肉桂捲|肉桂捲\s*4\s*入/.test(trimmed) && !trimmed.includes("蘋果")) return "經典肉桂捲4入";
  if (/四入蘋果|蘋果肉桂捲\s*4\s*入|四入.*蘋果捲/.test(trimmed)) return "蘋果肉桂捲4入";
  if (/香料堅果醬.*90|90.*香料堅果醬/.test(trimmed)) return "香料堅果醬90ml";
  if (/原味巴斯克/.test(trimmed) && !/白玉/.test(trimmed)) return "原味巴斯克";
  return null;
}

export function parseKol(
  buffer: ArrayBuffer,
  sourceFile: string,
  menu: Menu
): ParseResult {
  const wb = XLSX.read(buffer, { type: "array" });
  const sh = wb.Sheets[SHEET_NAME];
  if (!sh) {
    throw new Error(
      `KOL 檔缺 sheet「${SHEET_NAME}」；實際 sheets：${wb.SheetNames.join(",")}`
    );
  }
  const rows = readSheetTolerant(sh);
  if (rows.length < 2) {
    return { orders: [], raw_row_count: 0, source_file: sourceFile };
  }
  const orders: Order[] = [];
  let current: WipKol | null = null;
  let rawCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const c1 = r[1];
    const c2 = r[2];
    const c4 = r[4];
    const c5 = r[5];
    const c6 = r[6];
    const c7 = r[7];
    const c8 = r[8];
    const c9 = r[9];

    const hasC1 = isNonEmpty(c1);
    const hasC2 = isNonEmpty(c2);
    const isNewKol = hasC1 || hasC2;

    if (isNewKol) {
      if (current) orders.push(finalizeKol(current, menu));
      rawCount++;
      current = {
        discount_code: hasC1 ? String(c1).trim() : null,
        ig: hasC2 ? String(c2).trim() : null,
        ship_raw: c4 ?? null,
        products: isNonEmpty(c5) ? [String(c5).trim()] : [],
        shipped: c6 === true,
        recipient_name: isNonEmpty(c7) ? String(c7).trim() : null,
        phone: isNonEmpty(c8) ? String(c8).trim() : null,
        address: isNonEmpty(c9) ? String(c9).trim() : null,
        row_start: i + 1,
        source_file: sourceFile,
      };
    } else if (current && isNonEmpty(c5)) {
      current.products.push(String(c5).trim());
      // 品項延續行的 c6 也可能標 True（表整組已寄）
      if (c6 === true) current.shipped = true;
    }
  }
  if (current) orders.push(finalizeKol(current, menu));

  for (const o of orders) {
    o.wish_priority = deriveOrderWishPriority(o, menu);
    o.estimated_production_hours = estimateOrderHours(o, menu);
  }
  return { orders, raw_row_count: rawCount, source_file: sourceFile };
}

// ---- helpers ----

type WipKol = {
  discount_code: string | null;
  ig: string | null;
  ship_raw: unknown;
  products: string[];
  shipped: boolean;
  recipient_name: string | null;
  phone: string | null;
  address: string | null;
  row_start: number;
  source_file: string;
};

function isNonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function finalizeKol(w: WipKol, menu: Menu): Order {
  const pendingReasons: PendingReason[] = [];

  const now = new Date().toISOString();
  const snapshot = {
    c5_status: w.shipped ? "kol-shipped" : "kol-pending",
    c11_conv_store: null,
    c12_product: w.products.join("\n"),
    c17_freight: null,
    c18_discount_seller: 0,
    c19_discount_freight: 0,
    c20_discount_platform: 0,
    c21_total: null,
    c22_label_count: null,
  };
  const _ship = extractKolShippingDate(w.ship_raw, null);
  const lifecycle = {
    first_seen_at: now,
    last_seen_at: now,
    disappeared_at: null as string | null,
    disappeared_resolution: null as "shipped" | "canceled" | "kept_active" | null,
    frozen_after_label_print: false,
    changes: [] as import("../domain/models").OrderChange[],
    customer_wish_date: _ship,
    system_suggested_date: null as string | null,
    assignment_source: (_ship ? "customer_wish_kept" : "pending") as import("../domain/models").AssignmentSource,
    wish_priority: null as import("../domain/models").WishPriority | null,
    estimated_production_hours: null as number | null,
  };

  // ---- c6 = True 已寄出：直接 kol_shipped、後續 stage 不管 ----
  if (w.shipped) {
    return {
      id: kolId(w),
      channel: "KOL",
      status: "kol_shipped",
      batchDate: extractKolShippingDate(w.ship_raw, null),
      recipient: {
        name: w.recipient_name,
        igOrLine: w.ig,
        phone: w.phone,
        address: w.address,
        convStore: null,
      },
      items: [],
      revenue: { grossTotal: 0, freight: 0, discount: 0 },
      labelCount: 0,
      pendingReasons: [],
      rawSource: {
        file: w.source_file,
        sheet: SHEET_NAME,
        rowIndex: w.row_start,
        rawStatus: "shipped=true",
      },
      snapshot,
      ...lifecycle,
    };
  }

  // ---- Stage 4: 出爐日 ----
  const batchDate = extractKolShippingDate(w.ship_raw, null);
  if (!batchDate) {
    pendingReasons.push({
      code: "MISSING_BATCH_DATE",
      humanMessage: `KOL「寄貨時間」欄=「${String(w.ship_raw ?? "").slice(0, 20)}」無法解析為日期`,
      suggestionConfidence: 0,
    });
  }

  // ---- Stage 2: 品項 lookup + 擇一 handling ----
  const items: OrderItem[] = [];
  for (const p of w.products) {
    if (CHOICE_KEYWORD_RE.test(p)) {
      pendingReasons.push({
        code: "KOL_CHOICE_UNRESOLVED",
        humanMessage: `KOL「${p}」擇一品項、待 KOL 告知選擇`,
        suggestionConfidence: 0,
      });
      continue;
    }
    const sku = mapKolProductToSku(p, menu);
    if (!sku) {
      pendingReasons.push({
        code: "UNKNOWN_PRODUCT",
        humanMessage: `KOL「提供項目」欄=「${p.slice(0, 30)}」找不到對應的 menu SKU`,
        suggestionConfidence: 0,
      });
      continue;
    }
    const perUnitAtoms = explodeToAtoms(sku, menu);
    items.push({
      productSkuId: sku,
      rawName: p,
      quantity: 1,
      subtotal: null,
      atoms: perUnitAtoms.map((a) => ({ atomId: a.atomId, count: a.count })),
    });
  }

  // ---- Stage 5: 標籤數 = 品項數 ----
  const labelCount = items.reduce((s, it) => s + it.quantity, 0);

  const status: Order["status"] =
    pendingReasons.length === 0
      ? "confirmed"
      : pendingReasons.some((p) => p.code === "MISSING_BATCH_DATE")
      ? "pending_batch_date"
      : pendingReasons.some((p) => p.code === "KOL_CHOICE_UNRESOLVED")
      ? "pending_kol_choice"
      : "pending_product";

  return {
    id: kolId(w),
    channel: "KOL",
    status,
    batchDate,
    recipient: {
      name: w.recipient_name,
      igOrLine: w.ig,
      phone: w.phone,
      address: w.address,
      convStore: null,
    },
    items,
    revenue: { grossTotal: 0, freight: 0, discount: 0 },
    labelCount,
    pendingReasons,
    rawSource: {
      file: w.source_file,
      sheet: SHEET_NAME,
      rowIndex: w.row_start,
      rawStatus: "",
    },
    snapshot,
    ...lifecycle,
  };
}

function kolId(w: WipKol): string {
  const key = w.discount_code || w.ig || `row${w.row_start}`;
  return `KOL-${key}`;
}
