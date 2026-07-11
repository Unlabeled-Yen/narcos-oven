/**
 * manual-order.ts · 手打單 Order 工廠
 *
 * Yen 2026-07-04：雇主手動打 KOL / 駐店 / 彈性單 · 生成跟 parser 一致的 Order shape
 *   使用 lookupSkuStrict 展開 atoms · 保證跟 xlsx 匯入的訂單同一套資料模型
 *
 * ID 命名：MAN-<channel-prefix>-<timestamp>-<short-hash>
 *   例：MAN-KL-1783174-a3b2 / MAN-駐店-1783174-9c1e / MAN-彈性-1783174-4f88
 */
import type { Menu, Order, OrderItem, ChannelId, PendingReason } from "./models";
import { lookupSkuStrict } from "./menu-lookup";
import { explodeToAtoms } from "./menu";

export type ManualOrderInput = {
  channel: ChannelId;
  order_date: string | null;         // ISO YYYY-MM-DD
  customer_wish_date: string | null; // ISO YYYY-MM-DD
  recipient: {
    name: string | null;
    igOrLine: string | null;
    phone: string | null;
    address: string | null;
    convStore: string | null;
  };
  items: Array<{
    // 兩種輸入模式：直接指定 SKU 或用 rawName lookup（跟 parser 一致）
    skuId?: string | null;
    rawName: string;
    quantity: number;
    subtotal?: number | null;
  }>;
  grossTotal: number;
  freight?: number;
  discount?: number;
  labelCount?: number | null; // null → 自動 = items 總 quantity
  notes?: string;
  // Yen 2026-07-06 slice 2C · 駐店訂單專用（其他 channel 一律不填、走預設）
  shop_partner?: string | null;         // 合作店家 id
  override_unit_price?: number | null;  // 議價（訂單層級）· 若各 item 有自己的價 · 從 subtotal 反推、這欄留 null
  freight_cost?: number;                // 運費（雇主吸收）
  settled?: boolean;                    // 費用結清
  batchDate?: string | null;            // 到貨日 · 駐店 mode 由雇主自訂 · 其他 channel 走 null 讓排程接手
};

/**
 * 從輸入建 Order 物件
 * · SKU 若沒指定 · 用 rawName 走 lookupSkuStrict（保持跟 parser 同一邏輯）
 * · SKU lookup 失敗（none/ambiguous）→ 進 pending_product · loud reason
 */
export function buildManualOrder(input: ManualOrderInput, menu: Menu): Order {
  const now = new Date().toISOString();
  const id = generateManualId(input.channel);

  const items: OrderItem[] = [];
  const pendingReasons: PendingReason[] = [];

  for (const raw of input.items) {
    let skuId = raw.skuId ?? null;
    if (!skuId) {
      const result = lookupSkuStrict(raw.rawName, menu);
      if (result.kind === "found") {
        skuId = result.skuId;
      } else {
        pendingReasons.push({
          code: "UNKNOWN_PRODUCT",
          humanMessage:
            result.kind === "none"
              ? `手打「${raw.rawName}」找不到對應 SKU`
              : `手打「${raw.rawName}」match 多個 SKU 候選（${result.candidates.join(" / ")}）· ${result.reason}`,
          suggestionConfidence: 0,
        });
      }
    }

    if (!skuId) {
      // 品項無法對到 SKU · 記錄 raw 但不展開 atoms
      items.push({
        productSkuId: null,
        rawName: raw.rawName,
        quantity: raw.quantity,
        subtotal: raw.subtotal ?? null,
        atoms: [],
      });
      continue;
    }

    const perUnitAtoms = explodeToAtoms(skuId, menu);
    items.push({
      productSkuId: skuId,
      rawName: raw.rawName,
      quantity: raw.quantity,
      subtotal: raw.subtotal ?? null,
      atoms: perUnitAtoms.map((a) => ({
        atomId: a.atomId,
        count: a.count * raw.quantity,
      })),
    });
  }

  const labelCount =
    input.labelCount ?? items.reduce((s, it) => s + it.quantity, 0);

  const status: Order["status"] =
    pendingReasons.length === 0 ? "confirmed" : "pending_product";

  return {
    id,
    channel: input.channel,
    status,
    // 駐店 mode 由雇主直接填到貨日 · 其他 channel 一律 null（跟 parser 匯入行為一致、等雇主拖入排程）
    batchDate: input.batchDate ?? null,
    recipient: input.recipient,
    items,
    revenue: {
      grossTotal: input.grossTotal,
      freight: input.freight ?? 0,
      discount: input.discount ?? 0,
    },
    labelCount,
    // 駐店專用四欄 · slice 2C 已可從 input 傳入 · 其他 channel 走預設
    shop_partner: input.shop_partner ?? null,
    override_unit_price: input.override_unit_price ?? null,
    freight_cost: input.freight_cost ?? 0,
    settled: input.settled ?? false,
    pendingReasons,
    rawSource: {
      file: "手打單",
      sheet: "manual",
      rowIndex: 0,
      rawStatus: input.notes ?? "",
    },
    snapshot: {
      c1_order_date: input.order_date,
      c5_status: "manual",
      c11_conv_store: input.recipient.convStore,
      c12_product: items.map((it) => `${it.rawName}×${it.quantity}`).join("\n"),
      c17_freight: input.freight ?? 0,
      c18_discount_seller: 0,
      c19_discount_freight: 0,
      c20_discount_platform: input.discount ?? 0,
      c21_total: input.grossTotal,
      c22_label_count: labelCount,
      customer_wish_date: input.customer_wish_date,
    },
    order_date: input.order_date,
    customer_wish_date: input.customer_wish_date,
    system_suggested_date: null,
    // 駐店 mode 手動填 batchDate = 雇主直接拍板 · 其他 channel 保持 pending
    assignment_source: input.batchDate ? "boss_scheduled" : "pending",
    wish_priority: null,
    estimated_production_hours: null,
    first_seen_at: now,
    last_seen_at: now,
    disappeared_at: null,
    disappeared_resolution: null,
    frozen_after_label_print: false,
    changes: [],
  };
}

function generateManualId(channel: ChannelId): string {
  const chPrefix =
    channel === "KOL" ? "KL" :
    channel === "駐店" ? "ST" :
    channel === "彈性" ? "FX" :
    channel.startsWith("面交") ? "IP" :
    channel === "宅配" ? "HM" :
    "MISC";
  // 用 base36 timestamp（縮短、還可辨識時序）
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `MAN-${chPrefix}-${ts}-${rand}`;
}
