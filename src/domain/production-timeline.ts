/**
 * Stage 11：製作時程回推
 * 對應 docs/spec.md §11.2 + R3-3 (雇主待補 lead_time_days)
 *
 * 對某個 batch_date、依 items 中每個 atom 的 lead_time_days
 * 產生「哪天要開始做什麼」的行事曆。
 */
import type { Menu, Order } from "./models";

export type ProductionStep = {
  date: string;                    // YYYY-MM-DD
  action: string;                  // 「開始做 X」「烤 Y」
  atomId: string;
  quantity: number;
};

export type ProductionTimeline = {
  batch_date: string;
  steps: ProductionStep[];         // 依日期升序
};

export function productionTimeline(
  batchDate: string,
  orders: Order[],
  menu: Menu
): ProductionTimeline {
  const leadTimes = menu.product_lead_time ?? {};

  // 收集該批的 atom 累積
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
    const lead = leadTimes[atomId] ?? 1;
    // 出貨日 D → 開始做 D-lead
    const start = new Date(batch);
    start.setDate(start.getDate() - lead);
    steps.push({
      date: fmt(start),
      action:
        lead === 0
          ? `準備 ${atomId}（現貨或當日）`
          : `開始製作 ${atomId}（出貨前 ${lead} 天）`,
      atomId,
      quantity: qty,
    });
    // 出貨當日
    steps.push({
      date: batchDate,
      action: `出貨 ${atomId}`,
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
