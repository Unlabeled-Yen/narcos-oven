/**
 * Stage 6a/6b/6c diff engine —— 純函式、可 Node 測試。
 * 對應 docs/spec.md §3 Stage 6a-6c + 憲章 #9 #10
 *
 * 輸入：新解析出的訂單陣列 + db 中同通路的 active 訂單
 * 輸出：
 *   - ImportDiff（4 桶 order_id 集合）
 *   - upserts（需寫回 db 的新/更新訂單完整資料）
 *   - orderChanges（欄位變動的 log records）
 */
import type {
  ImportDiff,
  KeyFieldName,
  Order,
  OrderChange,
  OrderSnapshot,
} from "./models";

export type DiffPlan = {
  diff: ImportDiff;
  upserts: Order[]; // 完整訂單（含更新後的 status/snapshot/last_seen_at/changes）
  markDisappeared: string[]; // 這些 order_id 要在 db 標 disappeared
};

/**
 * @param newOrders parser 剛跑出來的訂單（此輪匯入）
 * @param dbActive  db 中同 channel 的 active 訂單
 * @param importRunId 這次匯入的 run id
 * @param importedAt ISO 時間戳
 */
export function planDiff(
  newOrders: Order[],
  dbActive: Order[],
  importRunId: string,
  importedAt: string
): DiffPlan {
  const dbMap = new Map<string, Order>(dbActive.map((o) => [o.id, o]));
  const newMap = new Map<string, Order>(newOrders.map((o) => [o.id, o]));

  const added: string[] = [];
  const payment_confirmed: string[] = [];
  const fields_changed: string[] = [];
  const unchanged: string[] = [];
  const disappeared: string[] = [];
  const upserts: Order[] = [];

  // 情境 A + B + D + E
  for (const [id, incoming] of newMap) {
    const existing = dbMap.get(id);
    if (!existing) {
      // 情境 A: 新單
      added.push(id);
      upserts.push({
        ...incoming,
        first_seen_at: importedAt,
        last_seen_at: importedAt,
      });
      continue;
    }
    // 情境 B/D/E 候選
    const diffFields = compareSnapshots(existing.snapshot, incoming.snapshot);
    const paymentBecameConfirmed =
      existing.snapshot.c5_status !== incoming.snapshot.c5_status &&
      !existing.snapshot.c5_status.includes("付款完成") &&
      incoming.snapshot.c5_status.includes("付款完成");

    // 若 key fields 沒變、只有 status 從未付款 → 付款 → 情境 B
    const nonPaymentFieldChanges = Object.keys(diffFields).filter(
      (k) => k !== ("c5_status" as KeyFieldName)
    );

    if (paymentBecameConfirmed && nonPaymentFieldChanges.length === 0) {
      payment_confirmed.push(id);
      // auto-update：把 incoming 拿過來、保留 first_seen_at
      upserts.push({
        ...incoming,
        first_seen_at: existing.first_seen_at,
        last_seen_at: importedAt,
        // Stage 2-5 已在 incoming 內、直接用
      });
    } else if (Object.keys(diffFields).length === 0) {
      // 情境 E: idempotent
      unchanged.push(id);
      // 更新 last_seen_at 但保留其他
      upserts.push({
        ...existing,
        last_seen_at: importedAt,
      });
    } else {
      // 情境 D: 關鍵欄位變動 → 進 change_pending
      fields_changed.push(id);
      const change: OrderChange = {
        imported_at: importedAt,
        import_run_id: importRunId,
        fields: diffFields,
        resolved: null,
        resolved_at: null,
      };
      upserts.push({
        ...existing,
        status: "change_pending_resolution",
        last_seen_at: importedAt,
        changes: [...existing.changes, change],
      });
    }
  }

  // 情境 C: 消失
  for (const id of dbMap.keys()) {
    if (!newMap.has(id)) {
      disappeared.push(id);
    }
  }

  return {
    diff: {
      added,
      payment_confirmed,
      fields_changed,
      disappeared,
      unchanged,
    },
    upserts,
    markDisappeared: disappeared,
  };
}

/**
 * 比較兩個 snapshot、回傳變動欄位。
 * 只對關鍵欄位做比對（憲章 #10）。
 */
function compareSnapshots(
  a: OrderSnapshot,
  b: OrderSnapshot
): Record<string, { from: unknown; to: unknown }> {
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const keys: (keyof OrderSnapshot)[] = [
    "c12_product",
    "c22_label_count",
    "c17_freight",
    "c18_discount_seller",
    "c19_discount_freight",
    "c20_discount_platform",
    "c21_total",
    "c11_conv_store",
    "c5_status", // 也記錄狀態變化（供 payment_confirmed 判斷）
  ];
  for (const k of keys) {
    if (!eq(a[k], b[k])) {
      changed[k] = { from: a[k], to: b[k] };
    }
  }
  return changed;
}

function eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < 0.001;
  }
  return String(a ?? "") === String(b ?? "");
}
