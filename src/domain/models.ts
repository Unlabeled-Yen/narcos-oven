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

export const ProductionCapacitySchema = z.object({
  daily_max_by_atom: z.record(z.string(), z.number()),
  weekly_pattern: z
    .object({
      Mon: z.number().default(1),
      Tue: z.number().default(1),
      Wed: z.number().default(1),
      Thu: z.number().default(1),
      Fri: z.number().default(1),
      Sat: z.number().default(1),
      Sun: z.number().default(1),
    })
    .default({ Mon: 1, Tue: 1, Wed: 1, Thu: 1, Fri: 1, Sat: 1, Sun: 1 }),
});
export type ProductionCapacity = z.infer<typeof ProductionCapacitySchema>;

export const ProductionTimeFormulaSchema = z.object({
  per_batch_units: z.number(),
  hours_by_batch_count: z.record(z.string(), z.number()),
  hours_per_additional_batch: z.number(),
  ml_per_unit: z.number().optional(), // 堅果醬類專用
});
export type ProductionTimeFormula = z.infer<typeof ProductionTimeFormulaSchema>;

export const OverheadSchema = z.object({
  product_switch_hours: z.number().default(0.67),
  wash_mold_after_batches: z.number().int().default(3),
  wash_mold_hours: z.number().default(1.0),
});
export type Overhead = z.infer<typeof OverheadSchema>;

export const WeeklyBudgetSchema = z.object({
  total_hours_min: z.number().default(24),
  total_hours_max: z.number().default(30),
  overflow_tuesday_extra_hours: z.number().default(8),
});
export type WeeklyBudget = z.infer<typeof WeeklyBudgetSchema>;

export const SchedulingConfigSchema = z.object({
  lead_time_days: z.number().int().default(5),
  regular_shipping_weekday: z.number().int().default(2), // 0=Sun,2=Tue（legacy · 單一出貨日）
  max_retry_weeks: z.number().int().default(10),

  // 新規則（2026-07-03）：
  // - 出貨日可為多個星期幾（例如 [2] 週二、或 [2,5] 週二+週五）
  // - 工作日可為 1..多個星期幾（例如 [1,2] 週一+週二）
  // - 工時計算：以「本週的所有工作日合計」為準
  // - 出貨明細：以「該出貨日 · 前一組工作日」為範圍（Phase 2 邏輯）
  shipping_weekdays: z.array(z.number().int()).default([2]),
  working_weekdays: z.array(z.number().int()).default([0, 1, 2, 3, 4, 5, 6]), // default 全週皆工作日
});
export type SchedulingConfig = z.infer<typeof SchedulingConfigSchema>;

export const WishPrioritySchema = z.enum(["strict", "flexible"]);
export type WishPriority = z.infer<typeof WishPrioritySchema>;

export const MenuSchema = z.object({
  atoms: z.record(z.string(), AtomSchema),
  products: z.record(z.string(), ProductSchema),
  channels: z.array(ChannelSchema).optional(),
  logistics_cost: z.record(z.string(), z.number()).optional(),
  production_capacity: ProductionCapacitySchema.optional(),
  product_lead_time: z.record(z.string(), z.number()).optional(),
  label_short_forms: z.record(z.string(), z.string()).optional(),
  // M6.5 新增
  production_time_formula: z.record(z.string(), ProductionTimeFormulaSchema).optional(),
  overhead: OverheadSchema.optional(),
  weekly_production_budget: WeeklyBudgetSchema.optional(),
  scheduling: SchedulingConfigSchema.optional(),
  wish_priority_by_atom: z.record(z.string(), WishPrioritySchema).optional(),
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
  // M3 新增（憲章 #9 #10）
  "disappeared_pending_resolution",
  "change_pending_resolution",
  "shipped",
  "canceled",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/** 需觸發 change_pending 的關鍵欄位（憲章 #10）。 */
export const KEY_FIELDS_FOR_CHANGE = [
  "c12_product",
  "c22_label_count",
  "c17_freight",
  "c18_discount_seller",
  "c19_discount_freight",
  "c20_discount_platform",
  "c21_total",
  "c11_conv_store",
] as const;
export type KeyFieldName = (typeof KEY_FIELDS_FOR_CHANGE)[number];

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

export const OrderChangeSchema = z.object({
  imported_at: z.string(),
  import_run_id: z.string(),
  fields: z.record(
    z.string(),
    z.object({
      from: z.unknown(),
      to: z.unknown(),
    })
  ),
  resolved: z.enum(["accepted", "rejected", "reprint_needed"]).nullable().default(null),
  resolved_at: z.string().nullable().default(null),
});
export type OrderChange = z.infer<typeof OrderChangeSchema>;

/** Order 的 raw 摘要（M3 diff 用）——只含關鍵欄位快照供比對。 */
export const OrderSnapshotSchema = z.object({
  c1_order_date: z.string().nullable().default(null), // ISO YYYY-MM-DD 下單日（供反查、diff）
  c5_status: z.string(),
  c11_conv_store: z.string().nullable(),
  c12_product: z.string(), // 品項字串合併（多品項用 \n 分隔）
  c17_freight: z.number().nullable(),
  c18_discount_seller: z.number(),
  c19_discount_freight: z.number(),
  c20_discount_platform: z.number(),
  c21_total: z.number().nullable(),
  c22_label_count: z.number().nullable(),
});
export type OrderSnapshot = z.infer<typeof OrderSnapshotSchema>;

export const AssignmentSourceSchema = z.enum([
  "customer_wish_kept",  // 客人選了、雇主未改
  "boss_override",       // 雇主改過客人建議
  "boss_scheduled",      // 客人沒選、雇主直接排
  "auto_from_rule",      // 系統規則自動排（雇主可覆蓋）
  "pending",             // 還沒排
]);
export type AssignmentSource = z.infer<typeof AssignmentSourceSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  channel: ChannelIdSchema,
  status: OrderStatusSchema,
  batchDate: z.string().nullable(),  // 系統認定的最終出爐日（M6 之後 = assigned_batch_date）

  // 客戶下單日（ISO YYYY-MM-DD）· 供待排列表排序 + chip 顯示
  order_date: z.string().nullable().default(null),

  // M6 新增（backward-compat）
  customer_wish_date: z.string().nullable().default(null),
  system_suggested_date: z.string().nullable().default(null),
  assignment_source: AssignmentSourceSchema.default("pending"),

  // M6.5 新增（排程 v2）
  wish_priority: WishPrioritySchema.nullable().default(null),
  estimated_production_hours: z.number().nullable().default(null),
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
    rawStatus: z.string(),
  }),

  // M3 生命週期欄
  snapshot: OrderSnapshotSchema, // 關鍵欄位快照供 diff
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  disappeared_at: z.string().nullable().default(null),
  disappeared_resolution: z
    .enum(["shipped", "canceled", "kept_active"])
    .nullable()
    .default(null),
  frozen_after_label_print: z.boolean().default(false),
  changes: z.array(OrderChangeSchema).default([]),
});
export type Order = z.infer<typeof OrderSchema>;

// ---------- ImportRun ----------

export const ImportDiffSchema = z.object({
  added: z.array(z.string()),
  payment_confirmed: z.array(z.string()),
  fields_changed: z.array(z.string()),
  disappeared: z.array(z.string()),
  unchanged: z.array(z.string()),
});
export type ImportDiff = z.infer<typeof ImportDiffSchema>;

export const ImportResolutionSchema = z.object({
  order_id: z.string(),
  resolution: z.enum([
    "shipped",
    "canceled",
    "kept_active",
    "accept_change",
    "reject_change",
    "reprint",
  ]),
  resolved_at: z.string(),
});
export type ImportResolution = z.infer<typeof ImportResolutionSchema>;

export const ImportRunSchema = z.object({
  id: z.string(),
  imported_at: z.string(),
  source_files: z.array(z.string()),
  channels_touched: z.array(ChannelIdSchema), // 只對這幾個 channel 做 diff
  diff: ImportDiffSchema,
  resolutions: z.record(z.string(), ImportResolutionSchema).default({}),
  fully_resolved_at: z.string().nullable().default(null),
});
export type ImportRun = z.infer<typeof ImportRunSchema>;

// ---------- Parse result（parser 回傳 shape）----------

export type ParseResult = {
  orders: Order[]; // 全部訂單（含 pending）
  raw_row_count: number; // 原始輸入列數（防護 #1 用）
  source_file: string;
};
