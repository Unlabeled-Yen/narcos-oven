/**
 * 憲章防護 #1 總數守恆律
 *   raw_input_count === Σ(confirmed) + Σ(all pending)
 * 對不上就大紅色警示。
 */
import type { Order } from "../domain/models";

export function ConservationBanner({
  rawRowCount,
  orders,
}: {
  rawRowCount: number;
  orders: Order[];
}) {
  const ok = rawRowCount === orders.length;
  if (ok) {
    return (
      <div className="mb-4 bg-green-50 border border-green-300 rounded p-3 text-sm text-green-900">
        ✅ <strong>憲章防護 #1 通過</strong>：原始 {rawRowCount} 列 === 主軌
        {orders.length} 筆訂單（無遺漏）
      </div>
    );
  }
  return (
    <div className="mb-4 bg-red-100 border-2 border-red-500 rounded p-3 text-sm text-red-900">
      🚨 <strong>憲章防護 #1 失敗</strong>：原始 {rawRowCount} 列 ≠ 主軌
      {orders.length} 筆訂單（差 {Math.abs(rawRowCount - orders.length)} 筆）——parser
      有 bug、請調查！
    </div>
  );
}
