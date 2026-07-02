/**
 * 排程建議 UI（最小版）
 * - 顯示所有 pending 訂單的 system_suggested_date
 * - 一鍵「全部接受」或個別 accept/reject/override
 * - 顯示產能超載警告
 */
import { useEffect, useMemo, useState } from "react";
import { db } from "../db/schema";
import type { Menu, Order } from "../domain/models";
import { applySuggestions, suggestSchedule } from "../domain/scheduler";
import { calculateBOM, type BomResult } from "../domain/bom";
import { productionTimeline, type ProductionTimeline } from "../domain/production-timeline";

export function SchedulePanel({
  orders,
  menu,
  onOrdersChanged,
}: {
  orders: Order[];
  menu: Menu;
  onOrdersChanged: () => void;
}) {
  const [showBomFor, setShowBomFor] = useState<string | null>(null);
  const result = useMemo(() => suggestSchedule(orders, menu), [orders, menu]);
  const [busy, setBusy] = useState(false);

  const pendingCount = result.suggestions.length;

  async function acceptAll() {
    if (pendingCount === 0) return;
    if (!confirm(`⚠️ 接受 ${pendingCount} 筆建議、寫入 db？`)) return;
    setBusy(true);
    const resolutions: Record<string, "accept"> = {};
    for (const s of result.suggestions) resolutions[s.order_id] = "accept";
    const updated = applySuggestions(orders, result.suggestions, resolutions);
    await db.orders.bulkPut(updated.filter((o) => resolutions[o.id]));
    setBusy(false);
    onOrdersChanged();
  }

  async function acceptOne(orderId: string) {
    setBusy(true);
    const updated = applySuggestions(orders, result.suggestions, {
      [orderId]: "accept",
    });
    const found = updated.find((o) => o.id === orderId);
    if (found) await db.orders.put(found);
    setBusy(false);
    onOrdersChanged();
  }

  async function overrideOne(orderId: string) {
    const date = prompt("輸入自訂出爐日 YYYY-MM-DD");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setBusy(true);
    const updated = applySuggestions(orders, result.suggestions, {
      [orderId]: date,
    });
    const found = updated.find((o) => o.id === orderId);
    if (found) await db.orders.put(found);
    setBusy(false);
    onOrdersChanged();
  }

  const scheduledDates = useMemo(() => {
    const s = new Set<string>();
    for (const o of orders) {
      if (o.batchDate && (o.status === "confirmed" || o.status === "kol_shipped"))
        s.add(o.batchDate);
    }
    return [...s].sort();
  }, [orders]);

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-bold">🗓 排程建議（M6）</h2>
        {pendingCount > 0 && (
          <button
            onClick={acceptAll}
            disabled={busy}
            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded"
          >
            🚀 全部接受建議（{pendingCount} 筆）
          </button>
        )}
      </div>

      {pendingCount === 0 && result.unscheduled.length === 0 && (
        <div className="text-sm text-gray-500 bg-gray-50 rounded p-3">
          ✨ 沒有待排訂單。可能：（a）全部客人指定出爐日、（b）你已排完、（c）目前系統沒訂單。
        </div>
      )}

      {result.unscheduled.length > 0 && (
        <div className="mb-3 bg-red-50 border border-red-300 rounded p-3 text-sm text-red-900">
          🚨 <strong>憲章 #12 產能超載</strong>：以下 {result.unscheduled.length} 筆連續 10 週都超載、需要雇主介入
          <ul className="mt-1 ml-4 list-disc text-xs">
            {result.unscheduled.slice(0, 5).map((u) => (
              <li key={u.order_id}>
                {u.order_id} 試過：{u.tried_dates.slice(0, 3).join(", ")}...
              </li>
            ))}
          </ul>
        </div>
      )}

      {pendingCount > 0 && (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {result.suggestions.map((s) => {
            const o = orders.find((x) => x.id === s.order_id);
            if (!o) return null;
            return (
              <div
                key={s.order_id}
                className="bg-white border rounded p-2 text-sm flex items-center justify-between"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{o.id}</span>
                    <span>{o.recipient.name ?? "—"}</span>
                    <span className="text-gray-500 text-xs">{o.channel}</span>
                    <span className="ml-2 font-semibold text-blue-700">
                      → {s.suggested_date}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 ml-1">{s.reason}</div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => acceptOne(s.order_id)}
                    disabled={busy}
                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded"
                  >
                    接受
                  </button>
                  <button
                    onClick={() => overrideOne(s.order_id)}
                    disabled={busy}
                    className="px-2 py-1 bg-gray-500 hover:bg-gray-600 text-white text-xs rounded"
                  >
                    改日
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {scheduledDates.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-bold text-gray-600 mb-1">
            📅 已排定批次 —— 點展開看 BOM + 製作時程
          </h3>
          <div className="flex flex-wrap gap-2">
            {scheduledDates.map((d) => (
              <button
                key={d}
                onClick={() => setShowBomFor(showBomFor === d ? null : d)}
                className={`px-2 py-1 text-xs rounded border ${
                  showBomFor === d
                    ? "bg-blue-100 border-blue-400"
                    : "bg-white border-gray-300 hover:bg-gray-50"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          {showBomFor && (
            <BomTimelineView
              batchDate={showBomFor}
              orders={orders}
              menu={menu}
            />
          )}
        </div>
      )}
    </section>
  );
}

function BomTimelineView({
  batchDate,
  orders,
  menu,
}: {
  batchDate: string;
  orders: Order[];
  menu: Menu;
}) {
  const [bom, setBom] = useState<BomResult | null>(null);
  const [timeline, setTimeline] = useState<ProductionTimeline | null>(null);
  useEffect(() => {
    setBom(calculateBOM(batchDate, orders, menu));
    setTimeline(productionTimeline(batchDate, orders, menu));
  }, [batchDate, orders, menu]);

  if (!bom || !timeline) return null;
  return (
    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="bg-yellow-50 rounded p-3">
        <h4 className="font-bold text-sm mb-2">
          📦 備料 BOM ({batchDate})
        </h4>
        {bom.warnings.map((w, i) => (
          <div key={i} className="text-xs text-yellow-900 mb-1">
            {w}
          </div>
        ))}
        <div className="text-xs">訂單數: {bom.order_count}</div>
        <table className="text-xs w-full mt-2">
          <tbody>
            {bom.lines.map((l) => (
              <tr key={l.material}>
                <td>{l.material}</td>
                <td className="text-right font-mono">
                  {l.quantity} {l.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-blue-50 rounded p-3">
        <h4 className="font-bold text-sm mb-2">
          🗓 製作時程回推 ({batchDate})
        </h4>
        <div className="text-xs space-y-1">
          {timeline.steps.map((s, i) => (
            <div key={i} className="flex gap-2">
              <span className="font-mono text-blue-800">{s.date}</span>
              <span>{s.action}</span>
              <span className="text-gray-500">×{s.quantity}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
