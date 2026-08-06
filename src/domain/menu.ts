/**
 * Menu loader + lookup
 * 對應 docs/spec.md §3 Stage 2
 *
 * lookupSku 演算法：
 *   1. 先跟 aliases[] 做 exact 字串 match（100% 命中最快最準）
 *   2. 若無命中，跟 match_signature 做「中文字 include/exclude」判定
 *   3. 找不到 → 回 null（進 pending_product）
 */
import { load as yamlLoad } from "js-yaml";
import { MenuSchema, PRODUCT_GROUP_ORDER, type Menu, type Product } from "./models";

/** 從 raw yaml text 載入並驗證 menu。 */
export function loadMenu(yamlText: string): Menu {
  const raw = yamlLoad(yamlText);
  return MenuSchema.parse(raw);
}

/**
 * 依 raw name（例如賣貨便 c12 字串）查 SKU id。
 *
 * @returns SKU id 或 null
 */
export function lookupSku(rawName: string, menu: Menu): string | null {
  const trimmed = rawName.trim();

  // Step 1: aliases exact match
  for (const [skuId, product] of Object.entries(menu.products)) {
    if (product.aliases.includes(trimmed)) {
      return skuId;
    }
    // display_name 也算 alias
    if (product.display_name === trimmed) {
      return skuId;
    }
  }

  // Step 2: match_signature (include all, exclude none)
  const candidates: Array<{ skuId: string; product: Product; score: number }> = [];
  for (const [skuId, product] of Object.entries(menu.products)) {
    const sig = product.match_signature;
    if (sig.include.length === 0) continue; // 沒設 signature 的 skip

    const allInclude = sig.include.every((kw) => trimmed.includes(kw));
    const anyExclude = sig.exclude.some((kw) => trimmed.includes(kw));

    if (allInclude && !anyExclude) {
      // score = include 關鍵字的總長度（越具體越優先）
      const score = sig.include.reduce((s, kw) => s + kw.length, 0);
      candidates.push({ skuId, product, score });
    }
  }

  if (candidates.length === 0) return null;
  // 選最具體的（score 最大）
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]!.skuId;
}

/** 拆解 SKU 為 atoms（給 Stage 2 output 用）。 */
export function explodeToAtoms(
  skuId: string,
  menu: Menu
): Array<{ atomId: string; count: number }> {
  const product = menu.products[skuId];
  if (!product) return [];
  return product.contains.map((c) => ({ atomId: c.atom, count: c.count }));
}

/** 取 SKU 顯示名。 */
export function getDisplayName(skuId: string, menu: Menu): string {
  return menu.products[skuId]?.display_name ?? skuId;
}

export type ProductGroupBucket = {
  group: string;
  items: Array<{ skuId: string; product: Product }>;
};

/**
 * #3 手打單品項分類：把 menu.products 依 product.group 分組、組內依
 * display_name 排序。傳 allowedSkuIds 可限定子集（駐店模式只顯示該店供貨
 * 品項）——限定後每個 SKU 仍照它在 menu.yaml 裡的 group 歸類，不會因為
 * 子集而改變分類，也不會漏掉或多出任何一個允許的 SKU。
 */
export function groupProducts(
  menu: Menu,
  allowedSkuIds?: string[]
): ProductGroupBucket[] {
  const allowed = allowedSkuIds ? new Set(allowedSkuIds) : null;
  const buckets = new Map<string, Array<{ skuId: string; product: Product }>>();
  for (const [skuId, product] of Object.entries(menu.products)) {
    if (allowed && !allowed.has(skuId)) continue;
    const g = product.group;
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push({ skuId, product });
  }
  for (const items of buckets.values()) {
    items.sort((a, b) => a.product.display_name.localeCompare(b.product.display_name));
  }
  const ordered: ProductGroupBucket[] = [];
  for (const g of PRODUCT_GROUP_ORDER) {
    const items = buckets.get(g);
    if (items) ordered.push({ group: g, items });
  }
  return ordered;
}
