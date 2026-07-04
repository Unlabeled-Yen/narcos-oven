/**
 * DB 資料清理（idempotent）
 *
 * 修復歷史政策留下的髒資料：
 * - batchDate / customer_wish_date 存了「下次週二」這種中文字（月曆比對失敗、靜默失效）
 * - 只接受 ISO YYYY-MM-DD，其他一律清成 null
 *
 * 每次 refreshOrders 呼叫、idempotent（乾淨的訂單不會被動）。
 * 憲章 #2：清理動作 loud console.warn，不靜默。
 */
import type { Order } from "../domain/models";
import { db } from "./schema";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDirtyDate(v: string | null | undefined): boolean {
  if (v === null || v === undefined || v === "") return false;
  return !ISO_DATE_RE.test(v);
}

// Yen 2026-07-04：SKU key rename 對照
//   舊 key「XX5入含醬」→ 官方語意「XX6入」（5 顆主品 + 1 醬 = 6 入）
//   idempotent：跑第二次不會再改（已改的訂單找不到舊 key）
const SKU_RENAME_MAP: Record<string, string> = {
  "經典肉桂捲5入含醬": "經典肉桂捲6入",
  "蘋果肉桂捲5入含醬": "蘋果肉桂捲6入",
  "混合5入含醬": "長型6入_混合",
};

export type SanitizeResult = {
  scanned: number;
  fixed: number;
  fixes: Array<{
    id: string;
    reason:
      | "dirty-batchDate"
      | "dirty-wishDate"
      | "legacy-missing-batch-date-reason"
      | "backfill-order-date-from-snapshot"
      | "sku-rename";
    detail?: string;
  }>;
};

export async function sanitizeDirtyDates(orders: Order[]): Promise<SanitizeResult> {
  const fixes: SanitizeResult["fixes"] = [];
  const patches: Array<{ id: string; changes: Partial<Order> }> = [];

  for (const o of orders) {
    const changes: Partial<Order> = {};

    // 1. 非 ISO batchDate → null（+ 若 source 認客戶意願、退回 pending）
    if (isDirtyDate(o.batchDate)) {
      changes.batchDate = null;
      if (o.assignment_source === "customer_wish_kept") {
        changes.assignment_source = "pending";
      }
      fixes.push({ id: o.id, reason: "dirty-batchDate", detail: String(o.batchDate) });
    }

    // 2. 非 ISO customer_wish_date → null
    if (isDirtyDate(o.customer_wish_date)) {
      changes.customer_wish_date = null;
      fixes.push({ id: o.id, reason: "dirty-wishDate", detail: String(o.customer_wish_date) });
    }

    // 3. 新政策：MISSING_BATCH_DATE 不再是需要 resolve 的 reason
    //    若 pendingReasons 含此 code、清掉；若清完全空且 status pending_batch_date → confirmed
    const hasMissingBatchReason = o.pendingReasons.some((r) => r.code === "MISSING_BATCH_DATE");
    if (hasMissingBatchReason) {
      const filteredReasons = o.pendingReasons.filter((r) => r.code !== "MISSING_BATCH_DATE");
      changes.pendingReasons = filteredReasons;
      if (filteredReasons.length === 0 && o.status === "pending_batch_date") {
        changes.status = "confirmed";
      }
      fixes.push({ id: o.id, reason: "legacy-missing-batch-date-reason" });
    }

    // 4. 反填 order_date：若欄位 null 但 snapshot.c1_order_date 有 ISO 值、補回去
    //    這讓 Yen 不用重匯 Excel 就能看到下單日（前提是之前的匯入有存 snapshot）
    if (!o.order_date && o.snapshot?.c1_order_date && ISO_DATE_RE.test(o.snapshot.c1_order_date)) {
      changes.order_date = o.snapshot.c1_order_date;
      fixes.push({ id: o.id, reason: "backfill-order-date-from-snapshot", detail: o.snapshot.c1_order_date });
    }

    // 5. status ↔ pendingReasons 一致性 invariant：
    //    若 reason 清空（本次或之前）、status 仍是 pending_*、視為 confirmed
    //    修待處理桶「顯示但無選項」的孤兒單
    const willBeReasons = changes.pendingReasons ?? o.pendingReasons;
    const willBeStatus = changes.status ?? o.status;
    if (willBeReasons.length === 0 && willBeStatus.startsWith("pending_")) {
      changes.status = "confirmed";
      fixes.push({
        id: o.id,
        reason: "legacy-missing-batch-date-reason",
        detail: `一致性修復 ${willBeStatus} → confirmed（reason 已清空）`,
      });
    }

    // 6. SKU key rename migration（Yen 2026-07-04）
    //    掃 items[].productSkuId、若命中舊 key、產出新 items array
    let renamedAny = false;
    const newItems = o.items.map((it) => {
      if (it.productSkuId && SKU_RENAME_MAP[it.productSkuId]) {
        renamedAny = true;
        return { ...it, productSkuId: SKU_RENAME_MAP[it.productSkuId]! };
      }
      return it;
    });
    if (renamedAny) {
      changes.items = newItems;
      const renamed = o.items
        .filter((it) => it.productSkuId && SKU_RENAME_MAP[it.productSkuId])
        .map((it) => `${it.productSkuId} → ${SKU_RENAME_MAP[it.productSkuId!]!}`)
        .join(", ");
      fixes.push({ id: o.id, reason: "sku-rename", detail: renamed });
    }

    if (Object.keys(changes).length > 0) {
      patches.push({ id: o.id, changes });
    }
  }

  if (patches.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[sanitize] 自動遷移 ${patches.length} 單（髒日期或舊政策 reason）`,
      fixes
    );
    await db.transaction("rw", db.orders, async () => {
      for (const p of patches) {
        await db.orders.update(p.id, p.changes);
      }
    });
  }

  return { scanned: orders.length, fixed: patches.length, fixes };
}
