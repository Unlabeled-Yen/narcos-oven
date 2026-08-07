/**
 * #12 指定日吃 html — 用真實 fixture 驗證。
 * 見 docs/boss-issues-plan-2026-08.md 順位 5。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseSellerBuyHtml } from "../src/parsers/seller-buy-html.ts";
import { applyHtmlWishDates } from "../src/domain/apply-html-wish-dates.ts";
import { checkImportSanity } from "../src/domain/import-sanity.ts";
import { loadMenu } from "../src/domain/menu.ts";
import { parseSellerBuy } from "../src/parsers/seller-buy.ts";
import { buildOptions } from "../src/ui/pages/PendingPage.helpers.ts";
import type { Order } from "../src/domain/models.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const menu = loadMenu(readFileSync(join(ROOT, "data/menu.yaml"), "utf-8"));

function readHtm(name: string): string {
  return readFileSync(join(ROOT, "fixtures/2026-07-round1", name), "utf-8");
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// 真值：人工在 fixtures/2026-07-round1/2.htm 逐筆核對過
const TWO_HTM_TRUTH: Record<string, string> = {
  CM2606098851804: "2026-07-07",
  CM2606058292180: "2026-07-07",
  CM2606027863634: "2026-07-07",
  CM2605307360549: "2026-07-07",
  CM2605297343136: "2026-07-12",
  CM2605297338121: "2026-07-07",
  CM2605297332183: "2026-07-07",
};

test("2.htm：恰 7 筆指定日，訂單編號+日期逐筆吻合真值表", () => {
  const r = parseSellerBuyHtml(readHtm("2.htm"), "2.htm");
  assert.equal(r.totalOrdersInHtml, 8);
  assert.equal(r.entries.length, 7);
  const byId = Object.fromEntries(r.entries.map((e) => [e.order_id, e.customer_wish_date]));
  assert.deepEqual(byId, TWO_HTM_TRUTH);
});

test("1.htm：50 筆訂單、0 筆指定日、不誤報", () => {
  const r = parseSellerBuyHtml(readHtm("1.htm"), "1.htm");
  assert.equal(r.totalOrdersInHtml, 50);
  assert.equal(r.entries.length, 0);
});

test("對抗測項：非賣貨便訂單頁的 html → 明確拒絕，不誤解析出半筆訂單", () => {
  const fakeHtml = "<html><body><h1>隨便一個網頁</h1><p>指定出貨日 7/07</p></body></html>";
  assert.throws(() => parseSellerBuyHtml(fakeHtml, "random.html"), /不是可辨識的賣貨便訂單網頁存檔/);
});

// ── 合併語意：只補寫 customer_wish_date ──────────────────────────────────

function makeOrder(id: string, wishDate: string | null): Order {
  return {
    id,
    channel: "賣貨便",
    status: "confirmed",
    batchDate: null,
    order_date: "2026-06-01",
    customer_wish_date: wishDate,
    system_suggested_date: null,
    assignment_source: "pending",
    wish_priority: null,
    estimated_production_hours: null,
    recipient: { name: "測試", igOrLine: null, phone: null, address: null, convStore: "7-11" },
    items: [{ productSkuId: "肉桂捲_單品", rawName: "肉桂捲", quantity: 1, subtotal: 70, atoms: [{ atomId: "肉桂捲", count: 1 }] }],
    revenue: { grossTotal: 70, freight: 0, discount: 0 },
    labelCount: 1,
    shop_partner: null,
    override_unit_price: null,
    freight_cost: 0,
    settled: false,
    payment_method: "信用卡",
    pendingReasons: [],
    rawSource: { file: "test", sheet: "非訂單匯入", rowIndex: 1, rawStatus: "付款完成" },
    snapshot: {
      c1_order_date: "2026-06-01",
      c5_status: "付款完成",
      c11_conv_store: "7-11",
      c12_product: "肉桂捲",
      c17_freight: 0,
      c18_discount_seller: 0,
      c19_discount_freight: 0,
      c20_discount_platform: 0,
      c21_total: 70,
      c22_label_count: 1,
      customer_wish_date: wishDate,
    },
    first_seen_at: "2026-06-01T00:00:00Z",
    last_seen_at: "2026-06-01T00:00:00Z",
    disappeared_at: null,
    disappeared_resolution: null,
    frozen_after_label_print: false,
    changes: [],
  } as unknown as Order;
}

test("補上：訂單原本沒有指定日 → html 補上，不算衝突", () => {
  const orders = [makeOrder("A1", null)];
  const result = applyHtmlWishDates(orders, [{ order_id: "A1", customer_wish_date: "2026-08-04" }]);
  assert.equal(result.filledCount, 1);
  assert.deepEqual(result.filledOrderIds, ["A1"]);
  assert.equal(result.conflictOrderIds.length, 0);
  const updated = result.updatedOrders.find((o) => o.id === "A1")!;
  assert.equal(updated.customer_wish_date, "2026-08-04");
  // 其餘欄位零改動
  assert.equal(updated.revenue.grossTotal, 70);
  assert.equal(updated.recipient.name, "測試");
  assert.equal(updated.status, "confirmed");
});

test("一致：html 日期跟 xlsx 已有的一樣 → 無異動", () => {
  const orders = [makeOrder("A2", "2026-08-04")];
  const result = applyHtmlWishDates(orders, [{ order_id: "A2", customer_wish_date: "2026-08-04" }]);
  assert.equal(result.alreadyConsistentCount, 1);
  assert.equal(result.filledCount, 0);
  assert.equal(result.conflictOrderIds.length, 0);
});

test("衝突：xlsx 說 8/1、html 說 8/2 → 進待處理桶、兩個候選日期都在資料裡、customer_wish_date 不被覆蓋", () => {
  const orders = [makeOrder("A3", "2026-08-01")];
  const result = applyHtmlWishDates(orders, [{ order_id: "A3", customer_wish_date: "2026-08-02" }]);
  assert.deepEqual(result.conflictOrderIds, ["A3"]);
  const updated = result.updatedOrders.find((o) => o.id === "A3")!;
  assert.equal(updated.customer_wish_date, "2026-08-01", "衝突時不覆蓋、維持 xlsx 原值讓人擇一");
  assert.equal(updated.status, "pending_conflict_date");
  const reason = updated.pendingReasons.find((r) => r.code === "CONFLICT_DATE_C12_C28");
  assert.ok(reason, "應該有 CONFLICT_DATE_C12_C28 這條 pending reason");
  assert.equal(reason!.suggestion, "2026-08-02", "html 的候選日期存在 suggestion");
  assert.match(reason!.humanMessage, /2026-08-01/);
  assert.match(reason!.humanMessage, /2026-08-02/);
});

test("match 不到：html 裡的訂單編號 DB 找不到 → 進 unmatchedOrderIds，不靜默", () => {
  const orders = [makeOrder("A1", null)];
  const result = applyHtmlWishDates(orders, [
    { order_id: "A1", customer_wish_date: "2026-08-04" },
    { order_id: "NOT-IN-DB-001", customer_wish_date: "2026-08-05" },
  ]);
  assert.deepEqual(result.unmatchedOrderIds, ["NOT-IN-DB-001"]);
});

// ── PendingPage UI 選項：月/日不能被 destructure 錯位 ──────────────────────
// 2026-08-07 手動瀏覽器驗證時抓到：`[, mm, dd] = "2026-08-01".match(...)`
// 少 skip 一格，把 mm 取成年份、dd 取成月份，畫面顯示「2026/08」而非「08/01」。

test("buildOptions(CONFLICT_DATE_C12_C28)：選項顯示 MM/DD、不是 YYYY/MM", () => {
  const order = {
    id: "T1",
    customer_wish_date: "2026-08-01",
    pendingReasons: [
      {
        code: "CONFLICT_DATE_C12_C28",
        humanMessage: "指定出貨日衝突：xlsx 記為 2026-08-01、html 網頁存檔記為 2026-08-18",
        suggestion: "2026-08-18",
        suggestionConfidence: 0,
      },
    ],
  } as unknown as Order;
  const opts = buildOptions(order, menu);
  const labels = opts.map((o) => o.label);
  assert.ok(labels.some((l) => l.includes("08/01")), `應包含 08/01，實際：${labels.join(" | ")}`);
  assert.ok(labels.some((l) => l.includes("08/18")), `應包含 08/18，實際：${labels.join(" | ")}`);
  assert.ok(!labels.some((l) => l.includes("2026/08")), `不該出現年月誤植成 2026/08：${labels.join(" | ")}`);
});

// ── sanity 警示 ──────────────────────────────────────────────────────────

test("sanity：純 xlsx 批次整批 0 筆指定日 → ZERO_WISH_DATE 警示", () => {
  const buf = readFileSync(join(ROOT, "fixtures/2026-07-round1/1.xlsx"));
  const { orders } = parseSellerBuy(toArrayBuffer(buf), "1.xlsx", menu);
  // dbActive 給一份非空的既有資料（否則 sanity 會因為「第一次匯」而 skip 檢查）
  const dbActive = [makeOrder("DB-EXISTING-1", null)];
  const report = checkImportSanity(orders, dbActive);
  const zeroWishWarning = report.warnings.find((w) => w.code === "ZERO_WISH_DATE");
  assert.ok(zeroWishWarning, "1.xlsx 全批無指定日，應該出現 ZERO_WISH_DATE 警示");
  assert.equal(zeroWishWarning!.severity, "notice");
});

test("sanity 對抗測項：批次裡只要有 1 筆指定日，就不該誤報 ZERO_WISH_DATE", () => {
  const buf = readFileSync(join(ROOT, "fixtures/2026-07-round1/2.xlsx"));
  const { orders } = parseSellerBuy(toArrayBuffer(buf), "2.xlsx", menu);
  const hasWishDate = orders.some((o) => o.customer_wish_date != null);
  assert.ok(hasWishDate, "2.xlsx 本身應該有指定日（前提假設）");
  const dbActive = [makeOrder("DB-EXISTING-2", null)];
  const report = checkImportSanity(orders, dbActive);
  const zeroWishWarning = report.warnings.find((w) => w.code === "ZERO_WISH_DATE");
  assert.equal(zeroWishWarning, undefined);
});
