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

export type SanitizeResult = {
  scanned: number;
  fixed: number;
  fixes: Array<{
    id: string;
    reason: "dirty-batchDate" | "dirty-wishDate" | "legacy-missing-batch-date-reason";
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
