/**
 * #10 訂單總覽批次修改狀態 — planStatusBatch 純函式驗證。
 * 見 docs/boss-issues-plan-2026-08.md 順位 8。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { planStatusBatch, type StatusBatchChange } from "../src/ui/pages/OrdersPage.helpers.ts";
import type { Order, OrderStatus } from "../src/domain/models.ts";

function order(id: string, status: OrderStatus, batchDate: string | null = "2026-08-11"): Order {
  return {
    id,
    channel: "賣貨便",
    status,
    batchDate,
    order_date: "2026-08-01",
    customer_wish_date: null,
    system_suggested_date: null,
    assignment_source: batchDate ? "customer_wish_kept" : "pending",
    wish_priority: null,
    estimated_production_hours: null,
    recipient: { name: "測試", igOrLine: null, phone: null, address: null, convStore: null },
    items: [],
    revenue: { grossTotal: 100, freight: 0, discount: 0 },
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

test("10 筆 shipped → confirmed：跟單筆 updateStatus 一致，全部清 batchDate", () => {
  const orders = Array.from({ length: 10 }, (_, i) => order(`o${i}`, "shipped"));
  const plan = planStatusBatch(orders, orders.map((o) => o.id), "confirmed");
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.changes.length, 10);
  for (const c of plan.changes) {
    assert.equal(c.before, "shipped");
    assert.equal(c.after, "confirmed");
    assert.equal(c.clearBatchDate, true, `${c.id} 應該要清 batchDate（shipped→非shipped 補償）`);
  }
});

test("非 shipped→shipped 的轉換不清 batchDate", () => {
  const orders = [order("o1", "confirmed")];
  const plan = planStatusBatch(orders, ["o1"], "shipped");
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.changes[0]!.clearBatchDate, false);
});

test("confirmed → canceled：不觸發清 batchDate 補償（只有 shipped→非shipped 才清）", () => {
  const orders = [order("o1", "confirmed")];
  const plan = planStatusBatch(orders, ["o1"], "canceled");
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.changes[0]!.clearBatchDate, false);
});

test("回傳的變更筆數 = 請求筆數", () => {
  const orders = Array.from({ length: 5 }, (_, i) => order(`o${i}`, "confirmed"));
  const ids = orders.map((o) => o.id);
  const plan = planStatusBatch(orders, ids, "shipped");
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.changes.length, ids.length);
});

test("對抗測項：ids 含 DB 不存在的單 → 整批拒絕（ok:false），不部分套用", () => {
  const orders = [order("o1", "confirmed"), order("o2", "confirmed")];
  const plan = planStatusBatch(orders, ["o1", "o2", "NOT-EXIST"], "shipped");
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.deepEqual(plan.missingIds, ["NOT-EXIST"]);
});

test("對抗測項：空選取回傳空變更（呼叫端應該擋在 UI 層不送出，但函式本身要行為正確）", () => {
  const orders = [order("o1", "confirmed")];
  const plan = planStatusBatch(orders, [], "shipped");
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.changes.length, 0);
});

test("守恆：批次套用跟單筆逐一套用，對同一批輸入結果完全相同", () => {
  const orders = [
    order("a", "shipped"),
    order("b", "confirmed"),
    order("c", "shipped"),
  ];
  const ids = ["a", "b", "c"];
  const batchPlan = planStatusBatch(orders, ids, "canceled");
  assert.ok(batchPlan.ok);
  if (!batchPlan.ok) return;

  // 逐一單筆跑同一套規則（模擬單筆 updateStatus 的判斷邏輯；目標狀態固定是 "canceled"，
  // 所以 shipped→非shipped 的補償條件簡化成「原本是 shipped 就該清」）
  for (const id of ids) {
    const o = orders.find((x) => x.id === id)!;
    const singleClear: boolean = o.status === "shipped";
    const batchChange: StatusBatchChange = batchPlan.changes.find((c) => c.id === id)!;
    assert.equal(batchChange.clearBatchDate, singleClear, `${id} 批次與單筆判斷應一致`);
  }
});
