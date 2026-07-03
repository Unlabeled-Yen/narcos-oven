/**
 * 匯入異動摘要頁——強制彈出、雇主必須拍板完消失/變動桶才能繼續。
 * 對應 docs/spec.md §7 UI + 憲章防護 #6 + #9 + #10
 */
import { useEffect, useState } from "react";
import type { ImportDiff, ImportResolution, ImportRun, Order } from "../domain/models";
import { addResolution } from "../db/import-runs";
import { resolveDisappearance } from "../db/orders";
import { db } from "../db/schema";

export function ImportSummaryModal({
  run,
  onClose,
}: {
  run: ImportRun;
  onClose: () => void;
}) {
  const [resolutions, setResolutions] = useState<Record<string, ImportResolution["resolution"]>>({});
  const [disappearedOrders, setDisappearedOrders] = useState<Order[]>([]);
  const [changedOrders, setChangedOrders] = useState<Order[]>([]);

  useEffect(() => {
    void (async () => {
      const dOrders = await db.orders.where("id").anyOf(run.diff.disappeared).toArray();
      const cOrders = await db.orders.where("id").anyOf(run.diff.fields_changed).toArray();
      setDisappearedOrders(dOrders);
      setChangedOrders(cOrders);
    })();
  }, [run.id]);

  const needsResolution =
    run.diff.disappeared.length + run.diff.fields_changed.length;
  const resolvedCount = Object.keys(resolutions).length;
  const canClose = resolvedCount >= needsResolution;

  async function decide(
    orderId: string,
    resolution: ImportResolution["resolution"]
  ) {
    setResolutions((r) => ({ ...r, [orderId]: resolution }));
    const now = new Date().toISOString();
    await addResolution(run.id, {
      order_id: orderId,
      resolution,
      resolved_at: now,
    });
    if (resolution === "shipped" || resolution === "canceled" || resolution === "kept_active") {
      await resolveDisappearance(orderId, resolution, now);
    }
    // change_pending 的 accept_change / reject_change / reprint 之後由專屬 UI 處理
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">📥 匯入異動摘要</h2>
          <button
            disabled={!canClose}
            onClick={onClose}
            className={`px-4 py-2 rounded text-sm font-semibold ${
              canClose
                ? "bg-green-600 hover:bg-green-700 text-white"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
            title={canClose ? "全部處理完、送出" : `還有 ${needsResolution - resolvedCount} 筆待拍板`}
          >
            {canClose
              ? "✅ 送出、更新系統"
              : `⏳ 剩 ${needsResolution - resolvedCount} 筆需處理`}
          </button>
        </div>

        <div className="p-4 space-y-6">
          <StatSection diff={run.diff} />

          {disappearedOrders.length > 0 && (
            <DisappearedSection
              orders={disappearedOrders}
              resolutions={resolutions}
              onDecide={decide}
            />
          )}

          {changedOrders.length > 0 && (
            <ChangedSection
              orders={changedOrders}
              resolutions={resolutions}
              onDecide={decide}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StatSection({ diff }: { diff: ImportDiff }) {
  const cells = [
    { label: "➕ 新單", n: diff.added.length, color: "bg-blue-100 text-blue-900" },
    { label: "💰 剛付款", n: diff.payment_confirmed.length, color: "bg-green-100 text-green-900" },
    { label: "📝 資訊變動", n: diff.fields_changed.length, color: "bg-yellow-100 text-yellow-900" },
    { label: "❓ 消失", n: diff.disappeared.length, color: "bg-red-100 text-red-900" },
    { label: "⚡ 未動", n: diff.unchanged.length, color: "bg-gray-100 text-gray-900" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
      {cells.map((c) => (
        <div key={c.label} className={`rounded p-3 ${c.color}`}>
          <div className="text-xs opacity-75">{c.label}</div>
          <div className="text-2xl font-bold">{c.n}</div>
        </div>
      ))}
    </div>
  );
}

const CHANNEL_BADGE: Record<string, { label: string; color: string }> = {
  賣貨便: { label: "🛒 賣貨便", color: "bg-blue-100 text-blue-900" },
  面交_中壢: { label: "🤝 面交 中壢", color: "bg-emerald-100 text-emerald-900" },
  面交_台中: { label: "🤝 面交 台中", color: "bg-emerald-100 text-emerald-900" },
  面交_其他: { label: "🤝 面交 其他", color: "bg-emerald-100 text-emerald-900" },
  宅配: { label: "📦 宅配", color: "bg-purple-100 text-purple-900" },
  KOL: { label: "⭐ KOL", color: "bg-amber-100 text-amber-900" },
  待分類: { label: "❓ 待分類", color: "bg-gray-200 text-gray-900" },
};

function DisappearedSection({
  orders,
  resolutions,
  onDecide,
}: {
  orders: Order[];
  resolutions: Record<string, ImportResolution["resolution"]>;
  onDecide: (id: string, r: ImportResolution["resolution"]) => void;
}) {
  const unresolved = orders.filter((o) => !resolutions[o.id]);
  // 用 useState 記待確認的批次動作、不再依賴 window.confirm（會被 Chrome 阻擋）
  const [pendingBulk, setPendingBulk] = useState<null | "shipped" | "canceled" | "kept_active">(null);
  const [busyBulk, setBusyBulk] = useState(false);
  const bulkResolve = (r: "shipped" | "canceled" | "kept_active") => setPendingBulk(r);
  const confirmBulk = async () => {
    if (!pendingBulk || busyBulk) return;
    setBusyBulk(true);
    try {
      for (const o of unresolved) {
        await onDecide(o.id, pendingBulk);
      }
    } finally {
      setBusyBulk(false);
      setPendingBulk(null);
    }
  };
  const pendingLabel = pendingBulk === "shipped" ? "已出貨" : pendingBulk === "canceled" ? "已取消" : pendingBulk === "kept_active" ? "暫留" : "";
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-red-700">
          ❓ 消失待確認（{orders.length} 筆）—— 憲章 #9 必須逐一拍板
        </h3>
        {unresolved.length > 1 && !pendingBulk && (
          <div className="flex gap-1 text-xs">
            <span className="text-gray-500 mr-1 self-center">批次處理剩餘 {unresolved.length}：</span>
            <button
              onClick={() => bulkResolve("shipped")}
              className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              全部已出貨
            </button>
            <button
              onClick={() => bulkResolve("canceled")}
              className="px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700"
            >
              全部取消
            </button>
            <button
              onClick={() => bulkResolve("kept_active")}
              className="px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              全部暫留
            </button>
          </div>
        )}
        {pendingBulk && (
          <div className="flex gap-2 items-center text-xs bg-yellow-100 border border-yellow-400 px-3 py-2 rounded">
            <span className="text-gray-800">
              ⚠ 將剩下 {unresolved.length} 筆全部標為「<strong>{pendingLabel}</strong>」？
            </span>
            <button
              onClick={() => void confirmBulk()}
              disabled={busyBulk}
              className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-60"
            >
              {busyBulk ? "處理中…" : "確認"}
            </button>
            <button
              onClick={() => setPendingBulk(null)}
              disabled={busyBulk}
              className="px-3 py-1 bg-gray-300 text-gray-800 rounded hover:bg-gray-400"
            >
              取消
            </button>
          </div>
        )}
      </div>
      <div className="space-y-2">
        {orders.map((o) => {
          const decision = resolutions[o.id];
          const frozen = o.frozen_after_label_print;
          const chanBadge = CHANNEL_BADGE[o.channel] ?? {
            label: o.channel,
            color: "bg-gray-100 text-gray-900",
          };
          return (
            <div
              key={o.id}
              className={`border rounded p-3 ${decision ? "bg-gray-50 opacity-60" : "bg-white"}`}
            >
              <div className="flex items-start justify-between text-sm">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded font-semibold ${chanBadge.color}`}>
                      {chanBadge.label}
                    </span>
                    <span className="font-mono text-xs">{o.id}</span>
                    <span>{o.recipient.name ?? "—"}</span>
                    {frozen && (
                      <span className="text-xs bg-orange-100 text-orange-900 rounded px-1">
                        🖨️ 已印標籤
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 ml-1">
                    {o.batchDate ?? "?"} / ${o.revenue.grossTotal}
                    {o.rawSource.file && (
                      <span className="ml-2">
                        來源: <span className="font-mono">{o.rawSource.file}</span>
                      </span>
                    )}
                  </div>
                </div>
                {decision ? (
                  <span className="text-xs bg-green-100 text-green-900 px-2 py-1 rounded">
                    {decision === "shipped" ? "✅ 已出貨" : decision === "canceled" ? "❌ 已取消" : "⏸ 暫留"}
                  </span>
                ) : (
                  <div className="flex gap-1">
                    <button
                      onClick={() => onDecide(o.id, "shipped")}
                      className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                    >
                      1 已出貨
                    </button>
                    <button
                      onClick={() => onDecide(o.id, "canceled")}
                      className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                    >
                      2 已取消
                    </button>
                    <button
                      onClick={() => onDecide(o.id, "kept_active")}
                      className="px-3 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-600"
                    >
                      3 暫留
                    </button>
                  </div>
                )}
              </div>
              {frozen && !decision && (
                <div className="mt-2 text-xs text-orange-800 bg-orange-50 rounded p-2">
                  ⚠️ 這筆標籤已印。取消時需重印同批其他單、或整批重印。
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ChangedSection({
  orders,
  resolutions,
  onDecide,
}: {
  orders: Order[];
  resolutions: Record<string, ImportResolution["resolution"]>;
  onDecide: (id: string, r: ImportResolution["resolution"]) => void;
}) {
  const unresolved = orders.filter((o) => !resolutions[o.id]);
  const [pendingBulk, setPendingBulk] = useState<null | "accept_change" | "reject_change">(null);
  const [busyBulk, setBusyBulk] = useState(false);
  const bulkResolve = (r: "accept_change" | "reject_change") => setPendingBulk(r);
  const confirmBulk = async () => {
    if (!pendingBulk || busyBulk) return;
    setBusyBulk(true);
    try {
      for (const o of unresolved) {
        await onDecide(o.id, pendingBulk);
      }
    } finally {
      setBusyBulk(false);
      setPendingBulk(null);
    }
  };
  const pendingLabel = pendingBulk === "accept_change" ? "接受變動" : pendingBulk === "reject_change" ? "保留舊資料" : "";
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-yellow-800">
          📝 資訊變動待確認（{orders.length} 筆）—— 憲章 #10 不 auto-overwrite
        </h3>
        {unresolved.length > 1 && !pendingBulk && (
          <div className="flex gap-1 text-xs">
            <span className="text-gray-500 mr-1 self-center">批次處理剩餘 {unresolved.length}：</span>
            <button
              onClick={() => bulkResolve("accept_change")}
              className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              全部接受
            </button>
            <button
              onClick={() => bulkResolve("reject_change")}
              className="px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              全部保留舊
            </button>
          </div>
        )}
        {pendingBulk && (
          <div className="flex gap-2 items-center text-xs bg-yellow-100 border border-yellow-400 px-3 py-2 rounded">
            <span className="text-gray-800">
              ⚠ 將剩下 {unresolved.length} 筆全部標為「<strong>{pendingLabel}</strong>」？
            </span>
            <button
              onClick={() => void confirmBulk()}
              disabled={busyBulk}
              className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-60"
            >
              {busyBulk ? "處理中…" : "確認"}
            </button>
            <button
              onClick={() => setPendingBulk(null)}
              disabled={busyBulk}
              className="px-3 py-1 bg-gray-300 text-gray-800 rounded hover:bg-gray-400"
            >
              取消
            </button>
          </div>
        )}
      </div>
      <div className="space-y-2">
        {orders.map((o) => {
          const decision = resolutions[o.id];
          const lastChange = o.changes[o.changes.length - 1];
          if (!lastChange) return null;
          const chanBadge = CHANNEL_BADGE[o.channel] ?? {
            label: o.channel,
            color: "bg-gray-100 text-gray-900",
          };
          return (
            <div
              key={o.id}
              className={`border rounded p-3 ${decision ? "bg-gray-50 opacity-60" : "bg-white"}`}
            >
              <div className="flex items-start justify-between text-sm mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded font-semibold ${chanBadge.color}`}>
                    {chanBadge.label}
                  </span>
                  <span className="font-mono text-xs">{o.id}</span>
                  <span>{o.recipient.name ?? "—"}</span>
                </div>
                {decision ? (
                  <span className="text-xs bg-green-100 text-green-900 px-2 py-1 rounded">
                    {decision === "accept_change" ? "✅ 接受" : decision === "reject_change" ? "❌ 保留舊" : "🖨️ 重印"}
                  </span>
                ) : (
                  <div className="flex gap-1">
                    <button
                      onClick={() => onDecide(o.id, "accept_change")}
                      className="px-3 py-1 bg-blue-600 text-white text-xs rounded"
                    >
                      1 接受變動
                    </button>
                    <button
                      onClick={() => onDecide(o.id, "reject_change")}
                      className="px-3 py-1 bg-gray-500 text-white text-xs rounded"
                    >
                      2 保留舊
                    </button>
                    {o.frozen_after_label_print && (
                      <button
                        onClick={() => onDecide(o.id, "reprint")}
                        className="px-3 py-1 bg-orange-600 text-white text-xs rounded"
                      >
                        3 接受+重印
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-red-50 rounded p-2">
                  <div className="font-semibold text-red-800">舊值</div>
                  {Object.entries(lastChange.fields).map(([k, v]) => (
                    <div key={k}>
                      <span className="text-gray-500">{k}:</span>{" "}
                      <span className="font-mono">{String(v.from)}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-green-50 rounded p-2">
                  <div className="font-semibold text-green-800">新值</div>
                  {Object.entries(lastChange.fields).map(([k, v]) => (
                    <div key={k}>
                      <span className="text-gray-500">{k}:</span>{" "}
                      <span className="font-mono">{String(v.to)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
