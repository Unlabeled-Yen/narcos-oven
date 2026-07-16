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

const BACKUP_VERSION = 1;

export type BackupPayload = {
  version: number;
  exported_at: string;
  app: "narcos-oven";
  orders: unknown[];
  import_runs: unknown[];
  order_changes: unknown[];
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
}

export async function importBackup(file: File): Promise<{ ok: true; counts: { orders: number; import_runs: number; order_changes: number } } | { ok: false; error: string }> {
  let payload: BackupPayload;
  try {
    const text = await file.text();
    payload = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `JSON 解析失敗：${err instanceof Error ? err.message : String(err)}` };
  }
  if (payload.app !== "narcos-oven") {
    return { ok: false, error: `不是本系統的備份檔（app=${String(payload.app)}）` };
  }
  if (payload.version !== BACKUP_VERSION) {
    return { ok: false, error: `備份版本不符（檔案=${payload.version}, 系統=${BACKUP_VERSION}）` };
  }
  if (!Array.isArray(payload.orders) || !Array.isArray(payload.import_runs) || !Array.isArray(payload.order_changes)) {
    return { ok: false, error: "備份檔結構壞掉：三張表缺一" };
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
    return {
      ok: true,
      counts: {
        orders: payload.orders.length,
        import_runs: payload.import_runs.length,
        order_changes: payload.order_changes.length,
      },
    };
  } catch (err) {
    return { ok: false, error: `寫入失敗：${err instanceof Error ? err.message : String(err)}` };
  }
}
