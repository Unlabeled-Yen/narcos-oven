/**
 * 期間窗 + 趨勢軸的日期運算測試。
 *
 * 為什麼這塊特別需要測：算錯不會 throw、只會讓圖「看起來有點怪」——
 * 正是憲章 #1/#2 要根治的靜默失效。UI 上肉眼分不出「這週真的 0 單」
 * 跟「這週被算掉了」。
 *
 * 週二 = 出貨日（menu.scheduling.shipping_weekdays 預設 [2]）。
 * 2026-07 的週二：07/07、07/14、07/21、07/28
 * 2026-06 的週二：06/02、06/09、06/16、06/23、06/30
 * 2026-05 的週二：05/05、05/12、05/19、05/26
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePeriodWindow,
  computeBatchTrend,
  computeMonthTrend,
  monthAlignedWindow,
  computeTopProducts,
  addDays,
  type ShipCalendar,
  type DateWindow,
} from "../src/domain/compute-dashboard.ts";
import type { Order } from "../src/domain/models.ts";

// ── 測試用出貨行事曆：每週二出貨 ────────────────────────────────────────────
const tuesdayCal: ShipCalendar = {
  isShipDay: (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y!, m! - 1, d!).getDay() === 2;
  },
  shipDayOf: (iso) => {
    let cur = iso;
    for (let i = 0; i < 30; i++) {
      if (tuesdayCal.isShipDay(cur)) return cur;
      cur = addDays(cur, 1);
    }
    return iso;
  },
  effectiveShipDateOf: (o) => {
    if (!o.batchDate) return null;
    if (o.channel === "駐店") return o.batchDate;
    return tuesdayCal.shipDayOf(o.batchDate);
  },
};

function order(batchDate: string | null, revenue = 100, status: Order["status"] = "confirmed"): Order {
  return {
    id: `o-${batchDate ?? "none"}-${Math.round(revenue)}-${status}`,
    status,
    batchDate,
    channel: "賣貨便",
    items: [],
    revenue: { grossTotal: revenue },
    recipient: {},
  } as unknown as Order;
}

// ── addDays ────────────────────────────────────────────────────────────────

test("addDays 跨月/跨年正確", () => {
  assert.equal(addDays("2026-07-17", 1), "2026-07-18");
  assert.equal(addDays("2026-07-31", 1), "2026-08-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28"); // 2026 非閏年
});

test("addDays 不受 UTC 位移影響（本地午夜解析）", () => {
  // new Date("2026-07-17") 是 UTC 午夜，在 UTC 以西時區 getDay() 會退一天。
  // 這裡驗證日期字串進出穩定、不漂移。
  let iso = "2026-07-17";
  for (let i = 0; i < 400; i++) iso = addDays(iso, 1);
  assert.equal(iso, "2027-08-21");
});

// ── resolvePeriodWindow ────────────────────────────────────────────────────

test("8w 窗 = 回推 8 個出貨日（今天不是出貨日）", () => {
  // 2026-07-17 是週五 → 往回數 8 個週二：05/26 06/02 06/09 06/16 06/23 06/30 07/07 07/14
  const w = resolvePeriodWindow("8w", [], "2026-07-17", tuesdayCal);
  assert.equal(w.from, "2026-05-26");
  assert.equal(w.to, "2026-07-17");
});

test("8w 窗：今天正好是出貨日時，今天自己算第 1 個", () => {
  // 2026-07-14 是週二 → 含今天往回 8 個週二：
  //   07/14(1) 07/07(2) 06/30(3) 06/23(4) 06/16(5) 06/09(6) 06/02(7) 05/26(8)
  const w = resolvePeriodWindow("8w", [], "2026-07-14", tuesdayCal);
  assert.equal(w.from, "2026-05-26");
  assert.equal(w.to, "2026-07-14");
});

test("8w 窗：出貨日改成每週一時，軸跟著移動（不是寫死 7 天）", () => {
  const mondayCal: ShipCalendar = {
    isShipDay: (iso) => {
      const [y, m, d] = iso.split("-").map(Number);
      return new Date(y!, m! - 1, d!).getDay() === 1;
    },
    shipDayOf: (iso) => iso,
    effectiveShipDateOf: (o) => o.batchDate,
  };
  // 2026-07-17 週五 → 往回 8 個週一：07/13(1) 07/06(2) 06/29(3) 06/22(4)
  //   06/15(5) 06/08(6) 06/01(7) 05/25(8)
  const w = resolvePeriodWindow("8w", [], "2026-07-17", mondayCal);
  assert.equal(w.from, "2026-05-25");
});

test("6m 窗 = 含本月往回 6 個月、到月底", () => {
  const w = resolvePeriodWindow("6m", [], "2026-07-17", tuesdayCal);
  assert.equal(w.from, "2026-02-01");
  assert.equal(w.to, "2026-07-31");
});

test("6m 窗跨年", () => {
  const w = resolvePeriodWindow("6m", [], "2026-02-10", tuesdayCal);
  assert.equal(w.from, "2025-09-01");
  assert.equal(w.to, "2026-02-28");
});

test("all 窗 = 資料自己的範圍", () => {
  const w = resolvePeriodWindow("all", [order("2026-05-12"), order("2026-07-14"), order("2026-06-09")], "2026-07-17", tuesdayCal);
  assert.equal(w.from, "2026-05-12");
  assert.equal(w.to, "2026-07-14");
});

test("all 窗：完全沒有已排程訂單時退回今天單點窗（不炸）", () => {
  const w = resolvePeriodWindow("all", [order(null), order(null)], "2026-07-17", tuesdayCal);
  assert.deepEqual(w, { from: "2026-07-17", to: "2026-07-17" });
});

// ── computeBatchTrend ──────────────────────────────────────────────────────

test("batch 軸補滿空出貨日（這是本次改動的重點）", () => {
  const w: DateWindow = { from: "2026-06-30", to: "2026-07-21" };
  // 窗內週二：06/30 07/07 07/14 07/21，只有 07/14 有單
  const trend = computeBatchTrend([order("2026-07-14", 500)], w, tuesdayCal);
  assert.deepEqual(trend.map((t) => t.date), ["2026-06-30", "2026-07-07", "2026-07-14", "2026-07-21"]);
  assert.deepEqual(trend.map((t) => t.orders), [0, 0, 1, 0]);
  assert.deepEqual(trend.map((t) => t.revenue), [0, 0, 500, 0]);
});

test("非出貨日的 batchDate 會歸到所屬出貨批", () => {
  const w: DateWindow = { from: "2026-07-07", to: "2026-07-14" };
  // 07/09 是週四 → 歸到 07/14 那批
  const trend = computeBatchTrend([order("2026-07-09", 300)], w, tuesdayCal);
  const slot = trend.find((t) => t.date === "2026-07-14");
  assert.equal(slot?.orders, 1);
  assert.equal(slot?.revenue, 300);
  assert.equal(trend.find((t) => t.date === "2026-07-07")?.orders, 0);
});

test("窗外訂單不計入", () => {
  const w: DateWindow = { from: "2026-07-07", to: "2026-07-14" };
  const trend = computeBatchTrend(
    [order("2026-06-09", 999), order("2026-07-14", 100), order("2026-07-21", 999)],
    w, tuesdayCal,
  );
  assert.equal(trend.reduce((s, t) => s + t.orders, 0), 1);
  assert.equal(trend.reduce((s, t) => s + t.revenue, 0), 100);
});

test("只有 pending/canceled 的批 = 0，不是消失（軸仍在）", () => {
  const w: DateWindow = { from: "2026-07-07", to: "2026-07-14" };
  const trend = computeBatchTrend(
    [order("2026-07-07", 100, "canceled"), order("2026-07-07", 100, "pending_payment")],
    w, tuesdayCal,
  );
  assert.deepEqual(trend.map((t) => t.date), ["2026-07-07", "2026-07-14"]);
  assert.deepEqual(trend.map((t) => t.orders), [0, 0]);
});

test("shipped / kol_shipped 算進出爐量", () => {
  const w: DateWindow = { from: "2026-07-14", to: "2026-07-14" };
  const trend = computeBatchTrend(
    [order("2026-07-14", 100, "shipped"), order("2026-07-14", 50, "kol_shipped"), order("2026-07-14", 10, "confirmed")],
    w, tuesdayCal,
  );
  assert.equal(trend[0]?.orders, 3);
  assert.equal(trend[0]?.revenue, 160);
});

// ── computeMonthTrend ──────────────────────────────────────────────────────

test("month 軸補滿空月", () => {
  const w: DateWindow = { from: "2026-02-01", to: "2026-07-31" };
  const trend = computeMonthTrend([order("2026-07-14", 6900)], w, tuesdayCal);
  assert.deepEqual(trend.map((t) => t.month), ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
  assert.deepEqual(trend.map((t) => t.revenue), [0, 0, 0, 0, 0, 6900]);
});

test("month 軸跨年連續", () => {
  const w: DateWindow = { from: "2025-11-01", to: "2026-02-28" };
  const trend = computeMonthTrend([], w, tuesdayCal);
  assert.deepEqual(trend.map((t) => t.month), ["2025-11", "2025-12", "2026-01", "2026-02"]);
});

test("month 營收加總同月多單", () => {
  const w: DateWindow = { from: "2026-07-01", to: "2026-07-31" };
  const trend = computeMonthTrend([order("2026-07-07", 100), order("2026-07-14", 250)], w, tuesdayCal);
  assert.equal(trend.length, 1);
  assert.equal(trend[0]?.orders, 2);
  assert.equal(trend[0]?.revenue, 350);
});

// ── monthAlignedWindow ─────────────────────────────────────────────────────

test("月圖的窗撐成整月（否則「5月 · 0」會變成謊話）", () => {
  // 8w 窗 05/26–07/17：五月只有 6 天在內
  const w = monthAlignedWindow({ from: "2026-05-26", to: "2026-07-17" });
  assert.deepEqual(w, { from: "2026-05-01", to: "2026-07-31" });
});

test("撐整月後，窗邊緣的月份顯示真實營收而非 0", () => {
  const raw: DateWindow = { from: "2026-05-26", to: "2026-07-17" };
  const may = order("2026-05-12", 34800); // 五月有單、但落在 raw 窗之外

  const wrong = computeMonthTrend([may], raw, tuesdayCal);
  assert.equal(wrong.find((m) => m.month === "2026-05")?.revenue, 0,
    "沒撐整月時，五月會謊報 0");

  const right = computeMonthTrend([may], monthAlignedWindow(raw), tuesdayCal);
  assert.equal(right.find((m) => m.month === "2026-05")?.revenue, 34800,
    "撐整月後，五月報出真實營收");
});

test("撐整月不影響已經對齊的窗（6m / all 常見情況）", () => {
  assert.deepEqual(
    monthAlignedWindow({ from: "2026-02-01", to: "2026-07-31" }),
    { from: "2026-02-01", to: "2026-07-31" },
  );
});

// ── computeTopProducts 的 window ───────────────────────────────────────────

test("TOP 品項只算窗內（原本完全沒過濾、標籤卻寫本月）", () => {
  const mk = (batchDate: string, sku: string, qty: number) => ({
    ...order(batchDate),
    id: `${batchDate}-${sku}`,
    items: [{ productSkuId: sku, quantity: qty }],
  }) as unknown as Order;
  const w: DateWindow = { from: "2026-07-01", to: "2026-07-31" };
  const top = computeTopProducts([mk("2026-07-14", "cinnamon4", 3), mk("2026-06-09", "cinnamon4", 99)], w, tuesdayCal);
  assert.equal(top.length, 1);
  assert.equal(top[0]?.qty, 3, "六月那筆 99 份不該混進七月");
});
