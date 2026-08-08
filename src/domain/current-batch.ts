/**
 * #11+#14 批次跨頁雙向連動：批次清單收斂 + hash query 序列化。
 * 見 docs/boss-issues-plan-2026-08.md 順位 9。
 *
 * 排程/工單/出貨明細/印標籤四頁過去各自維護一套「批次是什麼」的邏輯
 * （WorksheetPage 用當週 calendar day、LabelsPage/PrintLabelsPage 各自
 * 掃 orders）——三套實作會漂移。這裡收斂成一顆純函式，四頁共用同一個
 * 真相來源；全域「當前批次」則走 URL hash query（AppShell 統一讀寫），
 * 讓四頁雙向連動、重新整理也保留。
 */
import type { Order } from "./models";
import type { DayType } from "./day-type";
import { shippingDayFor } from "./day-type";

export type BatchListOptions = {
  /**
   * true（出貨明細語意）：該批次所有訂單都是 shipped → 批次從清單消失。
   * false / 未傳（工單、印標籤語意）：不排除，歷史批次仍看得到。
   */
  excludeFullyShipped?: boolean;
};

/**
 * 收斂全訂單成「出貨批次」清單（依 shippingDayFor 分桶、去重、排序）。
 * 只看有 batchDate 的訂單——待排（batchDate=null）不算進任何批次。
 */
export function batchListFrom(
  orders: Order[],
  dayTypeOf: (iso: string) => DayType,
  opts: BatchListOptions = {}
): string[] {
  const seen = new Set<string>();
  for (const o of orders) {
    if (!o.batchDate) continue;
    if (o.status === "voided") continue; // #8：作廢訂單一律不進任何批次清單
    if (opts.excludeFullyShipped && o.status === "shipped") continue;
    seen.add(shippingDayFor(o.batchDate, dayTypeOf));
  }
  return Array.from(seen).sort();
}

const HASH_RE = /^#\/([a-z-]+)(?:\?(.*))?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ParsedBatchHash = { page: string | null; batch: string | null };

/**
 * 解析 `#/worksheet?batch=2026-08-11` → { page, batch }。
 * batch 參數不是合法 ISO 日期（含遺失、亂打）→ 忽略、回 null，
 * 並 console.warn（不 crash、不靜默假裝一切正常）。
 */
export function parseBatchHash(hash: string): ParsedBatchHash {
  const m = HASH_RE.exec(hash);
  if (!m) return { page: null, batch: null };
  const page = m[1] ?? null;
  const params = new URLSearchParams(m[2] ?? "");
  const raw = params.get("batch");
  if (raw === null) return { page, batch: null };
  if (!ISO_DATE_RE.test(raw)) {
    console.warn(`[current-batch] hash 的 batch 參數不是合法 ISO 日期、已忽略：${raw}`);
    return { page, batch: null };
  }
  return { page, batch: raw };
}

/** 序列化回 hash 字串；batch=null 時不帶 query。與 parseBatchHash 互為逆函式（往返一字不差）。 */
export function serializeBatchHash(page: string, batch: string | null): string {
  return batch ? `#/${page}?batch=${batch}` : `#/${page}`;
}
