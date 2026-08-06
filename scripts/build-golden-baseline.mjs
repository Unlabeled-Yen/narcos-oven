/**
 * 建立黃金值回歸基準（docs/boss-issues-plan-2026-08.md「驗證總則」#5）。
 *
 * 對每個真實 fixture 各自跑對應 parser（不做跨檔 diff/merge，
 * 每個 priority 項目要驗證的是「這個 parser/計算模組對這份真實輸入
 * 算出的數字有沒有意外變動」，跨檔合併是 IndexedDB 執行期的事、
 * 不在 node 腳本範圍內）。
 *
 * 產出 tests/golden/baseline.json，之後 tests/golden-baseline.test.ts
 * 重新跑一次同樣的 parse + compute、逐欄比對，任何偏移即 fail。
 *
 * 用法：node scripts/build-golden-baseline.mjs
 * （只在「確認這次改動的數字變化是預期中的」之後才重新產生 baseline，
 *  不是每次改完就無腦重跑——那樣基準會失去偵錯意義。）
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadMenu } from "../src/domain/menu.ts";
import { parseSellerBuy } from "../src/parsers/seller-buy.ts";
import { parseInPerson } from "../src/parsers/in-person.ts";
import { parseKol } from "../src/parsers/kol.ts";
import { computePayout } from "../src/domain/compute-payout.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIXTURE_DIR = join(ROOT, "fixtures/2026-07-round1");

const menu = loadMenu(readFileSync(join(ROOT, "data/menu.yaml"), "utf-8"));

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function summarize(label, orders) {
  const byStatus = {};
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
    label,
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

const results = {};

{
  const buf = readFileSync(join(FIXTURE_DIR, "1.xlsx"));
  const r = parseSellerBuy(toArrayBuffer(buf), "1.xlsx", menu);
  results["seller-buy/1.xlsx"] = summarize("seller-buy/1.xlsx", r.orders);
  results["seller-buy/1.xlsx"].raw_row_count = r.raw_row_count;
}

{
  const buf = readFileSync(join(FIXTURE_DIR, "2.xlsx"));
  const r = parseSellerBuy(toArrayBuffer(buf), "2.xlsx", menu);
  results["seller-buy/2.xlsx"] = summarize("seller-buy/2.xlsx", r.orders);
  results["seller-buy/2.xlsx"].raw_row_count = r.raw_row_count;
}

{
  const buf = readFileSync(
    join(FIXTURE_DIR, "2026 六月 面交訂購單 (回覆).xlsx")
  );
  const r = parseInPerson(toArrayBuffer(buf), "in-person.xlsx", menu);
  results["in-person"] = summarize("in-person", r.orders);
  results["in-person"].raw_row_count = r.raw_row_count;
}

{
  const buf = readFileSync(join(FIXTURE_DIR, "KOL 合作.xlsx"));
  const r = parseKol(toArrayBuffer(buf), "kol.xlsx", menu);
  results["kol"] = summarize("kol", r.orders);
  results["kol"].raw_row_count = r.raw_row_count;
}

const outDir = join(ROOT, "tests/golden");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "baseline.json");
writeFileSync(
  outPath,
  JSON.stringify(
    { generated_note: "見 scripts/build-golden-baseline.mjs 頂端註解", results },
    null,
    2
  ) + "\n"
);

console.log(`✅ 黃金值基準已寫入 ${outPath}`);
for (const [key, v] of Object.entries(results)) {
  console.log(
    `  ${key}: ${v.order_count} 筆訂單、營收合計 $${v.gross_total_sum}、狀態 ${JSON.stringify(v.by_status)}`
  );
}
