/**
 * Stage 11：製作時程回推 (M6.5 修正版)
 *
 * 對某個 batch_date、依 items 中每個 atom 的 lead_time_days
 * 產生「哪天要開始做什麼」的行事曆。
 *
 * 邏輯升級（M6.5、Yen 反映）：
 *   - lead_time_days = 0 **不是「現貨」**、是「當天可製作、不需提前」
 *   - 用 production_time_formula 判斷是否真的是副產品（時間 = 0）
 *   - 副產品 (例：瑕疵小脆捲) 才是「無需製作」
 *   - 香料堅果醬 lead=0 但仍需 2 hr 製作、應顯示「當日製作」+ 估計時間
 */
import type { Menu, Order } from "./models";
import { batchesAndHoursForAtom } from "./production-time";

export type ProductionStep = {
  date: string;
  action: string;
  atomId: string;
  quantity: number;
  estimated_hours?: number;
};

export type ProductionTimeline = {
  batch_date: string;
  steps: ProductionStep[];
};

export function productionTimeline(
  batchDate: string,
  orders: Order[],
  menu: Menu
): ProductionTimeline {
  const leadTimes = menu.product_lead_time ?? {};
  const timeFormula = menu.production_time_formula ?? {};

  const atomTotals = new Map<string, number>();
  for (const o of orders) {
    if (o.batchDate !== batchDate) continue;
    if (o.status !== "confirmed" && o.status !== "kol_shipped") continue;
    for (const it of o.items) {
      for (const a of it.atoms) {
        atomTotals.set(a.atomId, (atomTotals.get(a.atomId) ?? 0) + a.count);
      }
    }
  }

  const batch = new Date(batchDate + "T00:00:00");
  const steps: ProductionStep[] = [];

  for (const [atomId, qty] of atomTotals) {
    const formula = timeFormula[atomId];
    // 用 production_time_formula 精確計算該 atom 需要的時間
    const { hours: productionHours } = formula
      ? batchesAndHoursForAtom(atomId, qty, menu)
      : { hours: 0 };

    // 判斷是否為副產品（時間公式為 0、例：瑕疵小脆捲）
    const isBySideProduct = formula
      ? Object.values(formula.hours_by_batch_count).every((h) => h === 0)
      : false;

    if (isBySideProduct) {
      // 副產品、只顯示出貨、無需製作
      steps.push({
        date: batchDate,
        action: `出貨 ${atomId}（副產品、無需獨立製作）`,
        atomId,
        quantity: qty,
      });
      continue;
    }

    const lead = leadTimes[atomId] ?? 1;
    if (lead === 0) {
      // 當日製作、但仍需製作步驟
      steps.push({
        date: batchDate,
        action: `⏰ 當日製作 ${atomId}（出貨當天上午、估 ${productionHours.toFixed(1)} hr）`,
        atomId,
        quantity: qty,
        estimated_hours: productionHours,
      });
    } else {
      // 出貨前 N 天開始做
      const start = new Date(batch);
      start.setDate(start.getDate() - lead);
      steps.push({
        date: fmt(start),
        action: `開始製作 ${atomId}（出貨前 ${lead} 天、估 ${productionHours.toFixed(1)} hr）`,
        atomId,
        quantity: qty,
        estimated_hours: productionHours,
      });
    }

    // 出貨當日（副產品已在上面處理）
    steps.push({
      date: batchDate,
      action: `📦 出貨 ${atomId}`,
      atomId,
      quantity: qty,
    });
  }

  // 按日期 → action 排序
  steps.sort((a, b) =>
    a.date === b.date ? a.atomId.localeCompare(b.atomId) : a.date.localeCompare(b.date)
  );

  return {
    batch_date: batchDate,
    steps,
  };
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
