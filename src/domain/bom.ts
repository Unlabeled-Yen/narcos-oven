/**
 * Stage 10：備料 BOM 計算
 * 對應 docs/spec.md §11.2 + R3-4 (雇主待補 recipe)
 *
 * 純函式：對某個 batch_date 的 orders → 累加 raw_material_recipe → 返回原物料清單
 * v1: recipe 空的時候、回傳 atom 級累積（例如「肉桂捲 120 顆」而不是「麵糰 15 kg」）
 * v2: 雇主填 recipe 後、自動改用 raw_material 級別
 */
import type { Menu, Order } from "./models";

export type BomLine = {
  material: string;               // 原物料名（或 atom 名）
  quantity: number;
  unit: string;
  source: "raw_material" | "atom_fallback"; // 用 recipe 還是 atom 顆數（fallback）
};

export type BomResult = {
  batch_date: string;
  order_count: number;
  lines: BomLine[];
  warnings: string[];             // 例如「以下品項尚未提供 recipe、用 atom 級 fallback」
};

export function calculateBOM(
  batchDate: string,
  orders: Order[],
  menu: Menu
): BomResult {
  const batchOrders = orders.filter(
    (o) =>
      o.batchDate === batchDate &&
      (o.status === "confirmed" || o.status === "kol_shipped")
  );

  // 先累積各 atom 顆數
  const atomTotals = new Map<string, number>();
  for (const o of batchOrders) {
    for (const it of o.items) {
      for (const a of it.atoms) {
        atomTotals.set(a.atomId, (atomTotals.get(a.atomId) ?? 0) + a.count);
      }
    }
  }

  const warnings: string[] = [];
  const lines: BomLine[] = [];

  for (const [atomId, qty] of atomTotals) {
    // 檢查 menu 是否對這 atom 有對應的 raw_material_recipe
    // v1: recipe 存在 product 上（等雇主提供）、目前多為空
    // fallback：直接列 atom 名 + 顆數
    const atomMeta = menu.atoms[atomId];
    if (!atomMeta) continue;
    lines.push({
      material: atomId,
      quantity: qty,
      unit: atomMeta.unit,
      source: "atom_fallback",
    });
  }

  if (lines.every((l) => l.source === "atom_fallback")) {
    warnings.push(
      "⚠️ 尚未提供任何品項的 raw_material_recipe (R3-4 待雇主提供)；v1 用 atom 級顆數 fallback"
    );
  }

  lines.sort((a, b) => b.quantity - a.quantity);

  return {
    batch_date: batchDate,
    order_count: batchOrders.length,
    lines,
    warnings,
  };
}
