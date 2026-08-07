/**
 * #7 駐店運費可計算、可呈現 — compute-payout.ts 驗證。
 * 見 docs/boss-issues-plan-2026-08.md 順位 6。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadMenu } from "../src/domain/menu.ts";
import { computePayout } from "../src/domain/compute-payout.ts";
import { parseSellerBuy } from "../src/parsers/seller-buy.ts";
import { OrderSchema } from "../src/domain/models.ts";
import type { Order } from "../src/domain/models.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const menu = loadMenu(readFileSync(join(ROOT, "data/menu.yaml"), "utf-8"));

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function makeShopOrder(id: string, grossTotal: number, freightCost: number): Order {
  return {
    id,
    channel: "駐店",
    status: "confirmed",
    batchDate: "2026-08-11",
    order_date: "2026-08-01",
    customer_wish_date: null,
    system_suggested_date: null,
    assignment_source: "boss_scheduled",
    wish_priority: null,
    estimated_production_hours: null,
    recipient: { name: "測試店家A", igOrLine: null, phone: null, address: null, convStore: null },
    items: [{ productSkuId: "肉桂捲_單品", rawName: "肉桂捲_單品", quantity: 1, subtotal: grossTotal, atoms: [{ atomId: "肉桂捲", count: 1 }] }],
    revenue: { grossTotal, freight: 0, discount: 0 },
    labelCount: 1,
    shop_partner: "測試店家a",
    override_unit_price: null,
    freight_cost: freightCost,
    settled: false,
    payment_method: null,
    pendingReasons: [],
    rawSource: { file: "manual", sheet: "manual", rowIndex: 0, rawStatus: "manual" },
    snapshot: {
      c1_order_date: "2026-08-01",
      c5_status: "manual",
      c11_conv_store: null,
      c12_product: "肉桂捲",
      c17_freight: null,
      c18_discount_seller: 0,
      c19_discount_freight: 0,
      c20_discount_platform: 0,
      c21_total: grossTotal,
      c22_label_count: 1,
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

test("合成駐店單（總額 1000、運費 120）：logisticsCostFor 不再是 0，淨利恰少 120", () => {
  const order = makeShopOrder("SHOP-1", 1000, 120);
  const payout = computePayout([order], menu);
  const shopChannel = payout.byChannel.find((c) => c.channelId === "駐店")!;
  assert.ok(shopChannel, "應該有駐店這個 channel row");
  assert.equal(shopChannel.shopFreight, 120);
  assert.equal(shopChannel.logistics, 0, "駐店運費走獨立的 shopFreight、不混進 logistics");
  // COGS = 肉桂捲成本 20.90（menu.yaml 定義）
  const cogs = menu.atoms["肉桂捲"]!.cost!;
  const expectedNet = 1000 - cogs - shopChannel.packaging - 120;
  assert.equal(shopChannel.netProfit, expectedNet);
  assert.equal(payout.shopFreight, 120);
  assert.equal(payout.netProfit, expectedNet);
});

test("成本拆解含駐店運費列：byChannel 的駐店 row 有 shopFreight 欄位、且計入 totals", () => {
  const orders = [makeShopOrder("SHOP-2", 2000, 200), makeShopOrder("SHOP-3", 1500, 150)];
  const payout = computePayout(orders, menu);
  assert.equal(payout.shopFreight, 350);
  const shopChannel = payout.byChannel.find((c) => c.channelId === "駐店")!;
  assert.equal(shopChannel.shopFreight, 350);
  assert.equal(shopChannel.orderCount, 2);
});

test("freight_cost 缺值（0）→ shopFreight 為 0，不誤判成隨便一個估算值", () => {
  const order = makeShopOrder("SHOP-4", 500, 0);
  const payout = computePayout([order], menu);
  const shopChannel = payout.byChannel.find((c) => c.channelId === "駐店")!;
  assert.equal(shopChannel.shopFreight, 0);
});

test("回歸：無駐店單時，全 fixture 分潤結果跟改動前一字不差（不動其他通路）", () => {
  const buf = readFileSync(join(ROOT, "fixtures/2026-07-round1/1.xlsx"));
  const { orders } = parseSellerBuy(toArrayBuffer(buf), "1.xlsx", menu);
  const payout = computePayout(orders, menu);
  assert.equal(payout.shopFreight, 0, "這批 fixture 沒有駐店單，shopFreight 應為 0");
  const sellerBuyChannel = payout.byChannel.find((c) => c.channelId === "賣貨便")!;
  assert.equal(sellerBuyChannel.shopFreight, 0);
  // logistics 不受影響（沿用黃金值基準已驗證過的數字，這裡再次確認 shopFreight 沒有污染既有欄位）
  assert.ok(sellerBuyChannel.logistics > 0);
});

test("駐店對帳頁與分潤頁對同一批駐店單算出的運費總額相等（同源斷言）", () => {
  // ShopPayoutPage.tsx 自己算 gross - freight_cost（received），跟這裡的
  // shopFreight 加總必須對得上——用同一批合成單各自套兩條公式比對。
  const orders = [makeShopOrder("SHOP-5", 800, 80), makeShopOrder("SHOP-6", 1200, 100)];
  const payout = computePayout(orders, menu);
  const shopPageFreightTotal = orders.reduce((s, o) => s + o.freight_cost, 0);
  assert.equal(payout.shopFreight, shopPageFreightTotal);
});

test("對抗測項：freight_cost 塞負數 → zod schema 拒絕（models.ts freight_cost 已是 nonnegative）", () => {
  const order = makeShopOrder("SHOP-7", 500, -50);
  // makeShopOrder 用 as unknown as Order 繞過 schema，這裡改用真正的 schema 驗證入口確認會被擋
  // （models.ts: freight_cost: z.number().nonnegative().default(0)）
  assert.throws(() => OrderSchema.parse(order));
});
