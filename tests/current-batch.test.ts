/**
 * #11+#14 批次跨頁雙向連動 — batchListFrom 收斂 + hash query 序列化驗證。
 * 見 docs/boss-issues-plan-2026-08.md 順位 9。
 *
 * 真值（2026 年 8 月的星期二，menu.yaml 預設 shipping_weekdays=[2]）：
 *   08/04、08/11、08/18、08/25
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { batchListFrom, parseBatchHash, serializeBatchHash } from "../src/domain/current-batch.ts";
import { makeDayTypeOf } from "../src/domain/day-type.ts";
import { loadMenu } from "../src/domain/menu.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Order, OrderStatus } from "../src/domain/models.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const menu = loadMenu(readFileSync(join(ROOT, "data/menu.yaml"), "utf-8"));
const dayTypeOf = makeDayTypeOf(menu, {});

function order(id: string, batchDate: string | null, status: OrderStatus = "confirmed"): Order {
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

// ── hash 序列化往返 ──────────────────────────────────────────────

test("hash 往返：序列化再解析、一字不差", () => {
  const hash = serializeBatchHash("worksheet", "2026-08-11");
  assert.equal(hash, "#/worksheet?batch=2026-08-11");
  const parsed = parseBatchHash(hash);
  assert.deepEqual(parsed, { page: "worksheet", batch: "2026-08-11" });
  assert.equal(serializeBatchHash(parsed.page!, parsed.batch), hash);
});

test("hash 無 batch 參數 → batch:null、序列化不帶 query", () => {
  assert.deepEqual(parseBatchHash("#/schedule"), { page: "schedule", batch: null });
  assert.equal(serializeBatchHash("schedule", null), "#/schedule");
});

test("對抗測項：非法日期參數 → 忽略回預設，不 crash", () => {
  const parsed = parseBatchHash("#/worksheet?batch=not-a-date");
  assert.deepEqual(parsed, { page: "worksheet", batch: null });
});

test("對抗測項：亂打的 hash（無 #/page 格式）→ page/batch 皆 null，不 crash", () => {
  assert.deepEqual(parseBatchHash("garbage"), { page: null, batch: null });
  assert.deepEqual(parseBatchHash(""), { page: null, batch: null });
});

// ── 同源斷言：工單/出貨明細/印標籤三頁的批次清單來自同一個函式 ──────────

test("同源：出貨明細排除全 shipped 批、印標籤與工單不排除；差集恰為全 shipped 批次", () => {
  const orders = [
    // 08/04：兩單皆 shipped → 全出貨批
    order("a1", "2026-08-04", "shipped"),
    order("a2", "2026-08-04", "shipped"),
    // 08/11：一單 shipped、一單 confirmed → 混合批，仍在清單（只是出貨明細看不到 shipped 那筆）
    order("b1", "2026-08-11", "shipped"),
    order("b2", "2026-08-11", "confirmed"),
    // 08/18：全 confirmed
    order("c1", "2026-08-18", "confirmed"),
  ];

  const worksheetList = batchListFrom(orders, dayTypeOf, { excludeFullyShipped: false });
  const printLabelsList = batchListFrom(orders, dayTypeOf, { excludeFullyShipped: false });
  const shippingDetailsList = batchListFrom(orders, dayTypeOf, { excludeFullyShipped: true });

  assert.deepEqual(worksheetList, ["2026-08-04", "2026-08-11", "2026-08-18"]);
  assert.deepEqual(printLabelsList, worksheetList, "工單與印標籤同源、清單完全一致");
  assert.deepEqual(shippingDetailsList, ["2026-08-11", "2026-08-18"]);

  const diff = worksheetList.filter((d) => !shippingDetailsList.includes(d));
  assert.deepEqual(diff, ["2026-08-04"], "差集恰為全 shipped 的批次");
});

test("跨週：合成 3 週後的批次仍出現在清單（不再被 weekISO 篩掉）", () => {
  const orders = [order("far", "2026-09-15", "confirmed")]; // 遠超過「本週」範圍
  const list = batchListFrom(orders, dayTypeOf, { excludeFullyShipped: false });
  assert.ok(list.length === 1, "跨週批次必須出現，不能被週邊界濾掉");
});

test("批次不存在於某頁（全 shipped）→ 呼叫端可用 list.includes 判斷、不靜默 fallback", () => {
  const orders = [order("x1", "2026-08-04", "shipped")];
  const shippingDetailsList = batchListFrom(orders, dayTypeOf, { excludeFullyShipped: true });
  assert.equal(shippingDetailsList.includes("2026-08-04"), false, "全 shipped 批次不該出現在出貨明細清單");
  // 印標籤/工單語意仍看得到
  const printLabelsList = batchListFrom(orders, dayTypeOf, { excludeFullyShipped: false });
  assert.equal(printLabelsList.includes("2026-08-04"), true);
});

test("守恆：Σ 各批次單數 + 未排單數 = 訂單總數", () => {
  const orders = [
    order("a", "2026-08-04", "confirmed"),
    order("b", "2026-08-04", "confirmed"),
    order("c", "2026-08-11", "confirmed"),
    order("d", null, "pending_payment"),
  ];
  const list = batchListFrom(orders, dayTypeOf, { excludeFullyShipped: false });
  let batchedCount = 0;
  for (const d of list) {
    batchedCount += orders.filter((o) => o.batchDate && shippingDayForTest(o.batchDate) === d).length;
  }
  const unscheduled = orders.filter((o) => o.batchDate === null).length;
  assert.equal(batchedCount + unscheduled, orders.length);

  function shippingDayForTest(iso: string): string {
    // 本測試 fixture 全為 shipping day 本身或往後最近一天，直接複用 dayTypeOf 邏輯驗證
    let cur = iso;
    for (let i = 0; i < 14; i++) {
      if (dayTypeOf(cur) === "ship") return cur;
      const d = new Date(cur);
      d.setDate(d.getDate() + 1);
      cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    return iso;
  }
});

test("對抗測項：day-overrides 改變出貨日後，舊批次不再存在於清單 → 呼叫端該顯性提示", () => {
  const orders = [order("y1", "2026-08-04", "confirmed")]; // 08/04 是週二、預設出貨日
  const normalList = batchListFrom(orders, dayTypeOf, { excludeFullyShipped: false });
  assert.ok(normalList.includes("2026-08-04"));

  // 把 08/04 override 成工作日 → 訂單改歸屬到下一個出貨日（08/05 若非 override 就不是 ship；
  // 用 override 讓 08/04 變 work、08/05 變 ship，模擬「舊 hash 指到的批次消失」情境）
  const overriddenDayTypeOf = makeDayTypeOf(menu, { "2026-08-04": "work", "2026-08-05": "ship" });
  const newList = batchListFrom(orders, overriddenDayTypeOf, { excludeFullyShipped: false });
  assert.equal(newList.includes("2026-08-04"), false, "舊批次應該消失");
  assert.ok(newList.includes("2026-08-05"), "訂單改歸屬到新出貨日");
});
