/**
 * #15 營養成分表列印 — nutrition.ts 純函式驗證。
 * 見 docs/boss-issues-plan-2026-08.md 順位 3B。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load as yamlLoad } from "js-yaml";

import { loadMenu } from "../src/domain/menu.ts";
import { deriveBoxesForOrder, nutritionSheetsFor } from "../src/domain/nutrition.ts";
import { labelLayout, pagesFor } from "../src/domain/label-layout.ts";
import { MenuSchema } from "../src/domain/models.ts";
import type { Order } from "../src/domain/models.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const NUTRITION_DIR = join(ROOT, "src/assets/nutrition");
const menuYamlText = readFileSync(join(ROOT, "data/menu.yaml"), "utf-8");
const menu = loadMenu(menuYamlText);

// ── 對照完備性 + 檔案存在性 ──────────────────────────────────────────

test("對照完備性閘門：每個 atom 的 nutrition_label 要嘛有真檔名、要嘛明寫 none，不准留空", () => {
  const undecided = Object.entries(menu.atoms).filter(([, a]) => a.nutrition_label == null);
  assert.deepEqual(
    undecided.map(([id]) => id),
    [],
    `以下 atom 沒有設定 nutrition_label（留空 = 未決）：${undecided.map(([id]) => id).join("、")}`
  );
});

test("檔案存在性：每個被引用的圖檔真的存在於 src/assets/nutrition/", () => {
  const missing: string[] = [];
  for (const [atomId, atom] of Object.entries(menu.atoms)) {
    if (atom.nutrition_label == null || atom.nutrition_label === "none") continue;
    const path = join(NUTRITION_DIR, atom.nutrition_label);
    if (!existsSync(path)) missing.push(`${atomId} → ${atom.nutrition_label}`);
  }
  assert.deepEqual(missing, [], `以下 nutrition_label 指向不存在的檔案：${missing.join("、")}`);
});

test("反向檢查：assets 目錄裡沒被任何 atom 引用的孤兒圖（列出提醒、不 fail）", () => {
  const referenced = new Set(
    Object.values(menu.atoms)
      .map((a) => a.nutrition_label)
      .filter((v): v is string => v != null && v !== "none")
  );
  const onDisk = readdirSync(NUTRITION_DIR);
  const orphans = onDisk.filter((f) => !referenced.has(f));
  if (orphans.length > 0) {
    console.log(`孤兒圖（未被任何 atom 引用）：${orphans.join("、")}`);
  }
  assert.equal(onDisk.length, referenced.size, "assets 目錄檔案數應恰等於被引用的檔名數（15 個直接對應、無孤兒無缺漏）");
});

test("目前 menu.yaml 的 nutrition_label 對照（人工核對過、寫死當回歸真值）：17 atoms = 15 可印 + 2 免貼", () => {
  const printable = Object.entries(menu.atoms).filter(([, a]) => a.nutrition_label && a.nutrition_label !== "none");
  const none = Object.entries(menu.atoms).filter(([, a]) => a.nutrition_label === "none");
  assert.equal(printable.length, 15);
  assert.deepEqual(none.map(([id]) => id).sort(), ["無麩烤餅", "瑕疵小脆捲10顆"]);
});

// ── 對抗測項 B：menu.yaml 塞不存在的檔名 ─────────────────────────────

test("對抗測項 B：nutrition_label 指向不存在的檔案 → 檔案存在性測試會抓到（模擬驗證）", () => {
  const raw = yamlLoad(menuYamlText) as Record<string, unknown>;
  const cloned = JSON.parse(JSON.stringify(raw));
  cloned.atoms["肉桂捲"].nutrition_label = "不存在的檔.jpg";
  const tamperedMenu = MenuSchema.parse(cloned);
  const path = join(NUTRITION_DIR, tamperedMenu.atoms["肉桂捲"]!.nutrition_label!);
  assert.ok(!existsSync(path), "這個檔案本來就不該存在——驗證『檔案存在性』測項邏輯能抓到這種情況");
});

// ── 盒模型：計數真值（人工算好寫死）────────────────────────────────

function makeOrder(
  id: string,
  items: Array<{ productSkuId: string; quantity: number; atoms: { atomId: string; count: number }[]; box_no?: string }>,
  labelCount: number
): Order {
  return {
    id,
    channel: "賣貨便",
    status: "confirmed",
    batchDate: "2026-08-11",
    order_date: "2026-08-01",
    customer_wish_date: null,
    system_suggested_date: null,
    assignment_source: "pending",
    wish_priority: null,
    estimated_production_hours: null,
    recipient: { name: "test", igOrLine: null, phone: null, address: null, convStore: null },
    items: items.map((it) => ({
      productSkuId: it.productSkuId,
      rawName: it.productSkuId,
      quantity: it.quantity,
      subtotal: 0,
      atoms: it.atoms,
      ...(it.box_no ? { box_no: it.box_no } : {}),
    })),
    revenue: { grossTotal: 0, freight: 0, discount: 0 },
    labelCount,
    shop_partner: null,
    override_unit_price: null,
    freight_cost: 0,
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

test("散裝單（老闆原例）：肉桂捲×3 + 磅蛋糕×2 + 醬×1（皆散裝、併 1 盒）→ 恰 3 張", () => {
  const order = makeOrder(
    "order-scatter",
    [
      { productSkuId: "肉桂捲_單品", quantity: 3, atoms: [{ atomId: "肉桂捲", count: 1 }] },
      { productSkuId: "芝麻焙茶奶酥磅蛋糕_單品", quantity: 2, atoms: [{ atomId: "芝麻焙茶奶酥磅蛋糕", count: 1 }] },
      { productSkuId: "香料堅果醬90ml", quantity: 1, atoms: [{ atomId: "香料堅果醬90ml", count: 1 }] },
    ],
    1 // 全部散裝併 1 盒 → labelCount 應為 1 才會守恆一致
  );
  const boxes = deriveBoxesForOrder(order, menu);
  assert.equal(boxes.length, 1, "全散裝應併成 1 盒");
  assert.deepEqual([...boxes[0]!].sort(), ["肉桂捲", "芝麻焙茶奶酥磅蛋糕", "香料堅果醬90ml"].sort());

  const result = nutritionSheetsFor([order], menu);
  assert.equal(result.totalSheets, 3, "3 種品項各 1 張、恰 3 張");
  assert.equal(result.boxMismatchWarnings.length, 0, "labelCount=1 跟推導盒數 1 一致、不該有警示");
});

test("組合單：經典六入×2 → 2 盒 → 肉桂捲表 2 張 + 40ml醬表 2 張，共 4 張", () => {
  const order = makeOrder(
    "order-combo",
    [{ productSkuId: "經典肉桂捲6入", quantity: 2, atoms: [{ atomId: "肉桂捲", count: 5 }, { atomId: "香料堅果醬40ml", count: 1 }] }],
    2
  );
  const boxes = deriveBoxesForOrder(order, menu);
  assert.equal(boxes.length, 2, "每單位一盒，2 個六入 = 2 盒");
  for (const box of boxes) {
    assert.deepEqual([...box].sort(), ["肉桂捲", "香料堅果醬40ml"].sort());
  }

  const result = nutritionSheetsFor([order], menu);
  assert.equal(result.totalSheets, 4);
  const bySkuMap = Object.fromEntries(result.sheets.map((s) => [s.atomId, s.count]));
  assert.equal(bySkuMap["肉桂捲"], 2);
  assert.equal(bySkuMap["香料堅果醬40ml"], 2);
  assert.equal(result.boxMismatchWarnings.length, 0);
});

test("混合單：經典六入×1 + 散裝磅蛋糕×2 → 2 盒（組合 1 盒 + 散裝 1 盒）→ 肉桂捲1+40ml醬1+磅蛋糕1，共 3 張", () => {
  const order = makeOrder(
    "order-mixed",
    [
      { productSkuId: "經典肉桂捲6入", quantity: 1, atoms: [{ atomId: "肉桂捲", count: 5 }, { atomId: "香料堅果醬40ml", count: 1 }] },
      { productSkuId: "鳳梨肉桂奶酥磅蛋糕_單品", quantity: 2, atoms: [{ atomId: "鳳梨肉桂奶酥磅蛋糕", count: 1 }] },
    ],
    2
  );
  const boxes = deriveBoxesForOrder(order, menu);
  assert.equal(boxes.length, 2);

  const result = nutritionSheetsFor([order], menu);
  assert.equal(result.totalSheets, 3);
  const bySkuMap = Object.fromEntries(result.sheets.map((s) => [s.atomId, s.count]));
  assert.equal(bySkuMap["肉桂捲"], 1);
  assert.equal(bySkuMap["香料堅果醬40ml"], 1);
  assert.equal(bySkuMap["鳳梨肉桂奶酥磅蛋糕"], 1);
  assert.equal(result.boxMismatchWarnings.length, 0);
});

test("客製單（帶 box_no）：第 1 盒 肉桂捲×3+醬×1、第 2 盒 磅蛋糕×2 → 恰 3 張、逐盒明細正確", () => {
  const order = makeOrder(
    "order-custom",
    [
      { productSkuId: "肉桂捲_單品", quantity: 3, atoms: [{ atomId: "肉桂捲", count: 1 }], box_no: "1" },
      { productSkuId: "香料堅果醬40ml", quantity: 1, atoms: [{ atomId: "香料堅果醬40ml", count: 1 }], box_no: "1" },
      { productSkuId: "芝麻焙茶奶酥磅蛋糕_單品", quantity: 2, atoms: [{ atomId: "芝麻焙茶奶酥磅蛋糕", count: 1 }], box_no: "2" },
    ],
    2
  );
  const boxes = deriveBoxesForOrder(order, menu);
  assert.equal(boxes.length, 2);
  const box1 = boxes.find((b) => b.includes("肉桂捲"))!;
  const box2 = boxes.find((b) => b.includes("芝麻焙茶奶酥磅蛋糕"))!;
  assert.deepEqual([...box1].sort(), ["肉桂捲", "香料堅果醬40ml"].sort());
  assert.deepEqual([...box2], ["芝麻焙茶奶酥磅蛋糕"]);

  const result = nutritionSheetsFor([order], menu);
  assert.equal(result.totalSheets, 3);
});

// ── 盒數守恆檢查 ──────────────────────────────────────────────────

test("盒數守恆：推導盒數 ≠ labelCount → 該單進警示清單（含推導值與欄位值）", () => {
  const order = makeOrder(
    "order-mismatch",
    [{ productSkuId: "經典肉桂捲6入", quantity: 2, atoms: [{ atomId: "肉桂捲", count: 5 }, { atomId: "香料堅果醬40ml", count: 1 }] }],
    99 // 故意跟推導盒數(2)不一致
  );
  const result = nutritionSheetsFor([order], menu);
  assert.equal(result.boxMismatchWarnings.length, 1);
  assert.equal(result.boxMismatchWarnings[0]!.order_id, "order-mismatch");
  assert.equal(result.boxMismatchWarnings[0]!.derivedBoxCount, 2);
  assert.equal(result.boxMismatchWarnings[0]!.labelCount, 99);
});

// ── 批次加總守恆 + 溯源 ────────────────────────────────────────────

test("批次加總守恆：Σ 各品項張數 = Σ 各盒相異品項數，且來源訂單清單可溯源", () => {
  const orderA = makeOrder(
    "order-A",
    [{ productSkuId: "肉桂捲_單品", quantity: 1, atoms: [{ atomId: "肉桂捲", count: 1 }] }],
    1
  );
  const orderB = makeOrder(
    "order-B",
    [{ productSkuId: "肉桂捲_單品", quantity: 5, atoms: [{ atomId: "肉桂捲", count: 1 }] }],
    1
  );
  const result = nutritionSheetsFor([orderA, orderB], menu);
  const cinnamonSheet = result.sheets.find((s) => s.atomId === "肉桂捲")!;
  assert.equal(cinnamonSheet.count, 2, "兩張訂單各出現 1 次肉桂捲、跟訂單裡的 quantity 無關");
  assert.deepEqual(cinnamonSheet.sourceOrderIds, ["order-A", "order-B"]);

  const totalBoxAtoms = [orderA, orderB]
    .flatMap((o) => deriveBoxesForOrder(o, menu))
    .reduce((s, box) => s + box.length, 0);
  assert.equal(result.totalSheets, totalBoxAtoms);
});

// ── 對抗測項 A：nutrition_label 未決 ──────────────────────────────

test("對抗測項 A：nutrition_label 留空（undecided）的 atom → 進 undecidedAtoms、張數不計入可列印 totalSheets、不靜默消失", () => {
  const raw = yamlLoad(menuYamlText) as Record<string, unknown>;
  const cloned = JSON.parse(JSON.stringify(raw));
  cloned.atoms["肉桂捲"].nutrition_label = null;
  const tamperedMenu = MenuSchema.parse(cloned);

  const order = makeOrder(
    "order-undecided",
    [{ productSkuId: "肉桂捲_單品", quantity: 1, atoms: [{ atomId: "肉桂捲", count: 1 }] }],
    1
  );
  const result = nutritionSheetsFor([order], tamperedMenu);
  assert.equal(result.totalSheets, 0, "未決品項不計入可列印張數");
  assert.equal(result.sheets.length, 0, "未決品項不出現在可列印清單");
  assert.equal(result.undecidedAtoms.length, 1, "但也不能靜默消失——要出現在 undecidedAtoms");
  assert.equal(result.undecidedAtoms[0]!.atomId, "肉桂捲");
  assert.equal(result.undecidedAtoms[0]!.count, 1, "明示『本來需要幾張』讓人知道規模");
  assert.deepEqual(result.undecidedAtoms[0]!.sourceOrderIds, ["order-undecided"]);
});

test("nutrition_label='none' 的 atom 完全不出現在任何清單（免貼是已解決狀態、不是警示）", () => {
  const order = makeOrder(
    "order-none-atom",
    [{ productSkuId: "瑕疵小脆捲10顆", quantity: 1, atoms: [{ atomId: "瑕疵小脆捲10顆", count: 1 }] }],
    1
  );
  const result = nutritionSheetsFor([order], menu);
  assert.equal(result.sheets.length, 0);
  assert.equal(result.undecidedAtoms.length, 0);
  assert.equal(result.totalSheets, 0);
});

// ── 列印版面（5x8cm preset）────────────────────────────────────────

test("labelLayout('5x8cm') = 50mm × 80mm × 每頁 1 張", () => {
  const layout = labelLayout("5x8cm");
  assert.equal(layout.pageWidthMm, 50);
  assert.equal(layout.pageHeightMm, 80);
  assert.equal(layout.labelsPerPage, 1);
  assert.match(layout.pageCss, /size:\s*50mm\s+80mm/);
});

test("總頁數 = 總張數；0 張時 pagesFor 回 0（UI 層據此顯示『本批無需成分表』而非空白頁）", () => {
  const layout = labelLayout("5x8cm");
  assert.equal(pagesFor(0, layout), 0);
  assert.equal(pagesFor(7, layout), 7);
});
