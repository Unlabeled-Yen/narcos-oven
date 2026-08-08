/**
 * #8 訂單可編輯架構 — 純函式：單筆編輯 / 作廢 / 復原。
 * 見 docs/boss-issues-plan-2026-08.md 順位 10。
 *
 * 三個操作都遵守同一條規矩：id 唯讀（diff 引擎的錨、絕不可改），
 * 每次變動都算出 { from, to } 欄位差異、寫回 order.changes[]（憲章：
 * 資料要長期累積做統計，所以不是清掉，而是可編輯 + 可追溯）。
 */
import type { Order, OrderChange, OrderItem, OrderStatus } from "./models";

export type ManualEditInput = {
  batchDate?: string | null;
  recipientName?: string;
  grossTotal?: number;
  items?: OrderItem[];
};

export type ManualEditPlan =
  | { ok: true; order: Order; change: OrderChange | null } // change:null = 送出了但沒有任何欄位真的變
  | { ok: false; error: string };

/**
 * 計算單筆手動編輯的結果。edits 只含要改的欄位（undefined = 不動）。
 * 不接受改 id（型別上就不開放）。
 */
export function planManualEdit(
  order: Order,
  edits: ManualEditInput,
  nowIso: string
): ManualEditPlan {
  if (edits.grossTotal !== undefined && (!Number.isFinite(edits.grossTotal) || edits.grossTotal < 0)) {
    return { ok: false, error: "金額必須是 ≥ 0 的數字" };
  }
  if (edits.items !== undefined) {
    if (edits.items.length === 0) {
      return { ok: false, error: "品項不可清空為 0 筆" };
    }
    for (const it of edits.items) {
      if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
        return { ok: false, error: `品項「${it.rawName}」數量必須 > 0` };
      }
    }
  }
  if (edits.batchDate !== undefined && edits.batchDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(edits.batchDate)) {
    return { ok: false, error: `出貨批次日期格式不合法：${edits.batchDate}` };
  }

  const fields: Record<string, { from: unknown; to: unknown }> = {};
  let next: Order = order;

  if (edits.batchDate !== undefined && edits.batchDate !== order.batchDate) {
    fields.batchDate = { from: order.batchDate, to: edits.batchDate };
    next = { ...next, batchDate: edits.batchDate };
  }
  if (edits.recipientName !== undefined && edits.recipientName !== order.recipient.name) {
    fields["recipient.name"] = { from: order.recipient.name, to: edits.recipientName };
    next = { ...next, recipient: { ...next.recipient, name: edits.recipientName } };
  }
  if (edits.grossTotal !== undefined && edits.grossTotal !== order.revenue.grossTotal) {
    fields["revenue.grossTotal"] = { from: order.revenue.grossTotal, to: edits.grossTotal };
    next = { ...next, revenue: { ...next.revenue, grossTotal: edits.grossTotal } };
  }
  if (edits.items !== undefined && itemsSignature(edits.items) !== itemsSignature(order.items)) {
    fields.items = { from: itemsSignature(order.items), to: itemsSignature(edits.items) };
    next = { ...next, items: edits.items };
  }

  if (Object.keys(fields).length === 0) {
    return { ok: true, order, change: null };
  }

  const change: OrderChange = {
    imported_at: nowIso,
    import_run_id: "manual",
    fields,
    resolved: null,
    resolved_at: null,
    source: "manual_edit",
  };
  next = { ...next, last_seen_at: nowIso, changes: [...order.changes, change] };

  return { ok: true, order: next, change };
}

function itemsSignature(items: OrderItem[]): string {
  return items
    .map((it) => `${it.productSkuId ?? it.rawName}×${it.quantity}`)
    .sort()
    .join(", ");
}

export type VoidPlan =
  | { ok: true; order: Order; change: OrderChange }
  | { ok: false; error: string };

/** 作廢（軟刪）：status → voided，其餘欄位原封不動、可完整復原。 */
export function planVoidOrder(order: Order, nowIso: string): VoidPlan {
  if (order.status === "voided") {
    return { ok: false, error: "這筆訂單已經是作廢狀態" };
  }
  const change: OrderChange = {
    imported_at: nowIso,
    import_run_id: "manual",
    fields: { status: { from: order.status, to: "voided" } },
    resolved: null,
    resolved_at: null,
    source: "void",
  };
  return {
    ok: true,
    order: { ...order, status: "voided", last_seen_at: nowIso, changes: [...order.changes, change] },
    change,
  };
}

/**
 * 復原：讀 changes[] 裡最後一筆「把 status 改成 voided」的紀錄，取它的 from 當復原目標。
 * 找不到（資料被動過手腳、或從沒作廢過）→ 拒絕，不猜。
 */
export function planRestoreOrder(order: Order, nowIso: string): VoidPlan {
  if (order.status !== "voided") {
    return { ok: false, error: "這筆訂單不是作廢狀態，沒有東西好復原" };
  }
  const lastVoid = [...order.changes].reverse().find(
    (c) => c.fields.status?.to === "voided"
  );
  const restoreTo = lastVoid?.fields.status?.from;
  if (typeof restoreTo !== "string") {
    return { ok: false, error: "找不到作廢前的原始狀態、無法自動復原（請改用狀態下拉手動指定）" };
  }
  const change: OrderChange = {
    imported_at: nowIso,
    import_run_id: "manual",
    fields: { status: { from: "voided", to: restoreTo } },
    resolved: null,
    resolved_at: null,
    source: "restore",
  };
  return {
    ok: true,
    order: {
      ...order,
      status: restoreTo as OrderStatus,
      last_seen_at: nowIso,
      changes: [...order.changes, change],
    },
    change,
  };
}
