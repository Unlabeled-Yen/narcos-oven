/**
 * OrdersPage 的訂單狀態列 + #10 批次改狀態浮動列 + 小型展示元件。
 * 拆出來是為了讓 OrdersPage.tsx 維持在 500 行以內（CLAUDE.md 規範）。
 */
import { F, statusLabel } from "./OrdersPage.helpers";
import type { Order, OrderStatus } from "../../domain/models";

// ── Filter chip ────────────────────────────────────────────────
export function FilterChip({
  label, count, active, activeColor, onClick,
}: {
  label: string; count: number; active: boolean; activeColor: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: F.tc, fontWeight: 700, fontSize: 12,
        color: active ? "#111" : "#9A9AA2",
        background: active ? activeColor : "transparent",
        border: `1px solid ${active ? activeColor : "#3a3a40"}`,
        padding: "5px 12px", cursor: "pointer", borderRadius: 0,
        display: "inline-flex", alignItems: "center", gap: 5,
      }}
    >
      {label}
      <span style={{ fontFamily: F.mono, fontSize: 10, opacity: 0.75 }}>{count}</span>
    </button>
  );
}

// ── #10 表頭全選 checkbox（含 indeterminate）─────────────────────
export function SelectAllCheckbox({
  ids,
  selectedIds,
  onChange,
}: {
  ids: string[];
  selectedIds: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
  const someSelected = ids.some((id) => selectedIds.has(id));
  return (
    <input
      type="checkbox"
      checked={allSelected}
      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
      onChange={(e) => onChange(e.target.checked ? new Set(ids) : new Set())}
      title="全選目前篩選結果"
      style={{ cursor: "pointer" }}
    />
  );
}

// ── 訂單狀態列（預設鎖定 · 點鎖 icon 解鎖後可改）─────────────────
const STATUS_OPTIONS: OrderStatus[] = [
  "confirmed",
  "shipped",
  "canceled",
  "kol_shipped",
  "disappeared_pending_resolution",
  "voided",
];

export function StatusCell({
  order,
  ss,
  unlocked,
  onToggleLock,
  onChange,
}: {
  order: Order;
  ss: { color: string; bg: string };
  unlocked: boolean;
  onToggleLock: () => void;
  onChange: (next: OrderStatus) => void;
}) {
  // 包含當前 status（就算不在常用清單也顯示）
  const options = STATUS_OPTIONS.includes(order.status)
    ? STATUS_OPTIONS
    : [order.status, ...STATUS_OPTIONS];
  return (
    <span style={{ textAlign: "right", display: "inline-flex", gap: 4, justifyContent: "flex-end", alignItems: "center" }}>
      {unlocked ? (
        <select
          value={order.status}
          onChange={(e) => onChange(e.target.value as OrderStatus)}
          style={{
            fontFamily: F.tc, fontWeight: 700, fontSize: 10, color: ss.color,
            background: "#0A0A0C", border: `1px solid ${ss.color}`,
            padding: "2px 6px", cursor: "pointer",
          }}
        >
          {options.map((s) => (
            <option key={s} value={s} style={{ background: "#0A0A0C", color: "#F5F4EF" }}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
      ) : (
        <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 10, color: ss.color, background: ss.bg, padding: "3px 8px", whiteSpace: "nowrap" }}>
          {statusLabel(order.status)}
        </span>
      )}
      <button
        type="button"
        onClick={onToggleLock}
        title={unlocked ? "鎖回 · 防手殘" : "解鎖 · 允許改狀態"}
        style={{
          fontFamily: F.mono, fontSize: 10,
          color: unlocked ? "#F5D400" : "#6C6C74",
          background: "transparent", border: "none",
          padding: "2px 4px", cursor: "pointer", lineHeight: 1,
        }}
      >
        {unlocked ? "🔓" : "🔒"}
      </button>
    </span>
  );
}

// ── #10 批次改狀態：浮動 action bar ──────────────────────────────
const BATCH_STATUS_OPTIONS: OrderStatus[] = [
  "confirmed",
  "shipped",
  "canceled",
  "kol_shipped",
  "disappeared_pending_resolution",
];

export function BatchActionBar({
  selectedCount,
  pendingStatus,
  onPendingStatusChange,
  onApply,
  onClear,
  applying,
}: {
  selectedCount: number;
  pendingStatus: OrderStatus;
  onPendingStatusChange: (s: OrderStatus) => void;
  onApply: () => void;
  onClear: () => void;
  applying: boolean;
}) {
  if (selectedCount === 0) return null;
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 16px", background: "#1c1600",
        border: "1px solid var(--acc,#F5D400)", borderLeft: "3px solid var(--acc,#F5D400)",
        flexShrink: 0,
      }}
    >
      <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "var(--acc,#F5D400)" }}>
        已選 {selectedCount} 筆
      </span>
      <span style={{ fontFamily: F.mono, fontSize: 11, color: "#9A9AA2" }}>→ 設為</span>
      <select
        value={pendingStatus}
        onChange={(e) => onPendingStatusChange(e.target.value as OrderStatus)}
        style={{
          fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#F5F4EF",
          background: "#0A0A0C", border: "1px solid #3a3a40", padding: "5px 10px", cursor: "pointer",
        }}
      >
        {BATCH_STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>{statusLabel(s)}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={onApply}
        disabled={applying}
        style={{
          fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: "#111",
          background: "var(--acc,#F5D400)", border: "none",
          padding: "6px 16px", cursor: applying ? "wait" : "pointer",
          opacity: applying ? 0.6 : 1,
        }}
      >
        {applying ? "套用中…" : "套用"}
      </button>
      <button
        type="button"
        onClick={onClear}
        style={{
          fontFamily: F.mono, fontSize: 11, color: "#8A8A93",
          background: "transparent", border: "none", cursor: "pointer",
        }}
      >
        取消選取
      </button>
    </div>
  );
}
