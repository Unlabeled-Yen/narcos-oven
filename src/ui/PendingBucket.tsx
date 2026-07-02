import type { Order, PendingReasonCode } from "../domain/models";

const REASON_LABEL: Record<PendingReasonCode, { label: string; color: string }> = {
  PAYMENT_NOT_CONFIRMED: { label: "未付款", color: "bg-yellow-100 text-yellow-900" },
  MISSING_BATCH_DATE: { label: "缺出爐日", color: "bg-orange-100 text-orange-900" },
  CONFLICT_DATE_C12_C28: { label: "日期衝突", color: "bg-red-100 text-red-900" },
  AMBIGUOUS_CHANNEL: { label: "通路不清", color: "bg-purple-100 text-purple-900" },
  UNKNOWN_PRODUCT: { label: "品項未歸類", color: "bg-red-200 text-red-900" },
  AMOUNT_MISMATCH: { label: "金額不符", color: "bg-red-200 text-red-900" },
  MISSING_RECIPIENT: { label: "缺收件人", color: "bg-orange-100 text-orange-900" },
  KOL_CHOICE_UNRESOLVED: { label: "KOL 待選", color: "bg-yellow-100 text-yellow-900" },
};

export function PendingBucket({ orders }: { orders: Order[] }) {
  if (orders.length === 0) {
    return (
      <p className="text-sm text-green-700 italic">
        ✨ 待處理桶清空，全部進主軌
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {orders.map((o) => (
        <div
          key={o.id}
          className="bg-white border rounded p-3 text-sm shadow-sm"
        >
          <div className="flex items-start justify-between mb-1">
            <div>
              <span className="font-mono text-xs text-gray-600">{o.id}</span>
              <span className="ml-2">{o.recipient.name ?? "—"}</span>
              <span className="ml-2 text-gray-500 text-xs">
                {o.recipient.convStore ?? ""}
              </span>
            </div>
            <div className="flex gap-1 flex-wrap justify-end">
              {o.pendingReasons.map((r, i) => (
                <span
                  key={i}
                  className={`text-xs px-2 py-0.5 rounded ${REASON_LABEL[r.code].color}`}
                >
                  {REASON_LABEL[r.code].label}
                </span>
              ))}
            </div>
          </div>
          <div className="text-xs text-gray-700 space-y-0.5">
            {o.pendingReasons.map((r, i) => (
              <div key={i}>• {r.humanMessage}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
