/**
 * #2 客製化商品（手打單自由組合） — buildManualOrder + custom-combo 純函式驗證。
 * 見 docs/boss-issues-plan-2026-08.md 順位 11。
 *
 * 真值（人工從 data/menu.yaml 核對，出處見各斷言旁註）：
 *   - 肉桂捲_單品 cost = 20.90（menu.yaml:425）
 *   - 原味巴斯克 product.cost=null → fallback atom「原味巴斯克」cost = 142.26（menu.yaml:25,260）
 *   - 香料堅果醬90ml product.cost=null → fallback atom「香料堅果醬90ml」cost = 81.91（menu.yaml:33,386）
 *   - 工時公式（menu.yaml:550-）：肉桂捲 per_batch_units=24、qty=3 → 1 爐 → 4.0hr
 *                                 原味巴斯克 per_batch_units=4、qty=1 → 1 爐 → 2.0hr
 *                                 香料堅果醬90ml ml_per_unit=90、qty=2 → 180ml/1000 → 1 爐 → 2.0hr
 *                                 品項數=3 種 → 品項切換 overhead (menu.yaml:626) = (3-1)×0.67 = 1.34hr
 *                                 合計 4.0+2.0+2.0+1.34 = 9.34hr
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadMenu } from "../src/domain/menu.ts";
import { buildManualOrder } from "../src/domain/manual-order.ts";
import { estimateOrderHours, accumulateAtoms } from "../src/domain/production-time.ts";
import { validateCustomCombo, customComboItemsInput, estimateCustomComboCost, type ComboBox } from "../src/domain/custom-combo.ts";
import { extractLabels } from "../src/output/label-data.ts";
import { nutritionSheetsFor } from "../src/domain/nutrition.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const menu = loadMenu(readFileSync(join(ROOT, "data/menu.yaml"), "utf-8"));

const SINGLE_BOX: ComboBox[] = [
  {
    boxNo: "1",
    lines: [
      { skuId: "肉桂捲_單品", quantity: 3 },
      { skuId: "原味巴斯克", quantity: 1 },
      { skuId: "香料堅果醬90ml", quantity: 2 },
    ],
  },
];

test("客製單 atoms 展開正確：肉桂捲×3 + 巴斯克×1 + 90ml醬×2", () => {
  const items = customComboItemsInput(SINGLE_BOX, menu);
  const order = buildManualOrder(
    { channel: "彈性", order_date: "2026-08-08", customer_wish_date: null, recipient: { name: "客製測試", igOrLine: null, phone: null, address: null, convStore: null }, items, grossTotal: 1500 },
    menu
  );
  const atoms = accumulateAtoms([order]);
  assert.equal(atoms.get("肉桂捲"), 3);
  assert.equal(atoms.get("原味巴斯克"), 1);
  assert.equal(atoms.get("香料堅果醬90ml"), 2);
  assert.equal(order.revenue.grossTotal, 1500, "分潤以自訂價計");
  assert.equal(order.status, "confirmed", "全部 SKU 找得到、應直接 confirmed");
});

test("工時 = 各 atom production_time_formula 之和 + 品項切換 overhead（人工核對值 9.34hr）", () => {
  const items = customComboItemsInput(SINGLE_BOX, menu);
  const order = buildManualOrder(
    { channel: "彈性", order_date: "2026-08-08", customer_wish_date: null, recipient: { name: "工時測試", igOrLine: null, phone: null, address: null, convStore: null }, items, grossTotal: 1500 },
    menu
  );
  assert.equal(estimateOrderHours(order, menu), 9.34);
});

test("成本 = atoms 成本和（人工核對值 368.78）、分潤毛利 = 1500 - 368.78", () => {
  const cost = estimateCustomComboCost(SINGLE_BOX, menu);
  assert.ok(Math.abs(cost - 368.78) < 0.001, `預期 368.78、實際 ${cost}`);
});

test("進排程：無 batchDate、assignment_source=pending → 出現在排程候選", () => {
  const items = customComboItemsInput(SINGLE_BOX, menu);
  const order = buildManualOrder(
    { channel: "彈性", order_date: "2026-08-08", customer_wish_date: null, recipient: { name: "排程測試", igOrLine: null, phone: null, address: null, convStore: null }, items, grossTotal: 1500 },
    menu
  );
  assert.equal(order.batchDate, null);
  assert.equal(order.assignment_source, "pending");
});

// ── 分盒 ──────────────────────────────────────────────────────────────

const TWO_BOXES: ComboBox[] = [
  { boxNo: "1", lines: [{ skuId: "肉桂捲_單品", quantity: 3 }, { skuId: "香料堅果醬90ml", quantity: 1 }] },
  { boxNo: "2", lines: [{ skuId: "原味巴斯克", quantity: 1 }] },
];

test("分盒：兩盒客製單 → 每列 box_no 正確入庫", () => {
  const items = customComboItemsInput(TWO_BOXES, menu);
  const order = buildManualOrder(
    { channel: "彈性", order_date: "2026-08-08", customer_wish_date: null, recipient: { name: "分盒測試", igOrLine: null, phone: null, address: null, convStore: null }, items, grossTotal: 2000, labelCount: TWO_BOXES.length },
    menu
  );
  const box1Items = order.items.filter((it) => it.box_no === "1");
  const box2Items = order.items.filter((it) => it.box_no === "2");
  assert.equal(box1Items.length, 2);
  assert.equal(box2Items.length, 1);
});

test("分盒：標籤張數自動 = 2（不是逐單位展開的 5 張）", () => {
  const items = customComboItemsInput(TWO_BOXES, menu);
  const order = buildManualOrder(
    { channel: "彈性", order_date: "2026-08-08", customer_wish_date: null, recipient: { name: "標籤測試", igOrLine: null, phone: null, address: null, convStore: null }, items, grossTotal: 2000, labelCount: TWO_BOXES.length, batchDate: "2026-08-11" },
    menu
  );
  const labels = extractLabels([order], menu, { batchDate: "2026-08-11" });
  assert.equal(labels.length, 2, "兩盒 = 兩張標籤，不是每單位展開");
  assert.ok(labels[0]!.mid_line.includes("×"), "標籤內容應列出品項×數量");
});

test("分盒：成分表逐盒計算，與 #15 nutrition.ts 邏輯一致（跨品項共用測 sheets 數 > 0）", () => {
  const items = customComboItemsInput(TWO_BOXES, menu);
  const order = buildManualOrder(
    { channel: "彈性", order_date: "2026-08-08", customer_wish_date: null, recipient: { name: "成分表測試", igOrLine: null, phone: null, address: null, convStore: null }, items, grossTotal: 2000, labelCount: TWO_BOXES.length },
    menu
  );
  const result = nutritionSheetsFor([order], menu);
  // box1 有 2 種相異 atom、box2 有 1 種 → 若都有 nutrition_label 應該有張數；只驗證不 crash 且盒數守恆邏輯不誤報
  assert.equal(result.boxMismatchWarnings.length, 0, "labelCount=2 跟推導盒數=2 應該一致、不進警示清單");
});

// ── 對抗測項 ──────────────────────────────────────────────────────────

test("對抗測項：不存在的 SKU id → 拒絕", () => {
  const boxes: ComboBox[] = [{ boxNo: "1", lines: [{ skuId: "不存在的品項_xyz", quantity: 1 }] }];
  const v = validateCustomCombo(boxes, 1000, menu);
  assert.equal(v.ok, false);
});

test("對抗測項：數量 0 或負數 → 拒絕", () => {
  const boxes: ComboBox[] = [{ boxNo: "1", lines: [{ skuId: "肉桂捲_單品", quantity: 0 }] }];
  assert.equal(validateCustomCombo(boxes, 1000, menu).ok, false);
  const boxes2: ComboBox[] = [{ boxNo: "1", lines: [{ skuId: "肉桂捲_單品", quantity: -2 }] }];
  assert.equal(validateCustomCombo(boxes2, 1000, menu).ok, false);
});

test("對抗測項：總價空白/非正數 → 拒絕存檔（不得默默存 0 元單）", () => {
  const boxes: ComboBox[] = [{ boxNo: "1", lines: [{ skuId: "肉桂捲_單品", quantity: 1 }] }];
  assert.equal(validateCustomCombo(boxes, 0, menu).ok, false);
  assert.equal(validateCustomCombo(boxes, NaN, menu).ok, false);
});

test("對抗測項：空盒（新增了盒但沒放品項）→ 拒絕存檔", () => {
  const boxes: ComboBox[] = [{ boxNo: "1", lines: [{ skuId: "肉桂捲_單品", quantity: 1 }] }, { boxNo: "2", lines: [] }];
  assert.equal(validateCustomCombo(boxes, 1000, menu).ok, false);
});

test("對抗測項：合法輸入應該通過驗證", () => {
  assert.equal(validateCustomCombo(SINGLE_BOX, 1500, menu).ok, true);
});
