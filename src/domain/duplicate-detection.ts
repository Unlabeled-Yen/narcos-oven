/**
 * #8 訂單可編輯架構 · 重複偵測工具 — 純函式。
 * 見 docs/boss-issues-plan-2026-08.md 順位 10 規格 3。
 *
 * 分組鍵：同通路 + 同收件人姓名 + 同品項組合 + 同下單日。刻意不含 id
 * （id 本身可能因為不同次手動輸入而不同）；刻意含「同日」——同人不同日
 * 是回頭客的正常行為、不是重複，絕不能誤報成重複而誘導雇主刪掉真訂單。
 * 只列出可疑組，不自動刪——一律人拍板（見 planVoidOrder）。
 */
import type { Order } from "./models";

export type DuplicateGroup = {
  key: string;
  orderIds: string[];
};

export function findDuplicateGroups(orders: Order[]): DuplicateGroup[] {
  const byKey = new Map<string, Order[]>();
  for (const o of orders) {
    if (o.status === "voided" || o.status === "canceled") continue;
    if (!o.order_date) continue;
    const key = `${o.channel}|${o.order_date}|${(o.recipient.name ?? "").trim()}|${itemsKey(o)}`;
    const list = byKey.get(key);
    if (list) list.push(o);
    else byKey.set(key, [o]);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, list] of byKey) {
    if (list.length >= 2) {
      groups.push({ key, orderIds: list.map((o) => o.id).sort() });
    }
  }
  return groups.sort((a, b) => a.key.localeCompare(b.key));
}

function itemsKey(o: Order): string {
  return o.items
    .map((it) => `${it.productSkuId ?? it.rawName}×${it.quantity}`)
    .sort()
    .join(",");
}
