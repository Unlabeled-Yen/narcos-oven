/**
 * MCP state I/O
 * Web app 匯出 orders + import_runs 到 data/state.json；MCP server 讀。
 * 這是 Web app 和 MCP server 之間的資料橋樑。
 */
import { readFileSync, existsSync } from "node:fs";
import type { ImportRun, Menu, Order } from "../domain/models";
import { load as yamlLoad } from "js-yaml";

export type StateSnapshot = {
  version: 1;
  exported_at: string; // ISO
  orders: Order[];
  import_runs: ImportRun[];
};

/**
 * 從 data/state.json 載入。找不到時回空狀態。
 */
export function loadStateSnapshot(path: string): StateSnapshot {
  if (!existsSync(path)) {
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      orders: [],
      import_runs: [],
    };
  }
  const text = readFileSync(path, "utf-8");
  const parsed = JSON.parse(text);
  if (parsed.version !== 1) {
    throw new Error(`Unsupported state.json version: ${parsed.version}`);
  }
  return parsed as StateSnapshot;
}

/**
 * 從 data/menu.yaml 載入 menu（同 browser 端）。
 */
export function loadMenuFromDisk(path: string): Menu {
  const text = readFileSync(path, "utf-8");
  return yamlLoad(text) as Menu;
}

/**
 * 將 orders + import_runs 序列化為 state.json 內容（browser 匯出用）。
 */
export function buildStateSnapshotJson(
  orders: Order[],
  importRuns: ImportRun[]
): string {
  const snapshot: StateSnapshot = {
    version: 1,
    exported_at: new Date().toISOString(),
    orders,
    import_runs: importRuns,
  };
  return JSON.stringify(snapshot, null, 2);
}
