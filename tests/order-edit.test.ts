/**
 * #8 訂單可編輯架構 — planManualEdit / planVoidOrder / planRestoreOrder / findDuplicateGroups。
 * 見 docs/boss-issues-plan-2026-08.md 順位 10（本項是守恆律重災區、測最厚）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { planManualEdit, planVoidOrder, planRestoreOrder } from "../src/domain/order-edit.ts";
import { findDuplicateGroups } from "../src/domain/duplicate-detection.ts";
import type { Order, OrderStatus } from "../src/domain/models.ts";

function order(
  id: string,
  overrides: Partial<{
    status: OrderStatus;
    batchDate: string | null;
    order_date: string | null;
    recipientName: string;
    quantity: number;
    grossTotal: number;
    channel: Order["channel"];
  }> = {}
): Order {
  return {
    id,
    channel: overrides.channel ?? "賣貨便",
    status: overrides.status ?? "confirmed",
    batchDate: overrides.batchDate ?? "2026-08-11",
    order_date: overrides.order_date ?? "2026-08-01",
    customer_wish_date: null,
    system_suggested_date: null,
    assignment_source: "customer_wish_kept",
    wish_priority: null,
    estimated_production_hours: null,
    recipient: { name: overrides.recipientName ?? "測試", igOrLine: null, phone: null, address: null, convStore: null },
    items: [{ productSkuId: "肉桂捲_單品", rawName: "肉桂捲_單品", quantity: overrides.quantity ?? 1, subtotal: 100, atoms: [{ atomId: "肉桂捲", count: overrides.quantity ?? 1 }] }],
    revenue: { grossTotal: overrides.grossTotal ?? 100, freight: 0, discount: 0 },
    labelCount: 1,
    shop_partner: null,
    override_unit_price: null,
    freight_cost: 0,
    settled: false,
    payment_method: null,
    pendingReasons: [],
    rawSource: { file: "test", sheet: "test", rowIndex: 0, rawStatus: "" },
    snapshot: {
      c1_order_date: "2026-08-01", c5_status: "付款完成", c11_conv_store: null,
      c12_product: "", c17_freight: 0, c18_discount_seller: 0, c19_discount_freight: 0,
      c20_discount_platform: 0, c21_total: 100, c22_label_count: 1, customer_wish_date: null,
    },
    first_seen_at: "2026-08-01T00:00:00Z",
    last_seen_at: "2026-08-01T00:00:00Z",
    disappeared_at: null,
    disappeared_resolution: null,
    frozen_after_label_print: false,
    changes: [],
  } as unknown as Order;
}

const NOW = "2026-08-08T00:00:00Z";

// ── 單筆編輯 ──────────────────────────────────────────────────────────

test("編輯：改數量 4→6 → changes 有一筆 manual_edit、前後值都在", () => {
  const o = order("o1", { quantity: 4 });
  const newItems = [{ ...o.items[0]!, quantity: 6, atoms: [{ atomId: "肉桂捲", count: 6 }] }];
  const plan = planManualEdit(o, { items: newItems }, NOW);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.order.items[0]!.quantity, 6);
  assert.ok(plan.change);
  assert.equal(plan.change!.source, "manual_edit");
  assert.equal(plan.change!.fields.items!.from, "肉桂捲_單品×4");
  assert.equal(plan.change!.fields.items!.to, "肉桂捲_單品×6");
});

test("編輯不得改 id（型別上不開放——ManualEditInput 沒有 id 欄位）", () => {
  const o = order("o1");
  const plan = planManualEdit(o, { recipientName: "新名字" }, NOW);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.order.id, "o1", "id 必須維持原樣");
});

test("編輯：沒有任何欄位真的變 → change:null、不產生垃圾 log", () => {
  const o = order("o1", { recipientName: "阿明" });
  const plan = planManualEdit(o, { recipientName: "阿明" }, NOW);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.change, null);
});

test("對抗測項：金額改成負數 → 拒絕存檔", () => {
  const o = order("o1");
  const plan = planManualEdit(o, { grossTotal: -100 }, NOW);
  assert.equal(plan.ok, false);
});

test("對抗測項：品項改成空陣列 → 拒絕存檔（不得默默存 0 品項單）", () => {
  const o = order("o1");
  const plan = planManualEdit(o, { items: [] }, NOW);
  assert.equal(plan.ok, false);
});

test("對抗測項：品項數量改成 0 或負數 → 拒絕存檔", () => {
  const o = order("o1");
  const badItems = [{ ...o.items[0]!, quantity: 0 }];
  const plan = planManualEdit(o, { items: badItems }, NOW);
  assert.equal(plan.ok, false);
});

test("對抗測項：batchDate 改成非法格式 → 拒絕存檔", () => {
  const o = order("o1");
  const plan = planManualEdit(o, { batchDate: "下週二" }, NOW);
  assert.equal(plan.ok, false);
});

// ── 作廢 / 復原守恆 ────────────────────────────────────────────────────

test("作廢守恆：作廢 1 筆 → 只改 status、其餘欄位不變、changes 多一筆 source:void", () => {
  const o = order("o1", { status: "confirmed" });
  const plan = planVoidOrder(o, NOW);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.order.status, "voided");
  assert.equal(plan.order.batchDate, o.batchDate, "作廢不動 batchDate");
  assert.equal(plan.order.revenue.grossTotal, o.revenue.grossTotal, "作廢不動金額");
  assert.equal(plan.change.source, "void");
  assert.deepEqual(plan.change.fields.status, { from: "confirmed", to: "voided" });
});

test("復原：作廢後復原 → 完整回到作廢前的原始狀態、changes 兩筆都在", () => {
  const o = order("o1", { status: "confirmed" });
  const voidPlan = planVoidOrder(o, NOW);
  assert.ok(voidPlan.ok);
  if (!voidPlan.ok) return;

  const restorePlan = planRestoreOrder(voidPlan.order, "2026-08-09T00:00:00Z");
  assert.ok(restorePlan.ok);
  if (!restorePlan.ok) return;
  assert.equal(restorePlan.order.status, "confirmed", "應該精確回到作廢前的狀態");
  assert.equal(restorePlan.order.changes.length, 2, "作廢 + 復原兩筆都要留著");
  assert.equal(restorePlan.change.source, "restore");
});

test("對抗測項：對非作廢訂單呼叫復原 → 拒絕", () => {
  const o = order("o1", { status: "confirmed" });
  const plan = planRestoreOrder(o, NOW);
  assert.equal(plan.ok, false);
});

test("對抗測項：對已作廢訂單再次呼叫作廢 → 拒絕（避免重複 log 污染）", () => {
  const o = order("o1", { status: "confirmed" });
  const voidPlan = planVoidOrder(o, NOW);
  assert.ok(voidPlan.ok);
  if (!voidPlan.ok) return;
  const secondVoid = planVoidOrder(voidPlan.order, NOW);
  assert.equal(secondVoid.ok, false);
});

test("守恆：作廢不改變訂單筆數（呼叫端只是 update 不是 delete）——本測項驗證 plan 回傳仍是同一張訂單、非刪除語意", () => {
  const o = order("o1");
  const plan = planVoidOrder(o, NOW);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.order.id, o.id);
});

// ── 重複偵測 ──────────────────────────────────────────────────────────

test("重複偵測真值：完全重複×1組 + 同人不同日×1 + 同日不同品項×1 → 恰回報 1 組", () => {
  const orders = [
    // 完全重複組：同通路+同收件人+同品項+同下單日、id 不同
    order("dup-a", { recipientName: "王小明", order_date: "2026-08-01" }),
    order("dup-b", { recipientName: "王小明", order_date: "2026-08-01" }),
    // 同人不同日：不該被誤報
    order("diffday", { recipientName: "王小明", order_date: "2026-08-02" }),
    // 同日不同品項（用不同 quantity 製造差異）：不該被誤報
    order("diffitem", { recipientName: "王小明", order_date: "2026-08-01", quantity: 5 }),
  ];
  const groups = findDuplicateGroups(orders);
  assert.equal(groups.length, 1, "恰回報 1 組，後兩者不得被誤報");
  assert.deepEqual(groups[0]!.orderIds, ["dup-a", "dup-b"]);
});

test("重複偵測：作廢/取消的訂單不參與偵測（已經是處理過的狀態）", () => {
  const orders = [
    order("a", { recipientName: "阿強", order_date: "2026-08-01", status: "voided" }),
    order("b", { recipientName: "阿強", order_date: "2026-08-01", status: "confirmed" }),
  ];
  const groups = findDuplicateGroups(orders);
  assert.equal(groups.length, 0, "voided 那筆不該讓 confirmed 那筆被標成重複組");
});

test("重複偵測：3 筆完全一樣 → 整組 3 筆一起回報，不是拆成 pair", () => {
  const orders = [
    order("x1", { recipientName: "小美", order_date: "2026-08-05" }),
    order("x2", { recipientName: "小美", order_date: "2026-08-05" }),
    order("x3", { recipientName: "小美", order_date: "2026-08-05" }),
  ];
  const groups = findDuplicateGroups(orders);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.orderIds.length, 3);
});
