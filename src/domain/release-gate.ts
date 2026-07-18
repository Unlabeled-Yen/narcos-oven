/**
 * 產出閘門（對應憲章 #9 消失守恆 + #10 變動守恆）
 *
 * 判斷是否可以產出 Excel/PDF/標籤。
 * 若消失訂單未確認、變動訂單未確認 → 不可產出。
 *
 * blockers 是給雇主看的白話原因，UI 直接顯示、不要出現內部代號。
 */
import type { Order } from "./models";

export type GateStatus = {
  can_release: boolean;
  blockers: string[]; // 人類可讀原因（直接顯示給雇主）
  disappeared_count: number;
  change_pending_count: number;
};

export function checkReleaseGate(orders: Order[]): GateStatus {
  const disappeared = orders.filter(
    (o) => o.status === "disappeared_pending_resolution"
  );
  const changePending = orders.filter(
    (o) => o.status === "change_pending_resolution"
  );
  const blockers: string[] = [];
  if (disappeared.length > 0) {
    blockers.push(`${disappeared.length} 筆消失訂單待確認`);
  }
  if (changePending.length > 0) {
    blockers.push(`${changePending.length} 筆資訊變動待確認`);
  }
  return {
    can_release: blockers.length === 0,
    blockers,
    disappeared_count: disappeared.length,
    change_pending_count: changePending.length,
  };
}
