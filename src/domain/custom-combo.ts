/**
 * #2 客製化商品（手打單自由組合）— 純函式。
 * 見 docs/boss-issues-plan-2026-08.md 順位 11。
 *
 * 老闆組單的動作本身就是標示每盒內容：UI 結構是「第 N 盒：〔品項×數量列表〕」。
 * 不動 OrderItem schema——一列單品 = 一筆 OrderItem（box_no 標第幾盒），
 * 整單 rawName 標「客製組合」，atoms 自動展開走既有 explodeToAtoms（跟一般
 * 手打單同一套邏輯，NOT 重新發明）。
 */
import type { Menu } from "./models";
import { explodeToAtoms } from "./menu";
import type { ManualOrderInput } from "./manual-order";

export type ComboLine = { skuId: string; quantity: number };
export type ComboBox = { boxNo: string; lines: ComboLine[] };

export type CustomComboValidation = { ok: true } | { ok: false; error: string };

/**
 * 驗證整份客製組合：不存在的 SKU / 數量 ≤0 / 空盒 / 總價非正數，一律拒絕存檔
 * （不得默默存 0 元單或空盒污染營收與排程）。
 */
export function validateCustomCombo(
  boxes: ComboBox[],
  grossTotal: number,
  menu: Menu
): CustomComboValidation {
  if (boxes.length === 0) return { ok: false, error: "至少要有一盒" };
  for (const box of boxes) {
    if (box.lines.length === 0) return { ok: false, error: `第 ${box.boxNo} 盒是空的，請加品項或刪掉這盒` };
    for (const line of box.lines) {
      if (!menu.products[line.skuId]) return { ok: false, error: `找不到品項 SKU：${line.skuId}` };
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
        return { ok: false, error: `「${menu.products[line.skuId]?.display_name ?? line.skuId}」數量必須 > 0` };
      }
    }
  }
  if (!Number.isFinite(grossTotal) || grossTotal <= 0) {
    return { ok: false, error: "總價必須是 > 0 的數字" };
  }
  return { ok: true };
}

/** 組合盒清單 → buildManualOrder 吃的 items 輸入（一列單品 = 一筆 item，帶 box_no）。 */
export function customComboItemsInput(boxes: ComboBox[], menu: Menu): ManualOrderInput["items"] {
  const items: ManualOrderInput["items"] = [];
  for (const box of boxes) {
    for (const line of box.lines) {
      const product = menu.products[line.skuId];
      items.push({
        skuId: line.skuId,
        rawName: product?.display_name ?? line.skuId,
        quantity: line.quantity,
        box_no: box.boxNo,
      });
    }
  }
  return items;
}

/** 成本即時預覽：atoms 成本累加（跟 compute-payout.ts 的 cogsFor 同一套 fallback 規則）。 */
export function estimateCustomComboCost(boxes: ComboBox[], menu: Menu): number {
  let total = 0;
  for (const box of boxes) {
    for (const line of box.lines) {
      const product = menu.products[line.skuId];
      if (!product) continue;
      if (product.cost !== null) {
        total += product.cost * line.quantity;
        continue;
      }
      for (const a of explodeToAtoms(line.skuId, menu)) {
        const atom = menu.atoms[a.atomId];
        if (atom?.cost != null) total += atom.cost * a.count * line.quantity;
      }
    }
  }
  return total;
}
