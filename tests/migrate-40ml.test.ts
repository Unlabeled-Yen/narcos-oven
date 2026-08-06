/**
 * #13 六入附醬 40ml — 歷史訂單遷移純函式驗證（真程式碼、非複製版）。
 * 用合成備份資料（非真實客戶資料），見 docs/boss-issues-plan-2026-08.md 順位 1。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planMigration,
  applyMigration,
  verifyConservation,
} from "../src/domain/migrate-40ml.ts";
import type { Order } from "../src/domain/models.ts";

// 測試只需要 planMigration/applyMigration/verifyConservation 實際讀寫的欄位
// （id、items[].productSkuId/atoms）；其餘 Order 欄位對這三個函式無意義，
// 用 as unknown as Order 收斂，行為由 src/domain/migrate-40ml.ts 的真型別把關。
function comboOrder(id: string, atoms: { atomId: string; count: number }[]): Order {
  return {
    id,
    items: [
      {
        productSkuId: "經典肉桂捲6入",
        rawName: "經典肉桂捲6入",
        quantity: 1,
        subtotal: 600,
        atoms,
      },
    ],
  } as unknown as Order;
}

function singleOrder90(id: string): Order {
  return {
    id,
    items: [
      {
        productSkuId: "香料堅果醬90ml",
        rawName: "香料堅果醬90ml",
        quantity: 1,
        subtotal: 200,
        atoms: [{ atomId: "香料堅果醬90ml", count: 1 }],
      },
    ],
  } as unknown as Order;
}

test("plan：只挑出六入組合底下的 90ml atoms 項", () => {
  const orders = [
    comboOrder("A", [
      { atomId: "肉桂捲", count: 5 },
      { atomId: "香料堅果醬90ml", count: 1 },
    ]),
    singleOrder90("B"),
  ];
  const changes = planMigration(orders);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].order_id, "A");
  assert.equal(changes[0].count, 1);
});

test("apply + 守恆檢查：訂單數不變、atoms 總顆數不變、單買 90ml 完全不動", () => {
  const before = [
    comboOrder("A", [
      { atomId: "肉桂捲", count: 5 },
      { atomId: "香料堅果醬90ml", count: 1 },
    ]),
    singleOrder90("B"),
  ];
  const changes = planMigration(before);
  const after = applyMigration(before, changes);

  assert.doesNotThrow(() => verifyConservation(before, after));

  assert.equal(after[0].items[0].atoms[1].atomId, "香料堅果醬40ml");
  assert.equal(after[0].items[0].atoms[1].count, 1);
  assert.equal(after[0].items[0].atoms[0].atomId, "肉桂捲");

  // 對抗測項：訂單 B（單買 90ml）逐位元組不動
  assert.deepEqual(after[1], before[1]);
});

test("對抗測項：單買 90ml 訂單不在遷移範圍內（plan 回傳 0 筆）", () => {
  const orders = [singleOrder90("only-single")];
  const changes = planMigration(orders);
  assert.equal(changes.length, 0);
});

test("對抗測項：資料在規劃後被動過 → apply 拒絕套用而非靜默改錯位置", () => {
  const before = [
    comboOrder("A", [
      { atomId: "肉桂捲", count: 5 },
      { atomId: "香料堅果醬90ml", count: 1 },
    ]),
  ];
  const changes = planMigration(before);
  // 模擬「規劃後、套用前」資料被改動：atom 已經不是預期的 90ml
  const tampered = JSON.parse(JSON.stringify(before));
  tampered[0].items[0].atoms[1].atomId = "香料堅果醬40ml";
  assert.throws(() => applyMigration(tampered, changes), /資料可能在規劃後又變動過/);
});

test("守恆檢查會抓到範圍外洩：非目標訂單被改動要噴錯", () => {
  const before = [singleOrder90("B")];
  const after = JSON.parse(JSON.stringify(before));
  after[0].items[0].atoms[0].atomId = "香料堅果醬40ml"; // 不該被改
  assert.throws(() => verifyConservation(before, after), /遷移範圍外洩/);
});

test("守恆檢查會抓到 atoms 總顆數漂移", () => {
  const before = [
    comboOrder("A", [
      { atomId: "肉桂捲", count: 5 },
      { atomId: "香料堅果醬90ml", count: 1 },
    ]),
  ];
  const after = JSON.parse(JSON.stringify(before));
  after[0].items[0].atoms[1].count = 2; // 不該變
  assert.throws(() => verifyConservation(before, after), /atoms 總顆數變了/);
});
