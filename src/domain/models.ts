/**
 * narcos-oven 核心資料模型（zod schema）
 * 對應 docs/spec.md §2
 */
import { z } from "zod";

// ---------- Atom / Product / Menu ----------

export const AtomSchema = z.object({
  unit: z.enum(["顆", "罐", "包"]),
});

export const MatchSignatureSchema = z.object({
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
});

export const ProductSchema = z.object({
  display_name: z.string(),
  category: z.enum(["combo", "single"]),
  price: z.number().nullable(),
  cost: z.number().nullable(),
  contains: z.array(
    z.object({
      atom: z.string(),
      count: z.number().int().positive(),
    })
  ),
  aliases: z.array(z.string()).default([]),
  match_signature: MatchSignatureSchema.default({ include: [], exclude: [] }),
  seen_count: z.number().int().nonnegative().default(0),
  notes: z.string().optional(),
});

export const ChannelSchema = z.object({
  id: z.string(),
  color: z.string(),
});

export const MenuSchema = z.object({
  atoms: z.record(z.string(), AtomSchema),
  products: z.record(z.string(), ProductSchema),
  channels: z.array(ChannelSchema).optional(),
  logistics_cost: z.record(z.string(), z.number()).optional(),
});

export type Atom = z.infer<typeof AtomSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type Menu = z.infer<typeof MenuSchema>;

// ---------- Order / PendingReason ----------

export const ChannelIdSchema = z.enum([
  "賣貨便",
  "面交_中壢",
  "面交_台中",
  "面交_其他",
  "宅配",
  "KOL",
  "待分類",
]);
export type ChannelId = z.infer<typeof ChannelIdSchema>;

export const OrderStatusSchema = z.enum([
  "confirmed",
  "pending_payment",
  "pending_batch_date",
  "pending_conflict_date",
  "pending_channel",
  "pending_recipient",
  "pending_amount",
  "pending_product",
  "pending_kol_choice",
  "kol_shipped",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderItemSchema = z.object({
  productSkuId: z.string().nullable(), // 找不到 SKU 時為 null
  rawName: z.string(), // 訂單當下的字串（可能是 alias）
  quantity: z.number(),
  subtotal: z.number().nullable(),
  atoms: z.array(
    z.object({
      atomId: z.string(),
      count: z.number(),
    })
  ),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const PendingReasonCodeSchema = z.enum([
  "PAYMENT_NOT_CONFIRMED",
  "MISSING_BATCH_DATE",
  "CONFLICT_DATE_C12_C28",
  "AMBIGUOUS_CHANNEL",
  "UNKNOWN_PRODUCT",
  "AMOUNT_MISMATCH",
  "MISSING_RECIPIENT",
  "KOL_CHOICE_UNRESOLVED",
]);
export type PendingReasonCode = z.infer<typeof PendingReasonCodeSchema>;

export const PendingReasonSchema = z.object({
  code: PendingReasonCodeSchema,
  humanMessage: z.string(),
  suggestion: z.string().optional(),
  suggestionConfidence: z.number().min(0).max(1).default(0),
});
export type PendingReason = z.infer<typeof PendingReasonSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  channel: ChannelIdSchema,
  status: OrderStatusSchema,
  batchDate: z.string().nullable(), // "2026-07-07"
  recipient: z.object({
    name: z.string().nullable(),
    igOrLine: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
    convStore: z.string().nullable(),
  }),
  items: z.array(OrderItemSchema),
  revenue: z.object({
    grossTotal: z.number(),
    freight: z.number(),
    discount: z.number(),
  }),
  labelCount: z.number().int().nonnegative(),
  pendingReasons: z.array(PendingReasonSchema).default([]),
  rawSource: z.object({
    file: z.string(),
    sheet: z.string(),
    rowIndex: z.number(),
    rawStatus: z.string(), // 賣貨便 c5 原字串
  }),
});
export type Order = z.infer<typeof OrderSchema>;

// ---------- Parse result（parser 回傳 shape）----------

export type ParseResult = {
  orders: Order[]; // 全部訂單（含 pending）
  raw_row_count: number; // 原始輸入列數（防護 #1 用）
  source_file: string;
};
