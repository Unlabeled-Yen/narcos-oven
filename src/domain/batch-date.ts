/**
 * Stage 4 出爐日抓取共用邏輯。
 *
 * Excel 常見「7/07」缺年份，我們用「訂單日+未來 90 天內最近該 M/D」推。
 * 若都推不出來 → 回 null（parser 加 PendingReason(MISSING_BATCH_DATE)）
 */

/** 從賣貨便 c12 商品名找「⚠️必填！指定出貨日 ... M/D（W）」marker。 */
export function extractSellerBuyShippingDate(
  productName: string,
  orderDate: Date | null
): string | null {
  const m = /指定出貨日.*?(\d+)\/(\d+)/.exec(productName);
  if (!m) return null;
  const month = parseInt(m[1]!, 10);
  const day = parseInt(m[2]!, 10);
  return inferYYYYMMDD(month, day, orderDate);
}

/** 從面交 c2「中壢面交 6/23（二）18:00-18:30」抓 M/D。 */
export function extractInPersonDate(
  c2Text: string,
  submitDate: Date | null
): string | null {
  const m = /(\d+)\/(\d+)/.exec(c2Text);
  if (!m) return null;
  const month = parseInt(m[1]!, 10);
  const day = parseInt(m[2]!, 10);
  return inferYYYYMMDD(month, day, submitDate);
}

/** 從 KOL c4 值抓日期。 datetime object 直接用、字串 regex、其他 null。 */
export function extractKolShippingDate(
  c4Value: unknown,
  submitDate: Date | null
): string | null {
  if (c4Value instanceof Date) {
    return fmt(c4Value);
  }
  if (typeof c4Value === "string") {
    // 「2026-07-14 00:00:00」pattern
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(c4Value);
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }
    // 「6/23」pattern
    const mdMatch = /(\d+)\/(\d+)/.exec(c4Value);
    if (mdMatch) {
      return inferYYYYMMDD(
        parseInt(mdMatch[1]!, 10),
        parseInt(mdMatch[2]!, 10),
        submitDate
      );
    }
    // 「七月台中面交」「八月中出貨」這種模糊字串 → null（進 pending）
  }
  if (typeof c4Value === "number") {
    // Excel serial date
    const d = excelSerialToDate(c4Value);
    if (d) return fmt(d);
  }
  return null;
}

// ---- helpers ----

/** 給 M/D，配 anchor date（訂單日/表單日），推「未來 90 天內最近該 MD」的 YYYY-MM-DD。 */
export function inferYYYYMMDD(
  month: number,
  day: number,
  anchorDate: Date | null
): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const anchor = anchorDate ?? new Date();
  // 候選年份：anchor 那年、anchor 那年 + 1
  for (const y of [anchor.getFullYear(), anchor.getFullYear() + 1]) {
    const candidate = new Date(y, month - 1, day);
    if (
      candidate.getFullYear() === y &&
      candidate.getMonth() === month - 1 &&
      candidate.getDate() === day
    ) {
      const diff =
        (candidate.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24);
      // 允許往前 3 天（同天下訂+選當日）、往後 90 天
      if (diff >= -3 && diff <= 90) {
        return fmt(candidate);
      }
    }
  }
  return null;
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Excel serial date → JS Date（1900-01-00 為 base、忽略閏年 bug 因為只影響 1900/02/29）。 */
function excelSerialToDate(n: number): Date | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  const epochMs = Date.UTC(1899, 11, 30); // Excel epoch
  return new Date(epochMs + n * 24 * 60 * 60 * 1000);
}

/**
 * 從賣貨便訂購日期字串「2026/06/30」解析 Date。
 */
export function parseSellerBuyOrderDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(v.trim());
    if (m) {
      return new Date(
        parseInt(m[1]!, 10),
        parseInt(m[2]!, 10) - 1,
        parseInt(m[3]!, 10)
      );
    }
  }
  return null;
}
