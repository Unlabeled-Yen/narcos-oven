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

  // 情境 C: 消失 —— 範圍內比對（Yen 2026-07-19）
  //   之前假設「每次匯入 = 該通路完整快照」，DB 有但 new 沒 = 消失。
  //   實務上雇主分批拖同通路不同時段的檔（例如先拖近期 1.xlsx、再補歷史 2.xlsx）
  //   會被誤標為「50 筆消失」→ 逐筆確認的假債。跟 import-sanity 同樣治理：
  //   只把「日期落在這輪 xlsx 涵蓋範圍內」的 DB 訂單視為候選消失。範圍外的 skip。
  const [rangeMin, rangeMax] = orderDateRange(newOrders);
  const inRange = (d: string | null | undefined): boolean => {
    if (!rangeMin || !rangeMax) return false;
    if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return false;
    return d >= rangeMin && d <= rangeMax;
  };
  for (const [id, existing] of dbMap) {
    if (newMap.has(id)) continue;
    if (!inRange(existing.order_date)) {
      // 範圍外 · 這輪 xlsx 本來就不涵蓋這個日期、不應該視為消失。
      // 也要把它推進 upserts 保留原狀（避免 upsertMany 覆蓋掉 last_seen_at 之外的東西——
      //   實際上 upsertMany 只寫傳進來的、不會動到沒 upsert 的、所以這裡不 push 就好）。
      continue;
    }
    disappeared.push(id);
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

/** [min, max] 下單日 · 只取 ISO 前綴合法的 · 空陣列或全無日期回 [null, null] */
function orderDateRange(orders: Order[]): [string | null, string | null] {
  let min: string | null = null;
  let max: string | null = null;
  for (const o of orders) {
    const d = o.order_date;
    if (!d) continue;
    if (!/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
    if (min === null || d < min) min = d;
    if (max === null || d > max) max = d;
  }
  return [min, max];
}

function eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < 0.001;
  }
  return String(a ?? "") === String(b ?? "");
}
