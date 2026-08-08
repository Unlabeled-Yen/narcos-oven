/**
 * #8 訂單可編輯架構 · 單筆編輯 modal — 出貨批次 / 收件人 / 品項數量 / 金額。
 * 拆出來是為了讓 OrdersPage.tsx 維持在 500 行以內（CLAUDE.md 規範）。
 */
import { useState } from "react";
import { F } from "./OrdersPage.helpers";
import { planManualEdit, type ManualEditInput } from "../../domain/order-edit";
import { db } from "../../db/schema";
import type { Order } from "../../domain/models";

const inputStyle = {
  fontFamily: F.mono, fontSize: 12, color: "#E7E7EA",
  background: "#0A0A0C", border: "1px solid #3a3a40",
  padding: "6px 10px", width: "100%", outline: "none",
} as const;

export function useEditModal(refreshOrders: () => Promise<void>, setMsg: (m: { ok: boolean; text: string } | null) => void) {
  const [editing, setEditing] = useState<Order | null>(null);

  async function save(order: Order, edits: ManualEditInput) {
    const plan = planManualEdit(order, edits, new Date().toISOString());
    if (!plan.ok) {
      setMsg({ ok: false, text: `❌ ${plan.error}` });
      return;
    }
    if (plan.change) {
      await db.orders.update(order.id, {
        batchDate: plan.order.batchDate,
        recipient: plan.order.recipient,
        revenue: plan.order.revenue,
        items: plan.order.items,
        last_seen_at: plan.order.last_seen_at,
        changes: plan.order.changes,
      });
      await refreshOrders();
      setMsg({ ok: true, text: "✓ 已儲存編輯" });
    }
    setEditing(null);
  }

  return { editing, setEditing, save };
}

export function EditModal({ order, onSave, onClose }: { order: Order; onSave: (edits: ManualEditInput) => void; onClose: () => void }) {
  const [batchDate, setBatchDate] = useState(order.batchDate ?? "");
  const [recipientName, setRecipientName] = useState(order.recipient.name ?? "");
  const [grossTotal, setGrossTotal] = useState(String(order.revenue.grossTotal));
  const [qty, setQty] = useState(String(order.items[0]?.quantity ?? 1));

  function handleSave() {
    const first = order.items[0];
    // atoms[].count 是「已乘上 quantity 的總數」（見 accumulateAtoms），改數量要按比例縮放，
    // 不然工單/BOM 的顆數統計會用到舊數字、跟畫面上的新數量對不上（靜默失效）。
    const newQty = Number(qty);
    const items = first
      ? [
          {
            ...first,
            quantity: newQty,
            atoms: first.atoms.map((a) => ({
              ...a,
              count: first.quantity > 0 ? Math.round((a.count / first.quantity) * newQty) : a.count,
            })),
          },
          ...order.items.slice(1),
        ]
      : order.items;
    onSave({
      batchDate: batchDate.trim() === "" ? null : batchDate.trim(),
      recipientName,
      grossTotal: Number(grossTotal),
      items,
    });
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#111114", border: "1px solid #3a3a40", width: 420, padding: 20 }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: "#F5F4EF" }}>編輯訂單 · {order.id}</span>
          <button type="button" onClick={onClose} style={{ fontFamily: F.mono, fontSize: 13, color: "#8A8A93", background: "transparent", border: "none", cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", marginBottom: 3 }}>出貨批次（留空 = 待排）</div>
            <input style={inputStyle} value={batchDate} onChange={(e) => setBatchDate(e.target.value)} placeholder="YYYY-MM-DD" />
          </label>
          <label>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", marginBottom: 3 }}>收件人姓名</div>
            <input style={inputStyle} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
          </label>
          {order.items.length > 0 && (
            <label>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", marginBottom: 3 }}>{order.items[0]!.rawName} 數量</div>
              <input style={inputStyle} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
          )}
          <label>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", marginBottom: 3 }}>金額</div>
            <input style={inputStyle} type="number" min={0} value={grossTotal} onChange={(e) => setGrossTotal(e.target.value)} />
          </label>
        </div>
        <button
          type="button"
          onClick={handleSave}
          style={{ marginTop: 16, width: "100%", fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#111", background: "var(--acc,#F5D400)", border: "none", padding: "10px 0", cursor: "pointer" }}
        >
          儲存
        </button>
      </div>
    </div>
  );
}
