/**
 * Content-based ID generator（M100-B1）
 *
 * 面交/KOL 訂單原本用行號生成 ID（`IP-面交.xlsx-r7`）、
 * 檔案改列數就變 disappeared+added。改用 content hash 讓 ID 穩定。
 *
 * 用 djb2 演算法（純 JS、可 Node/browser 共用、不依賴 crypto）。
 */

function hash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).padStart(6, "0");
}

/**
 * 面交訂單 ID：hash(姓名 + 電話 + 時間戳 + 「在哪邊取貨」欄)
 * 姓名/電話變 → 新訂單；同人同單 → 同 ID
 */
export function inPersonOrderId(parts: {
  recipientName: string | null;
  phone: string | null;
  submitTimestamp: string | null;
  pickupLocation: string | null;
}): string {
  const key = [
    parts.recipientName ?? "",
    parts.phone ?? "",
    parts.submitTimestamp ?? "",
    parts.pickupLocation ?? "",
  ].join("|");
  return `IP-${hash(key)}`;
}

/**
 * KOL 訂單 ID：hash(折扣碼 + IG 帳號)、稳定跨檔案匯入
 */
export function kolOrderId(parts: {
  discountCode: string | null;
  ig: string | null;
}): string {
  const key = [parts.discountCode ?? "", parts.ig ?? ""].join("|");
  return `KOL-${hash(key)}`;
}
