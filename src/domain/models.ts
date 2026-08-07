/**
 * narcos-oven 核心資料模型（zod schema）
 * 對應 docs/spec.md §2
 */
import { z } from "zod";

// ---------- Atom / Product / Menu ----------

export const AtomSchema = z.object({
  unit: z.enum(["顆", "罐", "包"]),
  // 全成本（食材＋包裝分攤＋營養貼紙 $1）· 每顆/每瓶
  // 資料源：全品項成本總覽 PDF · 版本 2026-07-03
  cost: z.number().nullable().optional(),
  // Yen 2026-08-06（#15）：src/assets/nutrition/ 底下的檔名（例："肉桂捲.jpg"）。
  // null = 未決（留空）——匯出時要 loud 警告，不能靜默當免貼；
  // "none" = 明確確認免貼（例：瑕疵品、研發中品項）。
  // 兩者語意不同，杜絕「忘了設定」跟「確認免貼」混淆。
  nutrition_label: z.string().nullable().default(null),
});

export const MatchSignatureSchema = z.object({
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
});

// Yen 2026-08-06（#3）：手打單品項下拉分類。固定枚舉，不接受任意字串——
// 分類漂移（打錯字、新造一類沒人看到）本身就是一種靜默失效。
// 沒填 → default "其他"，不是拒載；但值不在枚舉內 → zod 直接拒載。
export const ProductGroupSchema = z
  .enum(["肉桂捲", "磅蛋糕", "巴斯克", "堅果醬", "禮盒組", "其他"])
  .default("其他");
export type ProductGroup = z.infer<typeof ProductGroupSchema>;
export const PRODUCT_GROUP_ORDER = [
  "肉桂捲",
  "磅蛋糕",
  "巴斯克",
  "堅果醬",
  "禮盒組",
  "其他",
] as const;

export const ProductSchema = z.object({
  display_name: z.string(),
  category: z.enum(["combo", "single"]),
  price: z.number().nullable(),
  cost: z.number().nullable(),
  // Yen 2026-07-06：駐店供貨公定價 · null = 未定案 / 該品項不供貨
  wholesale_price: z.number().nullable().default(null),
  // Yen 2026-07-06：品項狀態 · "draft" = 研發中、店家提案但細節未定
  status: z.enum(["active", "draft"]).default("active"),
  group: ProductGroupSchema,
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

// ---------- Shop Partner (Yen 2026-07-06 · 駐店合作店家) ----------
// 存 IndexedDB shops table · 雇主在店家管理 UI 自行 CRUD（不進 menu.yaml）
// item.override_price · 該店該品項的議價常態價 · null = 用 menu.wholesale_price
export const ShopPartnerItemSchema = z.object({
  productSkuId: z.string(),
  override_price: z.number().nullable().default(null),
});
export type ShopPartnerItem = z.infer<typeof ShopPartnerItemSchema>;

export const ShopPartnerSchema = z.object({
  id: z.string(),                          // slug · e.g. "shengsheng-coffee"
  display_name: z.string(),                // "shēngshēng coffee（台南）"
  location: z.string().default(""),        // 地點簡註 · 「台南」
  items: z.array(ShopPartnerItemSchema).default([]),  // 該店賣的品項清單
  active: z.boolean().default(true),       // false = 已停止合作、UI 隱藏但保留歷史
  notes: z.string().default(""),
  created_at: z.string(),                  // ISO
  updated_at: z.string(),
});
export type ShopPartner = z.infer<typeof ShopPartnerSchema>;

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
  // lead_time_days / max_retry_weeks 依 Yen 2026-07-03 決策不再影響 UI
  //   保留 default 讓 scheduler-v2 / MCP tools（arb legacy）能繼續 typecheck
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
  "駐店",       // Yen 2026-07-04：手打單專用（雇主到店對客人收單）
  "彈性",       // Yen 2026-07-04：手打單兜底（其他管道 / 臨時單）
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
  "customer_wish_date", // Yen 2026-07-04：客人改指定出貨日
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
  // Yen 2026-07-04：客人指定出貨日進 snapshot · 用於偵測「客人改期」異動
  customer_wish_date: z.string().nullable().default(null),
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

  // Yen 2026-07-06 · 駐店訂單專用四欄（其他 channel 一律 null / 預設值）
  //   shop_partner        : 合作店家 ID · null = 非駐店
  //   override_unit_price : 議價單價 · null = 用公定價（menu.wholesale_price）
  //   freight_cost        : 運費（雇主吸收、從實收扣）· 0 = 沒付運費
  //   settled             : 費用結清狀態（店家付款了沒）
  shop_partner: z.string().nullable().default(null),
  override_unit_price: z.number().nullable().default(null),
  freight_cost: z.number().nonnegative().default(0),
  settled: z.boolean().default(false),

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
