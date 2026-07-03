/**
 * BatchDetail — 出爐批次明細（產能檢核 / 工時分解 / 備料原子總量）
 *
 * 用途：排程完畢、開始製作前，讓雇主一次核對當週工作內容、對貨用。
 * 因此掛在「出貨標籤」頁頂端，跟印標籤流程串在一起。
 *
 * 元件從 SchedulePage.tsx 抽出、行為不變。
 */
import type { Menu, Order } from "../../domain/models";
import { getDisplayName } from "../../domain/menu";
import {
  accumulateAtoms,
  batchesAndHoursForAtom,
  calculateBatchHours,
} from "../../domain/production-time";

const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
} as const;

const WD = ["日", "一", "二", "三", "四", "五", "六"];

function mdOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

// ── 完整 panel：頭 + 警示膠帶 + 三欄 ──────────────────────────
export function BatchDetailPanel({
  shipISO,
  shipList,
  pendingCount,
  menu,
}: {
  shipISO: string;
  shipList: Order[];
  pendingCount: number;
  menu: Menu;
}) {
  return (
    <div style={{ background: "#0F0F12", border: "1px solid #26262C" }}>
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, padding: "16px 20px 12px" }}>
        <div className="flex items-baseline flex-wrap" style={{ gap: 12 }}>
          <span style={{ fontFamily: F.anton, fontSize: 22, color: "var(--acc,#F5D400)" }}>
            {mdOf(shipISO).replace("/", " / ")}
          </span>
          <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: "#F5F4EF" }}>
            出爐批次明細
          </span>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: "#7A7A82" }}>
            {WD[new Date(shipISO).getDay()]} · {shipList.length} 單 · 排程完 → 對貨 → 印標
          </span>
        </div>
        <span
          style={{
            fontFamily: F.tc,
            fontWeight: 900,
            fontSize: 12,
            color: "#111",
            background: pendingCount === 0 ? "#43B23C" : "#E5622A",
            padding: "6px 12px",
          }}
        >
          {pendingCount === 0 ? "✓ 待排已清空 · 可產出" : `⚠ ${pendingCount} 單待排`}
        </span>
      </div>
      <div style={{ height: 7, background: "repeating-linear-gradient(45deg,var(--acc,#F5D400) 0 14px,#111 14px 28px)" }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16, padding: 16 }}>
        <BatchCapacity shipList={shipList} menu={menu} />
        <BatchHours shipList={shipList} menu={menu} />
        <BatchAtoms shipList={shipList} menu={menu} />
      </div>
    </div>
  );
}

// ── 當日產能檢核 ─────────────────────────────────────────────
function BatchCapacity({ shipList, menu }: { shipList: Order[]; menu: Menu }) {
  const totals = accumulateAtoms(shipList);
  const caps = menu.production_capacity?.daily_max_by_atom ?? {};
  const rows = [...totals.entries()].filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return (
    <div>
      <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".14em", marginBottom: 10 }}>當日產能檢核</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, fontFamily: F.mono, fontSize: 11 }}>
        {rows.length === 0 && <span style={{ color: "#6C6C74" }}>本批尚無訂單</span>}
        {rows.map(([atom, qty]) => {
          const cap = caps[atom] ?? 0;
          const pct = cap > 0 ? Math.min(100, (qty / cap) * 100) : 0;
          const over = cap > 0 && qty > cap;
          const near = cap > 0 && qty / cap >= 0.8;
          const col = over ? "#E5352B" : near ? "#E5622A" : "#43B23C";
          return (
            <div key={atom} className="flex items-center" style={{ gap: 10 }}>
              <span style={{ width: 64, fontFamily: F.tc, fontWeight: 700, color: "#C9C9CF" }}>{getDisplayName(atom, menu)}</span>
              <div style={{ flex: 1, height: 12, background: "#161619" }}>
                <div style={{ width: `${pct}%`, height: 12, background: col }} />
              </div>
              <span style={{ width: 60, textAlign: "right", color: col }}>{qty}{cap ? `/${cap}` : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 工時分解 ────────────────────────────────────────────────
function BatchHours({ shipList, menu }: { shipList: Order[]; menu: Menu }) {
  const totals = accumulateAtoms(shipList);
  const rows = [...totals.entries()]
    .map(([atom, qty]) => ({ atom, ...batchesAndHoursForAtom(atom, qty, menu) }))
    .filter((r) => r.hours > 0)
    .sort((a, b) => b.hours - a.hours);
  const total = calculateBatchHours(totals, menu);
  return (
    <div>
      <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".14em", marginBottom: 10 }}>工時分解 · {total}h</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: F.mono, fontSize: 11 }}>
        {rows.length === 0 && <span style={{ color: "#6C6C74" }}>—</span>}
        {rows.map((r) => (
          <div key={r.atom} className="flex justify-between" style={{ padding: "6px 10px", background: "#161619" }}>
            <span style={{ color: "#C9C9CF" }}>{getDisplayName(r.atom, menu)} · {Math.ceil(r.batches)} 爐</span>
            <span style={{ color: "#F5F4EF", fontWeight: 700 }}>{(r.hours + r.washMoldHours).toFixed(1)}h</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 備料原子總量 ────────────────────────────────────────────
function BatchAtoms({ shipList, menu }: { shipList: Order[]; menu: Menu }) {
  const totals = accumulateAtoms(shipList);
  const rows = [...totals.entries()].filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".14em", marginBottom: 10 }}>
        備料原子總量 <span style={{ color: "#4a4a52" }}>· 配方待雇主補(R3-4)</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: F.mono, fontSize: 12 }}>
        {rows.length === 0 && <span style={{ color: "#6C6C74" }}>—</span>}
        {rows.map(([atom, qty]) => (
          <div key={atom} className="flex justify-between" style={{ padding: "7px 11px", background: "#161619" }}>
            <span style={{ color: "#C9C9CF" }}>{getDisplayName(atom, menu)}</span>
            <span style={{ color: "#F5F4EF", fontWeight: 700 }}>{qty}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
