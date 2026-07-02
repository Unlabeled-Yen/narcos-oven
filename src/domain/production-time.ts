/**
 * M6.5 產能時間預算計算（純函式、可 Node 測）
 * 對應 scheduling-spec-v2.md §2 時間公式 + overhead 規則
 *
 * 核心概念：
 *   - 每個 atom 有時間公式（1 爐/2 爐/3 爐時間 + 4 爐+ 遞增斜率）
 *   - 香料堅果醬特別：per_batch_units=1000 ml、要按總 ml 算
 *   - 額外成本：品項切換 (0.67hr)、每 3 爐洗模 (1hr)
 */
import type { Menu, Order, ProductionTimeFormula } from "./models";

/**
 * 計算單個 atom 的爐數 → 總 hr
 */
export function hoursForAtomBatches(
  batches: number,
  formula: ProductionTimeFormula
): number {
  if (batches <= 0) return 0;
  const byCount = formula.hours_by_batch_count;
  // 若在 fixed table 中
  if (byCount[String(batches)] !== undefined) {
    return byCount[String(batches)]!;
  }
  // 超過表定爐數、用最後一格 + (batches - lastKey) × 遞增斜率
  const keys = Object.keys(byCount).map(Number).sort((a, b) => a - b);
  const maxKey = keys[keys.length - 1]!;
  const maxHours = byCount[String(maxKey)]!;
  const extra = batches - maxKey;
  return maxHours + extra * formula.hours_per_additional_batch;
}

/**
 * 計算某 atom 的 quantity → 需要幾爐 + 洗模成本
 */
export function batchesAndHoursForAtom(
  atomId: string,
  quantity: number,
  menu: Menu
): { batches: number; hours: number; washMoldHours: number } {
  const formula = menu.production_time_formula?.[atomId];
  if (!formula || quantity <= 0) return { batches: 0, hours: 0, washMoldHours: 0 };

  let batches: number;
  if (formula.ml_per_unit) {
    // 堅果醬類：按 ml 算
    const totalMl = quantity * formula.ml_per_unit;
    batches = totalMl / formula.per_batch_units; // 可小數
  } else {
    batches = Math.ceil(quantity / formula.per_batch_units);
  }

  const hours = hoursForAtomBatches(Math.ceil(batches), formula);
  const overhead = menu.overhead;
  const washMoldHours = overhead && batches >= overhead.wash_mold_after_batches
    ? Math.floor(batches / overhead.wash_mold_after_batches) * overhead.wash_mold_hours
    : 0;

  return { batches, hours, washMoldHours };
}

/**
 * 給定「這一批的所有 atom 總量」→ 計算總製作時間 hr。
 * 包含：每 atom 時間 + 洗模成本 + 品項切換 overhead。
 */
export function calculateBatchHours(
  atomTotals: Map<string, number>,
  menu: Menu
): number {
  let totalHours = 0;
  let productCount = 0;
  for (const [atomId, qty] of atomTotals) {
    if (qty <= 0) continue;
    const { hours, washMoldHours } = batchesAndHoursForAtom(atomId, qty, menu);
    if (hours > 0) {
      totalHours += hours + washMoldHours;
      productCount++;
    }
  }
  const overhead = menu.overhead;
  if (productCount > 1 && overhead) {
    totalHours += (productCount - 1) * overhead.product_switch_hours;
  }
  return Math.round(totalHours * 100) / 100;
}

/**
 * 給某訂單、估計「若單獨為它排一批要多少 hr」（UI 用）
 */
export function estimateOrderHours(order: Order, menu: Menu): number {
  const atomTotals = new Map<string, number>();
  for (const item of order.items) {
    for (const a of item.atoms) {
      atomTotals.set(a.atomId, (atomTotals.get(a.atomId) ?? 0) + a.count);
    }
  }
  return calculateBatchHours(atomTotals, menu);
}

/**
 * 累積多筆訂單的 atom 總量（供 batch-level 產能檢核用）
 */
export function accumulateAtoms(orders: Order[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const o of orders) {
    for (const item of o.items) {
      for (const a of item.atoms) {
        totals.set(a.atomId, (totals.get(a.atomId) ?? 0) + a.count);
      }
    }
  }
  return totals;
}

/**
 * merge 兩個 atom map（不 mutate）
 */
export function mergeAtomMaps(
  a: Map<string, number>,
  b: Map<string, number>
): Map<string, number> {
  const out = new Map(a);
  for (const [k, v] of b) {
    out.set(k, (out.get(k) ?? 0) + v);
  }
  return out;
}

/**
 * 訂單依 items 決定 wish_priority：任一 item 有巴斯克 → strict
 */
export function deriveOrderWishPriority(
  order: Order,
  menu: Menu
): "strict" | "flexible" | null {
  if (!order.customer_wish_date) return null;
  const wishMap = menu.wish_priority_by_atom ?? {};
  for (const item of order.items) {
    for (const a of item.atoms) {
      if (wishMap[a.atomId] === "strict") return "strict";
    }
  }
  return "flexible";
}
