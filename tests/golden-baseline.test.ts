/**
 * 黃金值回歸測試（docs/boss-issues-plan-2026-08.md「驗證總則」#5）。
 *
 * 對每個真實 fixture 重新跑對應 parser + computePayout，逐欄跟
 * tests/golden/baseline.json 比對。任何未預告的偏移即 fail——
 * 這是防止「這次改動意外動到不該動的數字」的守恆律回歸閘門。
 *
 * 若某項工作預告會改變特定數字（例如 #13 改 40ml 後六入 SKU 的
 * cogs 會降），先跑 `npx tsx scripts/build-golden-baseline.mjs`
 * 重新產生 baseline、並在該項的 commit 訊息寫明變化量，
 * 不得無聲重跑掩蓋非預期的變動。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadMenu } from "../src/domain/menu.ts";
import { parseSellerBuy } from "../src/parsers/seller-buy.ts";
import { parseInPerson } from "../src/parsers/in-person.ts";
import { parseKol } from "../src/parsers/kol.ts";
import { computePayout } from "../src/domain/compute-payout.ts";
import type { Order } from "../src/domain/models.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIXTURE_DIR = join(ROOT, "fixtures/2026-07-round1");

const menu = loadMenu(readFileSync(join(ROOT, "data/menu.yaml"), "utf-8"));
const baseline = JSON.parse(
  readFileSync(join(ROOT, "tests/golden/baseline.json"), "utf-8")
).results;

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength
  ) as ArrayBuffer;
}

function summarize(orders: Order[]) {
  const byStatus: Record<string, number> = {};
  for (const o of orders) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  }
  const grossTotalSum = orders.reduce(
    (sum, o) => sum + (o.revenue?.grossTotal ?? 0),
    0
  );
  const itemCount = orders.reduce((sum, o) => sum + o.items.length, 0);
  const payout = computePayout(orders, menu);
  return {
    order_count: orders.length,
    by_status: byStatus,
    gross_total_sum: Math.round(grossTotalSum * 100) / 100,
    item_line_count: itemCount,
    payout_eligible_order_count: payout.orderCount,
    payout_gross_total: Math.round(payout.grossTotal * 100) / 100,
    payout_cogs_total: Math.round(payout.cogs * 100) / 100,
    payout_net_profit: Math.round(payout.netProfit * 100) / 100,
    payout_is_estimated: payout.isEstimated,
  };
}

function assertMatchesBaseline(key: string, actual: ReturnType<typeof summarize>) {
  const expected = baseline[key];
  assert.ok(expected, `黃金值基準缺少 key「${key}」— tests/golden/baseline.json 需重建`);
  assert.equal(
    actual.order_count,
    expected.order_count,
    `[${key}] 訂單數變了：預期 ${expected.order_count}、實際 ${actual.order_count}`
  );
  assert.deepEqual(
    actual.by_status,
    expected.by_status,
    `[${key}] 狀態分布變了：預期 ${JSON.stringify(expected.by_status)}、實際 ${JSON.stringify(actual.by_status)}`
  );
  assert.equal(
    actual.gross_total_sum,
    expected.gross_total_sum,
    `[${key}] 營收合計變了：預期 $${expected.gross_total_sum}、實際 $${actual.gross_total_sum}`
  );
  assert.equal(
    actual.item_line_count,
    expected.item_line_count,
    `[${key}] 品項行數變了：預期 ${expected.item_line_count}、實際 ${actual.item_line_count}`
  );
  assert.equal(
    actual.payout_eligible_order_count,
    expected.payout_eligible_order_count,
    `[${key}] 分潤可計算訂單數變了`
  );
  assert.equal(
    actual.payout_gross_total,
    expected.payout_gross_total,
    `[${key}] 分潤營收變了`
  );
  assert.equal(
    actual.payout_cogs_total,
    expected.payout_cogs_total,
    `[${key}] 分潤成本變了：預期 $${expected.payout_cogs_total}、實際 $${actual.payout_cogs_total}（若此項工作預告會改成本，需連同 commit 一併重建 baseline 並說明變化量）`
  );
  assert.equal(
    actual.payout_net_profit,
    expected.payout_net_profit,
    `[${key}] 分潤淨利變了：預期 $${expected.payout_net_profit}、實際 $${actual.payout_net_profit}`
  );
  assert.equal(
    actual.payout_is_estimated,
    expected.payout_is_estimated,
    `[${key}] 估算旗標變了`
  );
}

test("golden baseline: seller-buy 1.xlsx 未預告變動時數字不漂移", () => {
  const buf = readFileSync(join(FIXTURE_DIR, "1.xlsx"));
  const r = parseSellerBuy(toArrayBuffer(buf), "1.xlsx", menu);
  assertMatchesBaseline("seller-buy/1.xlsx", summarize(r.orders));
});

test("golden baseline: seller-buy 2.xlsx 未預告變動時數字不漂移", () => {
  const buf = readFileSync(join(FIXTURE_DIR, "2.xlsx"));
  const r = parseSellerBuy(toArrayBuffer(buf), "2.xlsx", menu);
  assertMatchesBaseline("seller-buy/2.xlsx", summarize(r.orders));
});

test("golden baseline: in-person 未預告變動時數字不漂移", () => {
  const buf = readFileSync(
    join(FIXTURE_DIR, "2026 六月 面交訂購單 (回覆).xlsx")
  );
  const r = parseInPerson(toArrayBuffer(buf), "in-person.xlsx", menu);
  assertMatchesBaseline("in-person", summarize(r.orders));
});

test("golden baseline: kol 未預告變動時數字不漂移", () => {
  const buf = readFileSync(join(FIXTURE_DIR, "KOL 合作.xlsx"));
  const r = parseKol(toArrayBuffer(buf), "kol.xlsx", menu);
  assertMatchesBaseline("kol", summarize(r.orders));
});
