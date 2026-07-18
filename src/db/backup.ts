/**
 * 全庫備份 / 還原（Yen 2026-07-05 交付雇主前必要功能）
 *
 * 動機：整套系統資料只在瀏覽器 IndexedDB · 換電腦 / 清 cache = 資料歸零
 *      → 必須提供人工備份出口 · 雇主每週點一次匯出、丟到 Google Drive
 *
 * 三張表全 dump 進單一 JSON 檔 · 檔名帶時間戳、方便版本管理
 * 還原 = 全域覆蓋 · 需雇主 confirm（不做 merge · 避免 diff 分歧）
 */
import { db } from "./schema";
import { clearDayLocks, dumpDayLocks, restoreDayLocks } from "./week-locks";

const BACKUP_VERSION = 2;
// v1:三張表 · v2:加 day_locks(排程日鎖 · localStorage)

export type BackupPayload = {
  version: number;
  exported_at: string;
  app: "narcos-oven";
  orders: unknown[];
  import_runs: unknown[];
  order_changes: unknown[];
  day_locks?: Record<string, true>; // v2 起 · v1 舊備份無此欄位
};

export async function exportBackup(): Promise<Blob> {
  const [orders, import_runs, order_changes] = await Promise.all([
    db.orders.toArray(),
    db.import_runs.toArray(),
    db.order_changes.toArray(),
  ]);
  const payload: BackupPayload = {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    app: "narcos-oven",
    orders,
    import_runs,
    order_changes,
    day_locks: dumpDayLocks(),
  };
  const json = JSON.stringify(payload, null, 2);
  return new Blob([json], { type: "application/json" });
}

export function downloadBackup(blob: Blob): void {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `narcos-oven-backup-${ts}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function clearAllData(): Promise<void> {
  await db.transaction("rw", db.orders, db.import_runs, db.order_changes, async () => {
    await db.orders.clear();
    await db.import_runs.clear();
    await db.order_changes.clear();
  });
  // 排程日鎖也一併清 · 憲章 #2:清空語意要完整、不留孤兒 localStorage 狀態
  clearDayLocks();
}

export async function importBackup(file: File): Promise<
  | {
      ok: true;
      counts: { orders: number; import_runs: number; order_changes: number; day_locks: number };
      warnings: string[];
    }
  | { ok: false; error: string }
> {
  let payload: BackupPayload;
  try {
    const text = await file.text();
    payload = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `JSON 解析失敗:${err instanceof Error ? err.message : String(err)}` };
  }
  if (payload.app !== "narcos-oven") {
    return { ok: false, error: `不是本系統的備份檔(app=${String(payload.app)})` };
  }
  // v1 / v2 都接受 · v1 無 day_locks 欄位、還原時當作空
  if (payload.version !== 1 && payload.version !== 2) {
    return { ok: false, error: `備份版本不支援(檔案=${payload.version}, 系統=${BACKUP_VERSION})` };
  }
  if (!Array.isArray(payload.orders) || !Array.isArray(payload.import_runs) || !Array.isArray(payload.order_changes)) {
    return { ok: false, error: "備份檔結構壞掉:三張表缺一" };
  }
  const warnings: string[] = [];
  const dayLocks: Record<string, true> =
    payload.version === 1
      ? {}
      : payload.day_locks && typeof payload.day_locks === "object"
      ? payload.day_locks
      : {};
  if (payload.version === 1) {
    warnings.push("這是 v1 舊版備份、不含排程日鎖 · 還原後日鎖為空、需重新設定");
  }
  try {
    await db.transaction("rw", db.orders, db.import_runs, db.order_changes, async () => {
      await db.orders.clear();
      await db.import_runs.clear();
      await db.order_changes.clear();
      // 已知型別、bulkAdd 直接寫回
      await db.orders.bulkAdd(payload.orders as never[]);
      await db.import_runs.bulkAdd(payload.import_runs as never[]);
      await db.order_changes.bulkAdd(payload.order_changes as never[]);
    });
    // 三張表寫完後才動 localStorage · 避免 DB 還原失敗、鎖已改的孤兒狀態
    restoreDayLocks(dayLocks);
    return {
      ok: true,
      counts: {
        orders: payload.orders.length,
        import_runs: payload.import_runs.length,
        order_changes: payload.order_changes.length,
        day_locks: Object.keys(dayLocks).length,
      },
      warnings,
    };
  } catch (err) {
    return { ok: false, error: `寫入失敗:${err instanceof Error ? err.message : String(err)}` };
  }
}
