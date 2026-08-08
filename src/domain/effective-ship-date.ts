/**
 * #6 2026-08-06：期間統計一律用「出貨日」。
 *
 * 老闆語意：系統一律使用出貨日。現況「不一致」= 各頁篩期間用的日期欄不同——
 * 工單/出貨明細/印標籤已經用 shippingDayFor(batchDate) 算出貨日，但分潤/
 * 儀表板/駐店對帳/期間摘要 Excel 各自直接讀 batchDate（或 batchDate ??
 * order_date），同一張單出爐 7/31、出貨 8/1，各頁月報表歸屬不一樣。
 *
 * 這支函式是唯一權威：
 *   - 賣貨便/宅配/面交/KOL：shippingDayFor(batchDate)——batchDate 是出爐日、
 *     要往後找第一個出貨日
 *   - 駐店：batchDate 本身就是到貨=出貨日，不用再跑 shippingDayFor（駐店
 *     可以任何一天到貨，不受「出貨星期幾」限制，跑了反而會被誤推到下個
 *     出貨日）
 *   - 沒有 batchDate → null（列「未排」，不落任何期間——這正是既有工單/
 *     出貨明細頁的行為，其餘頁面應該跟它一致）
 *
 * 不碰 localStorage / menu，dayTypeOf 由呼叫端注入（跟 day-type.ts /
 * compute-dashboard.ts 的 ShipCalendar 同一個模式），維持純函式可測。
 */
import type { Order } from "./models";
import type { DayType } from "./day-type";
import { shippingDayFor } from "./day-type";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function effectiveShipDate(
  order: Order,
  dayTypeOf: (iso: string) => DayType
): string | null {
  if (!order.batchDate) return null;
  // 憲章 #2 靜默失效零容忍：batchDate 非 ISO 格式時明確報錯，不悄悄歸 null
  // 或吐出垃圾字串當日期用——那會讓期間分組出現一個看起來正常、實則錯誤
  // 的欄位，比直接炸掉更難查。
  if (!ISO_DATE_RE.test(order.batchDate)) {
    throw new Error(
      `effectiveShipDate: 訂單 ${order.id} 的 batchDate 不是合法 ISO 日期（收到 ${JSON.stringify(order.batchDate)}）`
    );
  }
  if (order.channel === "駐店") return order.batchDate;
  return shippingDayFor(order.batchDate, dayTypeOf);
}
