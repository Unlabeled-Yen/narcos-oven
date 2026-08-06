/**
 * #13 六入附醬 40ml — 歷史訂單遷移純函式。
 *
 * 已入庫訂單的 atoms 是匯入當下展開存進 DB 的（explodeToAtoms 執行結果
 * 直接寫入 order.items[].atoms）；改 data/menu.yaml 不會回溯修正舊訂單。
 * 這裡的函式操作雇主匯出的備份 JSON（見 src/db/backup.ts BackupPayload），
 * 由 scripts/migrate-40ml.mjs 這支 CLI 呼叫、寫出修正後的新備份檔，
 * 雇主再用 web app「還原備份」讀回（IndexedDB 只在瀏覽器、Node 進不去）。
 *
 * 只改三個六入組合 SKU 底下 atomId === "香料堅果醬90ml" 的那一條 atoms
 * 項，改成 "香料堅果醬40ml"；count 不變（explodeToAtoms 存的是每單位
 * contains 的 count，跟訂購數量無關）。單買 90ml 的訂單完全不碰。
 */
import type { Order } from "./models";

export const COMBO_SKU_IDS = new Set([
  "經典肉桂捲6入",
  "蘋果肉桂捲6入",
  "長型6入_混合",
]);
export const OLD_ATOM = "香料堅果醬90ml";
export const NEW_ATOM = "香料堅果醬40ml";

export type MigrationChange = {
  order_id: string;
  item_index: number;
  productSkuId: string;
  atom_index: number;
  count: number;
};

export function planMigration(orders: Order[]): MigrationChange[] {
  const changes: MigrationChange[] = [];
  for (const order of orders) {
    if (!Array.isArray(order.items)) continue;
    for (let itemIdx = 0; itemIdx < order.items.length; itemIdx++) {
      const item = order.items[itemIdx]!;
      if (!item.productSkuId || !COMBO_SKU_IDS.has(item.productSkuId)) continue;
      if (!Array.isArray(item.atoms)) continue;
      for (let atomIdx = 0; atomIdx < item.atoms.length; atomIdx++) {
        const a = item.atoms[atomIdx]!;
        if (a.atomId === OLD_ATOM) {
          changes.push({
            order_id: order.id,
            item_index: itemIdx,
            productSkuId: item.productSkuId,
            atom_index: atomIdx,
            count: a.count,
          });
        }
      }
    }
  }
  return changes;
}

/** 深拷貝、不動原陣列——呼叫端可自行比對前後 */
export function applyMigration(orders: Order[], changes: MigrationChange[]): Order[] {
  const next: Order[] = JSON.parse(JSON.stringify(orders));
  const byOrder = new Map<string, MigrationChange[]>();
  for (const c of changes) {
    if (!byOrder.has(c.order_id)) byOrder.set(c.order_id, []);
    byOrder.get(c.order_id)!.push(c);
  }
  for (const order of next) {
    const cs = byOrder.get(order.id);
    if (!cs) continue;
    for (const c of cs) {
      const atom = order.items[c.item_index]?.atoms?.[c.atom_index];
      if (!atom || atom.atomId !== OLD_ATOM) {
        throw new Error(
          `遷移計畫與實際資料不符（order ${c.order_id} item ${c.item_index} atom ${c.atom_index}）— 拒絕套用，資料可能在規劃後又變動過`
        );
      }
      atom.atomId = NEW_ATOM;
    }
  }
  return next;
}

/** 守恆檢查：訂單數不變、每筆訂單的 atoms 總顆數（Σ count）不變、非目標訂單一字不動 */
export function verifyConservation(before: Order[], after: Order[]): void {
  if (before.length !== after.length) {
    throw new Error(`訂單總數變了：${before.length} → ${after.length}`);
  }
  const sumAtoms = (o: Order) =>
    (o.items ?? []).reduce(
      (s, it) => s + (it.atoms ?? []).reduce((s2, at) => s2 + at.count, 0),
      0
    );
  const touchesCombo = (o: Order) =>
    (o.items ?? []).some(
      (it) => it.productSkuId && COMBO_SKU_IDS.has(it.productSkuId)
    );
  for (let i = 0; i < before.length; i++) {
    const b = before[i]!;
    const a = after[i]!;
    if (b.id !== a.id) throw new Error(`第 ${i} 筆訂單 id 位移：${b.id} → ${a.id}`);
    if (sumAtoms(b) !== sumAtoms(a)) {
      throw new Error(
        `訂單 ${b.id} 的 atoms 總顆數變了：${sumAtoms(b)} → ${sumAtoms(a)}`
      );
    }
    if (!touchesCombo(b) && JSON.stringify(b) !== JSON.stringify(a)) {
      throw new Error(`訂單 ${b.id} 未含六入組合 SKU、卻被改動——遷移範圍外洩`);
    }
  }
}
