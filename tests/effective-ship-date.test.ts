/**
 * #6 期間統計一律用「出貨日」— effectiveShipDate 純函式 + 跨模組同源驗證。
 * 見 docs/boss-issues-plan-2026-08.md 順位 7。
 *
 * 真值（2026 年 8 月的星期二，menu.yaml 預設 shipping_weekdays=[2]）：
 *   08/04、08/11、08/18、08/25
 * 2026-07-31 是週五、往後第一個出貨日是 2026-08-04。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { effectiveShipDate } from "../src/domain/effective-ship-date.ts";
import { makeDayTypeOf, type DayOverrides } from "../src/domain/day-type.ts";
import { computePayout } from "../src/domain/compute-payout.ts";
import { computeStatsMatrix } from "../src/domain/compute-stats.ts";
import { computeMonthTrend, monthAlignedWindow, type ShipCalendar } from "../src/domain/compute-dashboard.ts";
import { summarizeByPeriod } from "../src/domain/period.ts";
import { loadMenu } from "../src/domain/menu.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Order } from "../src/domain/models.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const menu = loadMenu(readFileSync(join(ROOT, "data/menu.yaml"), "utf-8"));

function tuesdayDayTypeOf(overrides: DayOverrides = {}) {
  return makeDayTypeOf(menu, overrides);
}

function order(
  id: string,
  channel: Order["channel"],
  batchDate: string | null,
  revenue = 100
): Order {
  return {
    id,
    channel,
    status: "confirmed",
    batchDate,
    order_date: "2026-06-01",
    customer_wish_date: null,
    system_suggested_date: null,
    assignment_source: "pending",
    wish_priority: null,
    estimated_production_hours: null,
    recipient: { name: "test", igOrLine: null, phone: null, address: null, convStore: null },
    items: [{ productSkuId: "肉桂捲_單品", rawName: "肉桂捲_單品", quantity: 1, subtotal: revenue, atoms: [{ atomId: "肉桂捲", count: 1 }] }],
    revenue: { grossTotal: revenue, freight: 0, discount: 0 },
    labelCount: 1,
    shop_partner: channel === "駐店" ? "test-shop" : null,
    override_unit_price: null,
    freight_cost: 0,
    settled: false,
    payment_method: null,
    pendingReasons: [],
    rawSource: { file: "test", sheet: "test", rowIndex: 0, rawStatus: "" },
    snapshot: {
      c1_order_date: "2026-06-01",
      c5_status: "付款完成",
      c11_conv_store: null,
      c12_product: "肉桂捲",
      c17_freight: 0,
      c18_discount_seller: 0,
      c19_discount_freight: 0,
      c20_discount_platform: 0,
      c21_total: revenue,
      c22_label_count: 1,
      customer_wish_date: null,
    },
    first_seen_at: "2026-06-01T00:00:00Z",
    last_seen_at: "2026-06-01T00:00:00Z",
    disappeared_at: null,
    disappeared_resolution: null,
    frozen_after_label_print: false,
    changes: [],
  } as unknown as Order;
}

// ── 逐通路規則 ──────────────────────────────────────────────────────────

test("賣貨便：batchDate 非出貨日時往後推到下個出貨日", () => {
  const dayTypeOf = tuesdayDayTypeOf();
  const o = order("A", "賣貨便", "2026-07-31"); // 週五
  assert.equal(effectiveShipDate(o, dayTypeOf), "2026-08-04"); // 下個週二
});

test("賣貨便：batchDate 本身已是出貨日 → 原樣返回", () => {
  const dayTypeOf = tuesdayDayTypeOf();
  const o = order("B", "賣貨便", "2026-08-11"); // 已是週二
  assert.equal(effectiveShipDate(o, dayTypeOf), "2026-08-11");
});

test("宅配/面交/KOL 跟賣貨便同規則（都走 shippingDayFor）", () => {
  const dayTypeOf = tuesdayDayTypeOf();
  for (const channel of ["宅配", "面交_中壢", "KOL"] as const) {
    const o = order(`C-${channel}`, channel, "2026-07-31");
    assert.equal(effectiveShipDate(o, dayTypeOf), "2026-08-04", `${channel} 應跟賣貨便同規則`);
  }
});

test("駐店：batchDate 原值直接當出貨日，不推到下個出貨日", () => {
  const dayTypeOf = tuesdayDayTypeOf();
  const o = order("D", "駐店", "2026-08-15"); // 週六，非出貨日
  assert.equal(effectiveShipDate(o, dayTypeOf), "2026-08-15", "駐店不該被推到下個週二");
});

test("含 dayOverrides：單日 override 蓋過星期幾預設", () => {
  // 把 2026-08-05（週三）override 成出貨日，2026-08-04（原本週二）override 成工作日
  const dayTypeOf = tuesdayDayTypeOf({ "2026-08-04": "work", "2026-08-05": "ship" });
  const o = order("E", "賣貨便", "2026-08-04");
  assert.equal(effectiveShipDate(o, dayTypeOf), "2026-08-05", "override 後 08/04 不是出貨日，應推到 08/05");
});

test("無 batchDate → null（未排，不落任何期間）", () => {
  const dayTypeOf = tuesdayDayTypeOf();
  const o = order("F", "賣貨便", null);
  assert.equal(effectiveShipDate(o, dayTypeOf), null);
});

test("對抗測項：batchDate 非法格式 → 明確報錯，不靜默歸 null 或吐垃圾字串", () => {
  const dayTypeOf = tuesdayDayTypeOf();
  const o = order("G", "賣貨便", "not-a-date");
  assert.throws(() => effectiveShipDate(o, dayTypeOf), /不是合法 ISO 日期/);
});

// ── 跨模組同源驗證：出爐 7/31、出貨 8/4 的訂單在每個模組都歸 8 月 ──────────

test("跨月同源：分潤/出爐統計/儀表板/期間摘要 對同一批訂單的 8 月合計互相對得上", () => {
  const dayTypeOf = tuesdayDayTypeOf();
  const cal: ShipCalendar = {
    isShipDay: (iso) => dayTypeOf(iso) === "ship",
    shipDayOf: (iso) => {
      let cur = iso;
      for (let i = 0; i < 30; i++) {
        if (dayTypeOf(cur) === "ship") return cur;
        const d = new Date(cur);
        d.setDate(d.getDate() + 1);
        cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
      return iso;
    },
    effectiveShipDateOf: (o) => effectiveShipDate(o, dayTypeOf),
  };

  const orders = [
    order("A", "賣貨便", "2026-07-31", 1000), // → 08/04，跨月，這是關鍵案例
    order("B", "賣貨便", "2026-08-11", 500), // → 08/11，本來就在八月
    order("C", "駐店", "2026-08-15", 700), // 駐店，本來就在八月
    order("D", "賣貨便", "2026-07-14", 300), // → 停留七月，不該被算進八月
    order("E", "賣貨便", null, 999), // 未排，任何模組都不該算進任何月份
  ];
  const AUGUST_TOTAL = 1000 + 500 + 700; // A + B + C
  const AUGUST_COUNT = 3;

  // 1. 分潤（compute-payout.ts 沒有內建期間概念，用 effectiveShipDate 篩出八月子集再算）
  const augustOrders = orders.filter((o) => effectiveShipDate(o, dayTypeOf)?.startsWith("2026-08"));
  assert.equal(augustOrders.length, AUGUST_COUNT);
  const payout = computePayout(augustOrders, menu);
  assert.equal(payout.grossTotal, AUGUST_TOTAL);

  // 2. 儀表板月趨勢
  const win = monthAlignedWindow({ from: "2026-07-01", to: "2026-08-31" });
  const monthTrend = computeMonthTrend(orders, win, cal);
  const augRow = monthTrend.find((m) => m.month === "2026-08")!;
  assert.equal(augRow.revenue, AUGUST_TOTAL, "儀表板月趨勢的 8 月營收應跟分潤一致");
  assert.equal(augRow.orders, AUGUST_COUNT);

  // 3. 出爐統計（batchColumns 用有效出貨日分欄；08/04 那欄應該真的是 "2026-08-04"，
  //    不是原始的 "2026-07-31" —— 這正是這次要修的落差本身）
  const mx = computeStatsMatrix(orders, menu, dayTypeOf);
  const augustCols = mx.batchColumns.filter((c) => c.batchDate.startsWith("2026-08"));
  const augustAtomTotal = augustCols.reduce((s, c) => {
    const bt = mx.batchTotals.get(c.batchDate);
    return s + (bt?.total ?? 0);
  }, 0);
  // 3 筆八月訂單、每筆 1 個 atom（肉桂捲 ×1）
  assert.equal(augustAtomTotal, AUGUST_COUNT);
  assert.ok(
    mx.batchColumns.some((c) => c.batchDate === "2026-08-04"),
    "batchColumns 應該用有效出貨日 08/04、不是原始 batchDate 07/31"
  );
  assert.ok(
    !mx.batchColumns.some((c) => c.batchDate === "2026-07-31"),
    "不該再出現原始 batchDate 07/31 這個欄"
  );

  // 4. 期間摘要（summarizeByPeriod 用 year 粒度取得月彙總列）
  const yearSummary = summarizeByPeriod(orders, { type: "year", year: 2026 }, dayTypeOf);
  const augSummaryRow = yearSummary.find((r) => r.key === "2026-08")!;
  assert.ok(augSummaryRow, "期間摘要應該有 2026-08 這一列");
  assert.equal(augSummaryRow.revenue, AUGUST_TOTAL, "期間摘要 Excel 的 8 月營收應跟分潤/儀表板一致");
  assert.equal(augSummaryRow.order_count, AUGUST_COUNT);
});

test("守恆：各月合計 + 未排訂單數 = 訂單總數", () => {
  const dayTypeOf = tuesdayDayTypeOf();
  const orders = [
    order("A", "賣貨便", "2026-07-31", 1000),
    order("B", "賣貨便", "2026-08-11", 500),
    order("C", "駐店", "2026-08-15", 700),
    order("D", "賣貨便", "2026-07-14", 300),
    order("E", "賣貨便", null, 999),
  ];
  const yearSummary = summarizeByPeriod(orders, { type: "year", year: 2026 }, dayTypeOf);
  const summedCount = yearSummary.reduce((s, r) => s + r.order_count, 0);
  const unscheduledCount = orders.filter((o) => effectiveShipDate(o, dayTypeOf) === null).length;
  assert.equal(summedCount + unscheduledCount, orders.length);
  assert.equal(unscheduledCount, 1, "只有訂單 E 沒有 batchDate");
});
