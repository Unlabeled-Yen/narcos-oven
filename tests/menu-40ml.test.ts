/**
 * #13 六入附醬 40ml — menu.yaml 資料正確性 + COGS 影響驗證。
 * 見 docs/boss-issues-plan-2026-08.md 順位 1。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadMenu } from "../src/domain/menu.ts";
import { computePayout } from "../src/domain/compute-payout.ts";
import type { Order } from "../src/domain/models.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const menu = loadMenu(readFileSync(join(ROOT, "data/menu.yaml"), "utf-8"));

const COMBO_SKU_IDS = ["經典肉桂捲6入", "蘋果肉桂捲6入", "長型6入_混合"];

test("三個六入組合 SKU 的 contains 恰含 40ml 醬 × 1、不含 90ml", () => {
  for (const skuId of COMBO_SKU_IDS) {
    const product = menu.products[skuId];
    assert.ok(product, `menu.yaml 缺 SKU ${skuId}`);
    const sauceEntries = product.contains.filter((c) => c.atom.startsWith("香料堅果醬"));
    assert.equal(sauceEntries.length, 1, `${skuId} 應恰有 1 條堅果醬 contains`);
    assert.equal(sauceEntries[0]!.atom, "香料堅果醬40ml", `${skuId} 應為 40ml`);
    assert.equal(sauceEntries[0]!.count, 1, `${skuId} 堅果醬數量應為 1`);
  }
});

test("全 menu 掃描：沒有任何組合 SKU 引用 90ml（90ml 只能是單品）", () => {
  for (const [skuId, product] of Object.entries(menu.products)) {
    if (product.category !== "combo") continue;
    const has90 = product.contains.some((c) => c.atom === "香料堅果醬90ml");
    assert.ok(!has90, `組合 SKU ${skuId} 不應引用 90ml`);
  }
});

test("單品 SKU「香料堅果醬90ml」本身不受影響（仍是 90ml 單買）", () => {
  const single = menu.products["香料堅果醬90ml"];
  assert.ok(single, "單品 SKU 香料堅果醬90ml 應存在");
  assert.equal(single.category, "single");
  assert.equal(single.contains.length, 1);
  assert.equal(single.contains[0]!.atom, "香料堅果醬90ml");
});

test("atoms 成本：90ml=81.91、40ml=28.96，差額恰為 $52.95", () => {
  const cost90 = menu.atoms["香料堅果醬90ml"]?.cost;
  const cost40 = menu.atoms["香料堅果醬40ml"]?.cost;
  assert.equal(cost90, 81.91);
  assert.equal(cost40, 28.96);
  assert.equal(Math.round((cost90! - cost40!) * 100) / 100, 52.95);
});

function makeOrder(skuId: string, atoms: { atomId: string; count: number }[]): Order {
  return {
    id: "test-order-1",
    channel: "賣貨便_超商",
    status: "confirmed",
    batchDate: null,
    order_date: "2026-08-01",
    customer_wish_date: null,
    system_suggested_date: null,
    assignment_source: "pending",
    wish_priority: null,
    estimated_production_hours: null,
    recipient: { name: "test", igOrLine: null, phone: null, address: null, convStore: null },
    items: [
      {
        productSkuId: skuId,
        rawName: skuId,
        quantity: 1,
        subtotal: 0,
        atoms,
      },
    ],
    revenue: { grossTotal: 0, freight: 0, discount: 0 },
    labelCount: 1,
    shop_partner: null,
    override_unit_price: null,
    freight_cost: null,
    settled: false,
    pendingReasons: [],
    rawSource: { file: "test", sheet: "test", rowIndex: 0, rawStatus: "" },
    snapshot: {
      c1_order_date: null,
      c5_status: "",
      c11_conv_store: null,
      c12_product: "",
      c17_freight: null,
      c18_discount_seller: 0,
      c19_discount_freight: 0,
      c20_discount_platform: 0,
      c21_total: null,
      c22_label_count: null,
      customer_wish_date: null,
    },
    first_seen_at: "2026-08-01T00:00:00Z",
    last_seen_at: "2026-08-01T00:00:00Z",
    disappeared_at: null,
    disappeared_resolution: null,
    frozen_after_label_print: false,
    changes: [],
  } as unknown as Order;
}

test("COGS 影響：經典六入用新 atoms（40ml）算出的成本比舊 90ml 少 $52.95", () => {
  const orderNew = makeOrder("經典肉桂捲6入", [
    { atomId: "肉桂捲", count: 5 },
    { atomId: "香料堅果醬40ml", count: 1 },
  ]);
  const orderOld = makeOrder("經典肉桂捲6入", [
    { atomId: "肉桂捲", count: 5 },
    { atomId: "香料堅果醬90ml", count: 1 },
  ]);
  // 兩單都把 productSkuId 設為同一個組合 SKU，但 product.cost 在 menu.yaml
  // 是 null（走 atoms fallback）——所以 cogsFor 讀的是 order.items[].atoms，
  // 不是 menu 當下定義，這正是「歷史訂單不會自動回溯」問題的重現與驗證。
  const payoutNew = computePayout([orderNew], menu);
  const payoutOld = computePayout([orderOld], menu);
  const delta = Math.round((payoutOld.cogs - payoutNew.cogs) * 100) / 100;
  assert.equal(delta, 52.95);
});

test("對抗測項：單買 90ml 訂單不受此次修正影響", () => {
  const orderSingle90 = makeOrder("香料堅果醬90ml", [{ atomId: "香料堅果醬90ml", count: 1 }]);
  const product = menu.products["香料堅果醬90ml"]!;
  assert.equal(product.contains[0]!.atom, "香料堅果醬90ml");
  const payout = computePayout([orderSingle90], menu);
  assert.equal(payout.cogs, 81.91);
});
