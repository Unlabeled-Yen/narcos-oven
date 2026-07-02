/**
 * 憲章防護 #6 + #9 的 release gate
 *
 * 判斷是否可以產出 Excel/PDF/標籤。
 * 若消失桶未清空、變動桶未拍板 → 不可產出。
 */
import type { Order } from "./models";

export type GateStatus = {
  can_release: boolean;
  blockers: string[]; // 人類可讀原因
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
    blockers.push(
      `憲章 #9：${disappeared.length} 筆消失訂單待雇主拍板`
    );
  }
  if (changePending.length > 0) {
    blockers.push(
      `憲章 #10：${changePending.length} 筆資訊變動待雇主拍板`
    );
  }
  return {
    can_release: blockers.length === 0,
    blockers,
    disappeared_count: disappeared.length,
    change_pending_count: changePending.length,
  };
}
