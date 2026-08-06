/**
 * #3 手打單品項分類 — groupProducts 純函式驗證。
 * 見 docs/boss-issues-plan-2026-08.md 順位 2。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load as yamlLoad } from "js-yaml";

import { loadMenu, groupProducts } from "../src/domain/menu.ts";
import { MenuSchema, PRODUCT_GROUP_ORDER } from "../src/domain/models.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const menuYamlText = readFileSync(join(ROOT, "data/menu.yaml"), "utf-8");
const menu = loadMenu(menuYamlText);

test("分組後所有組的 SKU 數總和 = menu.products 總數，無重複、無漏掉", () => {
  const groups = groupProducts(menu);
  const totalSkuCount = Object.keys(menu.products).length;
  const seen = new Set<string>();
  let sum = 0;
  for (const g of groups) {
    for (const { skuId } of g.items) {
      assert.ok(!seen.has(skuId), `SKU ${skuId} 出現超過一次`);
      seen.add(skuId);
      sum += 1;
    }
  }
  assert.equal(sum, totalSkuCount, "分組後總數與 menu.products 總數不符");
  assert.equal(seen.size, totalSkuCount);
});

test("每個 SKU 的 group 值都在允許清單內", () => {
  for (const [skuId, product] of Object.entries(menu.products)) {
    assert.ok(
      (PRODUCT_GROUP_ORDER as readonly string[]).includes(product.group),
      `SKU ${skuId} 的 group「${product.group}」不在允許清單內`
    );
  }
});

test("沒填 group 的 SKU 落「其他」組（印出名單提醒，不 fail）", () => {
  // 目前 menu.yaml 26 個 SKU 全部已手動分類，這裡驗證「落其他」的機制本身：
  // 用一份合成 menu（一個 SKU 不填 group）驗證 default 行為。
  const raw = yamlLoad(menuYamlText) as Record<string, unknown>;
  const products = raw.products as Record<string, Record<string, unknown>>;
  const sampleId = Object.keys(products)[0]!;
  const cloned = JSON.parse(JSON.stringify(raw));
  delete cloned.products[sampleId].group;
  const parsed = MenuSchema.parse(cloned);
  assert.equal(parsed.products[sampleId]!.group, "其他");

  const noGroupSkus = Object.entries(menu.products)
    .filter(([, p]) => p.group === "其他")
    .map(([id]) => id);
  console.log(`目前落在「其他」組的 SKU（${noGroupSkus.length} 個）：${noGroupSkus.join("、")}`);
});

test("駐店模式：傳 allowedSkuIds 子集 → 分組結果恰為該子集、不外漏其他 SKU", () => {
  const allSkuIds = Object.keys(menu.products);
  const subset = [allSkuIds[0]!, allSkuIds[5]!, allSkuIds[10]!];
  const groups = groupProducts(menu, subset);
  const flat = groups.flatMap((g) => g.items.map((it) => it.skuId));
  assert.deepEqual(new Set(flat), new Set(subset));
  assert.equal(flat.length, subset.length);
});

test("駐店模式：空子集回傳空分組（不是全部 SKU）", () => {
  const groups = groupProducts(menu, []);
  assert.equal(groups.length, 0);
});

test("駐店模式：子集內每個 SKU 仍照 menu.yaml 定義的 group 歸類，不因子集而改變", () => {
  const comboSkuId = Object.entries(menu.products).find(
    ([, p]) => p.group === "禮盒組"
  )![0];
  const singleSkuId = Object.entries(menu.products).find(
    ([, p]) => p.group === "巴斯克"
  )![0];
  const groups = groupProducts(menu, [comboSkuId, singleSkuId]);
  const comboGroup = groups.find((g) => g.items.some((it) => it.skuId === comboSkuId));
  const singleGroup = groups.find((g) => g.items.some((it) => it.skuId === singleSkuId));
  assert.equal(comboGroup?.group, "禮盒組");
  assert.equal(singleGroup?.group, "巴斯克");
});

test("組內依 display_name 排序（用 localeCompare，非插入順序）", () => {
  const groups = groupProducts(menu);
  for (const g of groups) {
    const names = g.items.map((it) => it.product.display_name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(names, sorted, `${g.group} 組內未依 display_name 排序`);
  }
});

test("對抗測項：menu.yaml 塞一個 group: 亂寫 的 SKU → zod 驗證拒載", () => {
  const raw = yamlLoad(menuYamlText) as Record<string, unknown>;
  const products = raw.products as Record<string, Record<string, unknown>>;
  const sampleId = Object.keys(products)[0]!;
  const cloned = JSON.parse(JSON.stringify(raw));
  cloned.products[sampleId].group = "亂寫的分類";
  assert.throws(() => MenuSchema.parse(cloned));
});

test("目前 menu.yaml 實際分組結果（人工核對過一次、寫死當回歸真值）", () => {
  const groups = groupProducts(menu);
  const summary = Object.fromEntries(groups.map((g) => [g.group, g.items.length]));
  assert.deepEqual(summary, {
    肉桂捲: 2,
    磅蛋糕: 2,
    巴斯克: 7,
    堅果醬: 2,
    禮盒組: 11,
    其他: 2,
  });
});
