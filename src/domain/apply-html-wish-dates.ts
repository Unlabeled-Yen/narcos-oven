/**
 * #12 把 seller-buy-html.ts 解析出的「訂單編號 + 指定出貨日」套回已入庫訂單。
 *
 * 這不是一般的匯入流程（不走 diff.ts 的新增/消失守恆律）——html 只補寫
 * 既有訂單的 customer_wish_date 這一個欄位，其餘欄位完全不動。單一事實
 * 來源原則：真正的訂單資料仍是 xlsx，html 只是「指定日」的第二個來源。
 *
 * 三種結果（人工都要看得到，不能靜默）：
 *   1. 訂單本來沒有指定日（xlsx 沒帶）→ 直接補上，不算衝突
 *   2. 訂單本來的指定日跟 html 一致 → 什麼都不做
 *   3. 訂單本來的指定日跟 html 不同 → 進待處理桶（CONFLICT_DATE_C12_C28）
 *      讓人擇一，customer_wish_date 暫不覆蓋
 *   html 裡的訂單編號在 DB 裡完全找不到 → 進 unmatchedOrderIds，loud 列出
 */
import type { HtmlWishDateEntry } from "../parsers/seller-buy-html";
import type { Order, PendingReason } from "./models";

export type ApplyHtmlWishDatesResult = {
  /** 完整訂單陣列，只有比對到的那幾筆被換成更新後的物件 */
  updatedOrders: Order[];
  /** 原本 customer_wish_date 是 null、直接補上（不算衝突）*/
  filledCount: number;
  /** 補上指定日的訂單編號（供 UI 摘要/寫回 DB 用）*/
  filledOrderIds: string[];
  /** 原本跟 html 一致、無異動 */
  alreadyConsistentCount: number;
  /** 進 pending_conflict_date 桶的訂單編號 */
  conflictOrderIds: string[];
  /** html 裡有、DB 裡找不到對應訂單的編號——不能靜默吞掉 */
  unmatchedOrderIds: string[];
};

function isInBucket(status: Order["status"]): boolean {
  return (
    status.startsWith("pending_") ||
    status === "change_pending_resolution" ||
    status === "disappeared_pending_resolution"
  );
}

export function applyHtmlWishDates(
  orders: Order[],
  entries: HtmlWishDateEntry[]
): ApplyHtmlWishDatesResult {
  const entryById = new Map(entries.map((e) => [e.order_id, e.customer_wish_date]));

  let filledCount = 0;
  let alreadyConsistentCount = 0;
  const filledOrderIds: string[] = [];
  const conflictOrderIds: string[] = [];

  const updatedOrders = orders.map((o) => {
    const htmlDate = entryById.get(o.id);
    if (htmlDate === undefined) return o;

    if (o.customer_wish_date === htmlDate) {
      alreadyConsistentCount++;
      return o;
    }

    if (o.customer_wish_date == null) {
      filledCount++;
      filledOrderIds.push(o.id);
      return { ...o, customer_wish_date: htmlDate };
    }

    // 衝突：xlsx 已有一個指定日、html 給了不同的 —— 進桶讓人擇一，不猜
    conflictOrderIds.push(o.id);
    const reason: PendingReason = {
      code: "CONFLICT_DATE_C12_C28",
      humanMessage: `指定出貨日衝突：xlsx 記為 ${o.customer_wish_date}、html 網頁存檔記為 ${htmlDate}`,
      suggestion: htmlDate,
      suggestionConfidence: 0,
    };
    return {
      ...o,
      status: isInBucket(o.status) ? o.status : "pending_conflict_date",
      pendingReasons: [...o.pendingReasons, reason],
    };
  });

  const dbIds = new Set(orders.map((o) => o.id));
  const unmatchedOrderIds = entries
    .map((e) => e.order_id)
    .filter((id) => !dbIds.has(id));

  return {
    updatedOrders,
    filledCount,
    filledOrderIds,
    alreadyConsistentCount,
    conflictOrderIds,
    unmatchedOrderIds,
  };
}
