/**
 * OrdersPage 的 #8「找重複」浮動面板 + 復原 button。
 * 拆出來是為了讓 OrdersPage.tsx 維持在 500 行以內（CLAUDE.md 規範）。
 */
import { useMemo, useState } from "react";
import { F, statusLabel } from "./OrdersPage.helpers";
import { findDuplicateGroups } from "../../domain/duplicate-detection";
import { planVoidOrder, planRestoreOrder } from "../../domain/order-edit";
import { db } from "../../db/schema";
import type { Order } from "../../domain/models";

/**
 * #8：作廢/復原/找重複的操作邏輯，從 OrdersPage.tsx 抽出來維持 500 行以內。
 */
export function useVoidActions(
  orders: Order[],
  refreshOrders: () => Promise<void>,
  setMsg: (m: { ok: boolean; text: string } | null) => void
) {
  const [dupPanelOpen, setDupPanelOpen] = useState(false);

  async function restoreOrder(id: string) {
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    const plan = planRestoreOrder(o, new Date().toISOString());
    if (!plan.ok) {
      setMsg({ ok: false, text: `❌ ${plan.error}` });
      return;
    }
    await db.orders.update(id, { status: plan.order.status, last_seen_at: plan.order.last_seen_at, changes: plan.order.changes });
    await refreshOrders();
    setMsg({ ok: true, text: `✓ 已復原為 ${statusLabel(plan.order.status)}` });
  }

  async function voidSelectedFromDuplicates(ids: string[]) {
    const now = new Date().toISOString();
    for (const id of ids) {
      const o = orders.find((x) => x.id === id);
      if (!o) continue;
      const plan = planVoidOrder(o, now);
      if (!plan.ok) continue;
      await db.orders.update(id, { status: plan.order.status, last_seen_at: plan.order.last_seen_at, changes: plan.order.changes });
    }
    await refreshOrders();
    setMsg({ ok: true, text: `✓ 已作廢 ${ids.length} 筆重複訂單（可在「作廢」篩選頁復原）` });
    setDupPanelOpen(false);
  }

  return { dupPanelOpen, setDupPanelOpen, restoreOrder, voidSelectedFromDuplicates };
}

export function FindDuplicatesButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#F5F4EF", background: "#1c1600", border: "1px solid var(--acc,#F5D400)", padding: "8px 14px", cursor: "pointer" }}
    >
      🔍 找重複
    </button>
  );
}

export function RestoreButton({ onRestore }: { onRestore: () => void }) {
  return (
    <button
      type="button"
      onClick={onRestore}
      title="復原到作廢前的狀態"
      style={{
        fontFamily: F.mono, fontSize: 10, color: "#43B23C",
        background: "transparent", border: "1px solid #43B23C",
        padding: "2px 8px", cursor: "pointer",
      }}
    >
      ↩ 復原
    </button>
  );
}

export function DuplicatePanel({
  orders,
  onVoidSelected,
  onClose,
}: {
  orders: Order[];
  onVoidSelected: (ids: string[]) => void;
  onClose: () => void;
}) {
  const groups = useMemo(() => findDuplicateGroups(orders), [orders]);
  const byId = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 50, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 20px", overflowY: "auto" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#111114", border: "1px solid #3a3a40", width: 720, maxWidth: "100%", padding: 20 }}
      >
        <div className="flex items-baseline justify-between" style={{ marginBottom: 12 }}>
          <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 16, color: "#F5F4EF" }}>
            找重複 · 共 {groups.length} 組可疑
          </span>
          <button type="button" onClick={onClose} style={{ fontFamily: F.mono, fontSize: 13, color: "#8A8A93", background: "transparent", border: "none", cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: "#7A7A82", marginBottom: 14 }}>
          同通路 + 同收件人 + 同品項組合 + 同下單日才判定可疑；不自動刪，勾選要作廢的那筆再送出。
        </div>
        {groups.length === 0 ? (
          <div style={{ fontFamily: F.mono, fontSize: 12, color: "#6C6C74", padding: "20px 0", textAlign: "center" }}>
            沒有找到可疑的重複組
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 420, overflowY: "auto" }}>
            {groups.map((g) => (
              <div key={g.key} style={{ border: "1px solid #26262C", padding: 10 }}>
                {g.orderIds.map((id) => {
                  const o = byId.get(id);
                  if (!o) return null;
                  return (
                    <label key={id} className="flex items-center" style={{ gap: 8, padding: "4px 0", cursor: "pointer" }}>
                      <input type="checkbox" checked={checked.has(id)} onChange={() => toggle(id)} />
                      <span style={{ fontFamily: F.mono, fontSize: 11, color: "#C9C9CF" }}>{id}</span>
                      <span style={{ fontFamily: F.tc, fontSize: 12, color: "#F5F4EF" }}>{o.recipient.name ?? "—"}</span>
                      <span style={{ fontFamily: F.mono, fontSize: 11, color: "#8A8A93" }}>{o.order_date}</span>
                      <span style={{ fontFamily: F.mono, fontSize: 11, color: "#8A8A93" }}>${o.revenue.grossTotal}</span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {groups.length > 0 && (
          <button
            type="button"
            disabled={checked.size === 0}
            onClick={() => { onVoidSelected([...checked]); setChecked(new Set()); }}
            style={{
              marginTop: 14, fontFamily: F.tc, fontWeight: 900, fontSize: 12,
              color: "#111", background: checked.size === 0 ? "#3a3a40" : "var(--acc,#F5D400)",
              border: "none", padding: "8px 16px", cursor: checked.size === 0 ? "not-allowed" : "pointer",
            }}
          >
            作廢已選 {checked.size} 筆
          </button>
        )}
      </div>
    </div>
  );
}
