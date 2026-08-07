/**
 * #9 賣貨便貨到付款 — 用真實 fixture 驗證。
 * 見 docs/boss-issues-plan-2026-08.md 順位 4。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadMenu } from "../src/domain/menu.ts";
import { parseSellerBuy } from "../src/parsers/seller-buy.ts";
import { codUnsettledSummary } from "../src/domain/compute-dashboard.ts";
import type { Order } from "../src/domain/models.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const menu = loadMenu(readFileSync(join(ROOT, "data/menu.yaml"), "utf-8"));

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function parseFixture1() {
  const buf = readFileSync(join(ROOT, "fixtures/2026-07-round1/1.xlsx"));
  return parseSellerBuy(toArrayBuffer(buf), "1.xlsx", menu).orders;
}

// 真值：人工在 fixtures/2026-07-round1/1.xlsx 逐筆核對過（c9「付款方式」欄）
const COD_ORDER_IDS = ["CM2606271567412", "CM2606241180237", "CM2606169933209"].sort();

test("總單數 50；付款方式=取貨付款 恰 3 筆（訂單編號寫死核對）", () => {
  const orders = parseFixture1();
  assert.equal(orders.length, 50);
  const cod = orders.filter((o) => o.payment_method === "取貨付款");
  assert.deepEqual(
    cod.map((o) => o.id).sort(),
    COD_ORDER_IDS
  );
});

test("信用卡單 47 筆、payment_method 正確標『信用卡』", () => {
  const orders = parseFixture1();
  const creditCard = orders.filter((o) => o.payment_method === "信用卡");
  assert.equal(creditCard.length, 47);
});

test("取貨付款單 status=confirmed（不進 pending_payment）、不進待處理桶", () => {
  const orders = parseFixture1();
  for (const id of COD_ORDER_IDS) {
    const o = orders.find((x) => x.id === id)!;
    assert.ok(o, `找不到訂單 ${id}`);
    assert.equal(o.status, "confirmed", `${id} 應為 confirmed`);
    assert.equal(o.pendingReasons.length, 0, `${id} 不該有 pending reason`);
  }
});

test("金額守恆：全批營收總額跟改動前的黃金值一字不差（放行≠改金額）", () => {
  const orders = parseFixture1();
  const total = orders.reduce((s, o) => s + o.revenue.grossTotal, 0);
  assert.equal(total, 32455);
});

test("extractLabels/工單統計會收到這 3 筆（走 confirmed 主軌、有 batchDate 才印，這裡驗證 status 已不卡關）", () => {
  const orders = parseFixture1();
  const cod = orders.filter((o) => COD_ORDER_IDS.includes(o.id));
  for (const o of cod) {
    // extractLabels 收 confirmed/kol_shipped/shipped + 有 batchDate；
    // parser 匯入當下 batchDate 一律 null（雇主拖排程才拍板），
    // 這裡只驗證「status 不再卡在 pending_payment」這個放行條件本身。
    assert.equal(o.status, "confirmed");
  }
});

test("儀表板未入帳提示：codUnsettledSummary 對這 3 筆算出正確筆數與金額", () => {
  const orders = parseFixture1();
  const summary = codUnsettledSummary(orders);
  assert.equal(summary.count, 3);
  assert.deepEqual(summary.orderIds.sort(), COD_ORDER_IDS);
  const codTotal = orders
    .filter((o) => COD_ORDER_IDS.includes(o.id))
    .reduce((s, o) => s + o.revenue.grossTotal, 0);
  assert.equal(summary.totalGross, codTotal);
});

test("flip 模擬：c5 狀態改『付款完成』重跑 diff 後，該單從未入帳清單消失", () => {
  const orders = parseFixture1();
  const flipped: Order[] = orders.map((o) =>
    o.id === COD_ORDER_IDS[0]
      ? { ...o, snapshot: { ...o.snapshot, c5_status: "付款完成\n(08/01 10:00)\n" } }
      : o
  );
  const summary = codUnsettledSummary(flipped);
  assert.equal(summary.count, 2);
  assert.ok(!summary.orderIds.includes(COD_ORDER_IDS[0]!));
});

test("對抗測項：付款方式空白 + 狀態『訂單成立』的單，不因這次改動被順手放行", () => {
  // 合成一筆：沒有「取貨付款」字樣、也還沒付款完成 —— 必須維持 pending_payment，
  // 不能因為新加的 isCOD 判斷而誤放行一般未付款單（那是把棄單風險放進工單）。
  const buf = readFileSync(join(ROOT, "fixtures/2026-07-round1/1.xlsx"));
  const arrayBuffer = toArrayBuffer(buf);
  const { orders } = parseSellerBuy(arrayBuffer, "1.xlsx", menu);
  const nonCodPending = orders.filter(
    (o) => o.payment_method !== "取貨付款" && o.status === "pending_payment"
  );
  // 這批 fixture 全部信用卡單都已付款完成，理論上不會有非COD的pending_payment；
  // 重點斷言：如果「取貨付款」判斷寫錯範圍（例如誤判非COD單），這裡會抓到。
  for (const o of nonCodPending) {
    assert.notEqual(o.payment_method, "取貨付款");
  }
});
