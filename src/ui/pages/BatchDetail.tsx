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
function shortDate(raw: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}`;
  const slash = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slash) return `${slash[2]}/${slash[3]}`;
  return raw.slice(0, 10);
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
    <div className="batch-detail-panel print-area" style={{ background: "#0F0F12", border: "1px solid #26262C" }}>
      {/* Print CSS · 只印本 panel · 其他 body 內容全 hidden（見 index.css .print-area）*/}
      <style>{`
        @media print {
          .batch-detail-panel, .batch-detail-panel * {
            color: #000 !important; border-color: #000 !important;
          }
          .batch-detail-panel { border: 1px solid #000 !important; }
          /* Yen 2026-07-04：跨頁保護 · 每張訂單卡完整呈現、每通路組儘量在同頁 */
          .batch-detail-panel .order-card { break-inside: avoid; page-break-inside: avoid; }
          .batch-detail-panel .channel-group { break-inside: avoid-page; page-break-inside: avoid; }
          .batch-detail-panel .channel-group > div:first-child {
            break-after: avoid; page-break-after: avoid;
          }
          .batch-detail-panel .stats-block { break-inside: avoid; page-break-inside: avoid; }
          /* 「複製」互動按鈕 print 時隱藏、改印純文字 */
          .batch-detail-panel .only-print { display: inline !important; }
          .batch-detail-panel .no-print { display: none !important; }
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
      <div className="stats-block" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16, padding: 16 }}>
        <BatchSkuCount shipList={shipList} menu={menu} />
        <BatchAtomsPreparation shipList={shipList} menu={menu} />
      </div>
      {/* Yen 2026-07-03：出貨人員對帳用訂單詳情 · 通路分組卡片 */}
      <BatchOrdersTable shipList={shipList} menu={menu} />
    </div>
  );
}

// ── SKU（訂單組合）級統計 · Yen 2026-07-04 要求：不用單品項 atom、按 SKU 組合統計 ──
function accumulateBySku(orders: Order[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of orders) {
    for (const it of o.items) {
      if (!it.productSkuId) continue;
      m.set(it.productSkuId, (m.get(it.productSkuId) ?? 0) + it.quantity);
    }
  }
  return m;
}

function BatchSkuCount({ shipList, menu }: { shipList: Order[]; menu: Menu }) {
  const totals = accumulateBySku(shipList);
  const rows = [...totals.entries()].filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]);
  const grandTotal = rows.reduce((s, [, q]) => s + q, 0);
  return (
    <div>
      <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".14em", marginBottom: 10 }}>
        訂單組合統計 · {grandTotal} 份
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: F.mono, fontSize: 11 }}>
        {rows.length === 0 && <span style={{ color: "#6C6C74" }}>本批尚無訂單</span>}
        {rows.map(([sku, qty]) => {
          const p = menu.products[sku];
          const name = p?.display_name ?? sku;
          return (
            <div key={sku} className="flex items-center justify-between" style={{ padding: "7px 12px", background: "#161619" }}>
              <span style={{ fontFamily: F.tc, fontWeight: 700, color: "#C9C9CF" }}>{name}</span>
              <span style={{ fontFamily: F.anton, fontSize: 15, color: "#F5F4EF" }}>{qty}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 訂單詳情 · 通路分組卡片式（Yen 2026-07-03：不能純表格 · 要清晰易懂）──
//   出貨人員拿著單對物流 / 標籤 · 每張卡獨立顯眼

function itemsSummary(o: Order, menu: Menu): string {
  if (o.items.length === 0) return "—";
  return o.items
    .map((it) => {
      const name = it.productSkuId ? (menu.products[it.productSkuId]?.display_name ?? it.rawName) : it.rawName;
      return `${name}×${it.quantity}`;
    })
    .join(" · ");
}

type ChannelGroup = "賣貨便" | "面交" | "宅配" | "KOL" | "其他";
const CHANNEL_COLOR: Record<ChannelGroup, string> = {
  賣貨便: "var(--acc,#F5D400)",
  面交: "#43B23C",
  宅配: "#2AC7E8",
  KOL: "#8557C9",
  其他: "#8A8A93",
};
function groupOf(channel: string): ChannelGroup {
  if (channel === "賣貨便") return "賣貨便";
  if (channel.startsWith("面交")) return "面交";
  if (channel === "宅配") return "宅配";
  if (channel === "KOL") return "KOL";
  return "其他";
}

function BatchOrdersTable({ shipList, menu }: { shipList: Order[]; menu: Menu }) {
  if (shipList.length === 0) return null;
  const totalLabels = shipList.reduce((s, o) => s + (o.labelCount ?? 0), 0);

  // 依通路分組
  const groups = new Map<ChannelGroup, Order[]>();
  for (const o of shipList) {
    const g = groupOf(o.channel);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(o);
  }
  const groupOrder: ChannelGroup[] = ["賣貨便", "面交", "宅配", "KOL", "其他"];
  const groupList = groupOrder.filter((g) => groups.has(g));

  return (
    <div style={{ borderTop: "1px solid #26262C", padding: "14px 16px 18px" }}>
      {/* 通路統計摘要條 */}
      <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 10, marginBottom: 12 }}>
        <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".14em" }}>
          訂單詳情 · 出貨對帳 · {shipList.length} 單 · 共 {totalLabels} 張標籤
        </div>
        <div className="flex flex-wrap" style={{ gap: 8 }}>
          {groupList.map((g) => {
            const list = groups.get(g)!;
            const labels = list.reduce((s, o) => s + (o.labelCount ?? 0), 0);
            return (
              <div key={g} style={{ fontFamily: F.mono, fontSize: 10, color: CHANNEL_COLOR[g], border: `1px solid ${CHANNEL_COLOR[g]}`, padding: "3px 8px", letterSpacing: ".05em" }}>
                {g} · <span style={{ fontFamily: F.anton, fontSize: 13, marginLeft: 2 }}>{list.length}</span>單 · <span style={{ fontFamily: F.anton, fontSize: 13 }}>{labels}</span>張
              </div>
            );
          })}
        </div>
      </div>

      {/* 依通路分組 · 每組獨立區塊 · 卡片式訂單列 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {groupList.map((g) => {
          const list = groups.get(g)!;
          const labels = list.reduce((s, o) => s + (o.labelCount ?? 0), 0);
          const color = CHANNEL_COLOR[g];
          return (
            <div key={g} className="channel-group" style={{ background: "#141417", border: `1px solid #26262C`, borderLeft: `4px solid ${color}` }}>
              <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 10, padding: "10px 14px", background: "#0F0F12" }}>
                <div className="flex items-baseline" style={{ gap: 10 }}>
                  <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color }}>{g}</span>
                  <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".1em" }}>
                    {list.length} 單 · {labels} 張標籤
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", padding: "8px 10px", gap: 8 }}>
                {list.map((o) => (
                  <OrderCard key={o.id} order={o} menu={menu} color={color} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OrderCard({ order: o, menu, color }: { order: Order; menu: Menu; color: string }) {
  const isMart = o.channel === "賣貨便";
  const isHome = o.channel === "宅配";
  const isFace = o.channel.startsWith("面交");
  const isKol = o.channel === "KOL";
  const faceLoc = isFace ? o.channel.replace(/^面交_/, "") : null;

  return (
    <div className="order-card" style={{ background: "#0F0F12", border: "1px solid #1F1F24", padding: "10px 12px" }}>
      <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 10, marginBottom: 6 }}>
        <div className="flex items-baseline flex-wrap" style={{ gap: 10 }}>
          {/* Yen 2026-07-04：訂單編號 loud 顯示 · 出貨人員一眼對照賣貨便網頁 · click 複製 */}
          <button
            type="button"
            className="no-print"
            title="複製訂單編號 · 貼到賣貨便網頁搜尋"
            onClick={() => { void navigator.clipboard?.writeText(o.id); }}
            style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 13, color: isMart ? "var(--acc,#F5D400)" : "#F5F4EF", background: "transparent", border: `1px solid ${isMart ? "var(--acc,#F5D400)" : "#3a3a40"}`, padding: "2px 8px", cursor: "pointer", letterSpacing: ".05em" }}
          >
            {o.id}
          </button>
          <span className="only-print" style={{ display: "none", fontFamily: F.mono, fontWeight: 700, fontSize: 13, color: "#000" }}>{o.id}</span>
          <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 14, color: "#F5F4EF" }}>{o.recipient.name ?? "—"}</span>
          {o.order_date && (
            <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".05em" }}>
              下單 {shortDate(o.order_date)}
            </span>
          )}
        </div>
        <div className="flex items-baseline" style={{ gap: 4 }}>
          <span style={{ fontFamily: F.anton, fontSize: 18, color }}>{o.labelCount}</span>
          <span style={{ fontFamily: F.tc, fontSize: 10, color: "#8A8A93" }}>張標籤</span>
        </div>
      </div>

      {/* 物流資訊區塊 · channel-aware */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px", marginBottom: 8 }}>
        {isMart && o.recipient.convStore && (
          <>
            <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82" }}>超商</span>
            <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#F5F4EF" }}>{o.recipient.convStore}</span>
          </>
        )}
        {isHome && o.recipient.address && (
          <>
            <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82" }}>地址</span>
            <span style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: "#F5F4EF" }}>{o.recipient.address}</span>
          </>
        )}
        {isFace && (
          <>
            <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82" }}>地點</span>
            <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#F5F4EF" }}>{faceLoc}面交</span>
          </>
        )}
        {isKol && (
          <>
            {o.recipient.address && (
              <>
                <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82" }}>寄送</span>
                <span style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: "#F5F4EF" }}>{o.recipient.address}</span>
              </>
            )}
            {o.recipient.igOrLine && (
              <>
                <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82" }}>IG</span>
                <span style={{ fontFamily: F.mono, fontSize: 11, color: "#F5F4EF" }}>{o.recipient.igOrLine}</span>
              </>
            )}
          </>
        )}
        {o.recipient.phone && (
          <>
            <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82" }}>電話</span>
            <span style={{ fontFamily: F.mono, fontSize: 11, color: "#C9C9CF" }}>{o.recipient.phone}</span>
          </>
        )}
      </div>

      {/* 品項 */}
      <div style={{ padding: "6px 10px", background: "#161619", borderLeft: `2px solid ${color}` }}>
        <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82", marginBottom: 2 }}>品項</div>
        <div style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#F5F4EF" }}>{itemsSummary(o, menu)}</div>
      </div>
    </div>
  );
}

// ── BatchAtomsCount 已由 BatchSkuCount 取代（Yen 2026-07-04：按 SKU 組合統計、非單品項 atom） ──

// ── 備料原子總量（保留 · atom 級 · 給備料師傅看要多少顆） ──
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
