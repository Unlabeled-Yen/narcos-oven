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
    batchDateBefore: string | null;
    wishDateBefore: string | null;
  }>;
};

export async function sanitizeDirtyDates(orders: Order[]): Promise<SanitizeResult> {
  const fixes: SanitizeResult["fixes"] = [];
  const patches: Array<{ id: string; changes: Partial<Order> }> = [];

  for (const o of orders) {
    const badBatch = isDirtyDate(o.batchDate);
    const badWish = isDirtyDate(o.customer_wish_date);
    if (!badBatch && !badWish) continue;

    const changes: Partial<Order> = {};
    if (badBatch) {
      changes.batchDate = null;
      // 若原本 assignment_source 認客戶意願，改回 pending（因為日期無效）
      if (o.assignment_source === "customer_wish_kept") {
        changes.assignment_source = "pending";
      }
    }
    if (badWish) {
      changes.customer_wish_date = null;
    }
    patches.push({ id: o.id, changes });
    fixes.push({
      id: o.id,
      batchDateBefore: badBatch ? o.batchDate : null,
      wishDateBefore: badWish ? o.customer_wish_date : null,
    });
  }

  if (patches.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[sanitize] 清理 ${patches.length} 單髒日期資料（非 ISO YYYY-MM-DD）`,
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
