/**
 * BatchDetail — 出貨批次明細（顆數統計 / 備料原子總量）
 *
 * Yen 2026-07-03 決策：拿掉工時分解、當日產能檢核 vs 上限比對
 * 保留：當日顆數統計、備料原子總量（純顆數、給雇主人工評估）
 *
 * 用途：排程完畢、開始製作前，讓雇主一次核對當週工作內容、對貨用。
 * 掛在「出貨標籤」頁頂端，跟印標籤流程串在一起。
 */
import type { Menu, Order } from "../../domain/models";
import { getDisplayName } from "../../domain/menu";
import { accumulateAtoms } from "../../domain/production-time";

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

// ── 完整 panel：頭 + 警示膠帶 + 兩欄 ──────────────────────────
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
    <div className="batch-detail-panel" style={{ background: "#0F0F12", border: "1px solid #26262C" }}>
      {/* Print CSS · 出貨對帳單專用：只印 batch header + 訂單 table · 其他隱藏 */}
      <style>{`
        @media print {
          nav, .no-print, .labels-preview { display: none !important; }
          body { background: #fff !important; color: #000 !important; }
          .batch-detail-panel, .batch-detail-panel * {
            background: transparent !important; color: #000 !important; border-color: #000 !important;
          }
          .batch-detail-panel table th, .batch-detail-panel table td {
            border-bottom: 1px solid #000 !important;
          }
          .batch-detail-panel { border: 1px solid #000 !important; }
        }
      `}</style>
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, padding: "16px 20px 12px" }}>
        <div className="flex items-baseline flex-wrap" style={{ gap: 12 }}>
          <span style={{ fontFamily: F.anton, fontSize: 22, color: "var(--acc,#F5D400)" }}>
            {mdOf(shipISO).replace("/", " / ")}
          </span>
          <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: "#F5F4EF" }}>
            出貨批次明細
          </span>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: "#7A7A82" }}>
            {WD[new Date(shipISO).getDay()]} · {shipList.length} 單 · 排程完 → 對貨 → 印標
          </span>
        </div>
        <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
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
          <button
            type="button"
            onClick={() => window.print()}
            className="no-print"
            title="列印本批出貨對帳單 · 給出貨人員對貨用"
            style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 11, color: "#111", background: "var(--acc,#F5D400)", border: "none", padding: "6px 12px", cursor: "pointer", letterSpacing: ".06em" }}
          >
            🖨 列印對帳單
          </button>
        </div>
      </div>
      <div style={{ height: 7, background: "repeating-linear-gradient(45deg,var(--acc,#F5D400) 0 14px,#111 14px 28px)" }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16, padding: 16 }}>
        <BatchAtomsCount shipList={shipList} menu={menu} />
        <BatchAtomsPreparation shipList={shipList} menu={menu} />
      </div>
      {/* Yen 2026-07-03：出貨人員對帳用訂單詳情 table · 每批貨來自哪張訂單 · 物流/通路/標籤 */}
      <BatchOrdersTable shipList={shipList} menu={menu} />
    </div>
  );
}

// ── 訂單詳情 table：出貨人員對帳 · 通路 / 收件 / 物流 / 品項 / 標籤 ──
function shipmentInfoOf(o: Order): string {
  if (o.channel === "賣貨便") return o.recipient.convStore ?? "—";
  if (o.channel === "宅配") return o.recipient.address ?? "—";
  if (o.channel.startsWith("面交")) {
    // 面交_中壢 → 中壢面交
    const loc = o.channel.replace(/^面交_/, "");
    return `${loc}面交`;
  }
  if (o.channel === "KOL") return o.recipient.address ?? o.recipient.igOrLine ?? "—";
  return "—";
}
function itemsSummary(o: Order, menu: Menu): string {
  if (o.items.length === 0) return "—";
  return o.items
    .map((it) => {
      const name = it.productSkuId ? (menu.products[it.productSkuId]?.display_name ?? it.rawName) : it.rawName;
      return `${name}×${it.quantity}`;
    })
    .join(" · ");
}
function BatchOrdersTable({ shipList, menu }: { shipList: Order[]; menu: Menu }) {
  if (shipList.length === 0) return null;
  const rows = [...shipList].sort((a, b) => a.channel.localeCompare(b.channel));
  const totalLabels = rows.reduce((s, o) => s + (o.labelCount ?? 0), 0);
  return (
    <div style={{ borderTop: "1px solid #26262C", padding: "12px 16px 16px" }}>
      <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 10, marginBottom: 10 }}>
        <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".14em" }}>
          訂單詳情 · 出貨對帳用 · {rows.length} 單 · 共 {totalLabels} 張標籤
        </div>
      </div>
      <div className="batch-orders-table" style={{ background: "#141417", border: "1px solid #26262C", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: F.mono, fontSize: 11, color: "#E7E7EA" }}>
          <thead>
            <tr style={{ background: "#0F0F12", color: "#8A8A93", letterSpacing: ".08em" }}>
              <th style={thStyle}>訂單編號</th>
              <th style={thStyle}>通路</th>
              <th style={thStyle}>收件人</th>
              <th style={thStyle}>物流/取貨</th>
              <th style={thStyle}>品項</th>
              <th style={{ ...thStyle, textAlign: "right", width: 60 }}>標籤</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} style={{ borderTop: "1px solid #1F1F24" }}>
                <td style={tdStyle}>{o.id}</td>
                <td style={tdStyle}>{o.channel.replace(/^面交_/, "面交·")}</td>
                <td style={tdStyle}>
                  <div style={{ fontFamily: F.tc, fontWeight: 700, color: "#F5F4EF" }}>{o.recipient.name ?? "—"}</div>
                  {o.recipient.phone && <div style={{ fontSize: 10, color: "#8A8A93" }}>{o.recipient.phone}</div>}
                  {o.recipient.igOrLine && <div style={{ fontSize: 10, color: "#8A8A93" }}>{o.recipient.igOrLine}</div>}
                </td>
                <td style={{ ...tdStyle, fontSize: 10, color: "#C9C9CF" }}>{shipmentInfoOf(o)}</td>
                <td style={{ ...tdStyle, fontFamily: F.tc, fontSize: 11, color: "#F5F4EF" }}>{itemsSummary(o, menu)}</td>
                <td style={{ ...tdStyle, fontFamily: F.anton, fontSize: 14, textAlign: "right", color: "var(--acc,#F5D400)" }}>{o.labelCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle = {
  padding: "8px 10px", textAlign: "left" as const, fontWeight: 700, fontSize: 10,
  borderBottom: "1px solid #26262C",
};
const tdStyle = {
  padding: "8px 10px", verticalAlign: "top" as const,
};

// ── 當日顆數統計（純數字、不做上限比對） ────────────────────
function BatchAtomsCount({ shipList, menu }: { shipList: Order[]; menu: Menu }) {
  const totals = accumulateAtoms(shipList);
  const rows = [...totals.entries()].filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]);
  const grandTotal = rows.reduce((s, [, q]) => s + q, 0);
  return (
    <div>
      <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".14em", marginBottom: 10 }}>
        當日顆數統計 · {grandTotal} 顆
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, fontFamily: F.mono, fontSize: 11 }}>
        {rows.length === 0 && <span style={{ color: "#6C6C74" }}>本批尚無訂單</span>}
        {rows.map(([atom, qty]) => (
          <div key={atom} className="flex items-center justify-between" style={{ padding: "7px 12px", background: "#161619" }}>
            <span style={{ fontFamily: F.tc, fontWeight: 700, color: "#C9C9CF" }}>{getDisplayName(atom, menu)}</span>
            <span style={{ fontFamily: F.anton, fontSize: 15, color: "#F5F4EF" }}>{qty}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 備料原子總量（跟 BatchAtomsCount 幾乎一樣、留兩欄視覺分區） ──
function BatchAtomsPreparation({ shipList, menu }: { shipList: Order[]; menu: Menu }) {
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
