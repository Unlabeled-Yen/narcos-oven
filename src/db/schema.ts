/**
 * Dexie.js IndexedDB schema
 * 對應 docs/spec.md §3 Stage 6d + 憲章 #9 #10
 *
 * 3 個 tables：
 *   orders        - 生命週期完整訂單（key = order_id）
 *   import_runs   - 每次匯入的 diff 摘要（可回溯）
 *   order_changes - 訂單欄位變動歷程（跨 import_run 累積）
 */
import Dexie, { type Table } from "dexie";
import type { ImportRun, Order, OrderChange } from "../domain/models";

export class NarcosDatabase extends Dexie {
  orders!: Table<Order, string>;
  import_runs!: Table<ImportRun, string>;
  order_changes!: Table<OrderChange & { order_id: string; id?: number }, number>;

  constructor() {
    super("narcos-oven");
    this.version(1).stores({
      // 主鍵 = id；index by channel + status + batchDate 供 diff query
      orders: "id, channel, status, batchDate, disappeared_at",
      import_runs: "id, imported_at, fully_resolved_at",
      // auto-increment id；index by order_id
      order_changes: "++id, order_id, imported_at, import_run_id",
    });
  }
}

/** singleton instance；只在瀏覽器環境用。 */
export const db = new NarcosDatabase();
