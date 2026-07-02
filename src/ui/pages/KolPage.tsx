/**
 * KolPage — KOL ROI 分析頁
 * 憲章 #1 品項名 getDisplayName | #2 0 LLM | #8 sourceOrderIds
 * 不 render CommandBar / WarningTape / GrainOverlay（AppShell 負責）
 */
import { useMemo } from "react";
import { PageHeader } from "../brand/PageHeader";
import { computeKolRoi, type KolRow } from "../../domain/compute-kol";
import type { PageProps } from "./types";

const F = { anton: "'Anton',sans-serif", tc: "'Noto Sans TC',sans-serif", mono: "'Space Mono',monospace" } as const;
const C = {
  panel: "#0F0F12", card: "#111114", track: "#161619", line: "#26262C", line2: "#1c1c20",
  ink: "#F5F4EF", ink2: "#E7E7EA", ink3: "#C9C9CF", mut: "#8A8A93", mut2: "#7A7A82", mut3: "#6C6C74",
  acc: "var(--acc,#F5D400)", green: "#43B23C", orange: "#E5622A", purple: "#8557C9", cyan: "#2AC7E8",
} as const;

function roiColor(roi: number | null): string {
  if (roi === null || roi <= 0) return C.mut3;
  if (roi >= 10) return C.green;
  if (roi >= 5) return C.acc;
  return C.orange;
}

function statusBadge(kind: string): { color: string; bg: string; label: string } {
  if (kind === "shipped") return { color: C.cyan, bg: "#0d2830", label: "已出貨" };
  if (kind === "choice") return { color: C.purple, bg: "#241a35", label: "待選品項" };
  return { color: C.orange, bg: "#2a1a10", label: "待寄" };
}

function ntDollar(n: number): string { return `NT$${n.toLocaleString("zh-TW")}`; }
function fmtRoi(roi: number | null): string {
  if (roi === null || roi <= 0) return "—";
  return `${roi.toFixed(1)}×`;
}

function KpiCard({ accent, labelColor, label, foot, children }: {
  accent?: string; labelColor?: string; label: string; foot?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderLeft: `3px solid ${accent ?? C.line}`, padding: 18 }}>
      <div style={{ fontFamily: F.mono, fontSize: 10, color: labelColor ?? C.mut2, letterSpacing: ".12em" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", marginTop: 8 }}>{children}</div>
      {foot && <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, marginTop: 6 }}>{foot}</div>}
    </div>
  );
}

function TableRow({ row }: { row: KolRow }) {
  const badge = statusBadge(row.kind);
  const rc = roiColor(row.roi);
  const COLS = "1.3fr 1.8fr 0.8fr 1fr 0.7fr 1fr 0.8fr 0.9fr";
  return (
    <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "12px 16px", borderBottom: `1px solid ${C.line2}`, alignItems: "center" }}>
      <span style={{ fontFamily: F.mono, fontSize: 12, color: C.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.handle}</span>
      <span style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 11, color: C.mut2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.itemNames}</span>
      <span style={{ fontFamily: F.mono, fontSize: 11, color: C.orange, textAlign: "right" }}>
        {row.cost > 0 ? `$${row.cost}` : "—"}{row.isEstimated && <sup style={{ fontSize: 8 }}>估</sup>}
      </span>
      <span style={{ fontFamily: F.mono, fontSize: 11, color: C.purple, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.discountCode}</span>
      <span style={{ fontFamily: F.mono, fontSize: 11, color: C.ink3, textAlign: "right" }}>{row.orderCount}</span>
      <span style={{ fontFamily: F.mono, fontSize: 11, color: C.green, textAlign: "right" }}>{row.revenue > 0 ? ntDollar(row.revenue) : "—"}</span>
      <span style={{ fontFamily: F.anton, fontSize: 15, color: rc, textAlign: "right" }}>{fmtRoi(row.roi)}</span>
      <span style={{ textAlign: "right" }}>
        <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 10, color: badge.color, background: badge.bg, padding: "3px 8px", whiteSpace: "nowrap" }}>{badge.label}</span>
      </span>
    </div>
  );
}

export function KolPage({ orders, menu }: PageProps) {
  const { rows, kpi, champions, insightText, insightSourceOrderIds } = useMemo(
    () => computeKolRoi(orders, menu),
    [orders, menu]
  );

  const COLS = "1.3fr 1.8fr 0.8fr 1fr 0.7fr 1fr 0.8fr 0.9fr";

  return (
    <div className="h-full flex flex-col min-h-0" style={{ position: "relative", zIndex: 1 }}>
      {/* Page Header — flex-none */}
      <div style={{ flexShrink: 0 }}>
        <PageHeader
          caption="KOL ROI · 合作成本 vs 帶單"
          title="KOL PAYBACK"
          right={
            <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: "#111", background: C.purple, padding: "9px 16px", cursor: "default" }}>
              ◆ Claude Code 分析
            </span>
          }
        />
      </div>


      {/* 估算警告 — flex-none */}
      {kpi.hasEstimate && (
        <div style={{ flexShrink: 0, margin: "8px 24px 0", padding: "8px 16px", background: "#2a1a10", borderLeft: `3px solid ${C.orange}`, fontFamily: F.mono, fontSize: 11, color: C.orange }}>
          ⚠ 估算模式：部分品項 cost 未設定，成本以 $0 計算——請補齊 menu.yaml cost 欄位。
        </div>
      )}

      {/* 空狀態 */}
      {rows.length === 0 ? (
        <div style={{ margin: "60px 24px", padding: "40px 32px", background: C.panel, border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.purple}`, textAlign: "center" }}>
          <div style={{ fontFamily: F.anton, fontSize: 32, color: C.purple, letterSpacing: ".05em" }}>NO KOL DATA</div>
          <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 13, color: C.mut, marginTop: 12 }}>尚無 channel === "KOL" 的訂單</div>
        </div>
      ) : (
        <>
          {/* KPI 四欄 — flex-none */}
          <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, padding: "16px 24px 8px" }}>
            <KpiCard accent={C.purple} label="合作 KOL"
              foot={`已寄 ${kpi.shippedCount} · 待寄 ${kpi.pendingCount} · 待選 ${kpi.choiceCount}`}>
              <span style={{ fontFamily: F.anton, fontSize: 42, color: C.ink, lineHeight: 0.85 }}>{kpi.kolCount}</span>
            </KpiCard>

            <KpiCard accent={C.orange} labelColor={C.orange} label="寄出成本" foot="免費品成本合計">
              <span style={{ fontFamily: F.mono, fontSize: 13, color: C.mut }}>NT$</span>
              <span style={{ fontFamily: F.anton, fontSize: 38, color: C.orange, lineHeight: 0.85, marginLeft: 3 }}>
                {kpi.totalCost.toLocaleString("zh-TW")}
              </span>
              {kpi.hasEstimate && <sup style={{ fontFamily: F.mono, fontSize: 9, color: C.orange, marginLeft: 4 }}>估</sup>}
            </KpiCard>

            <KpiCard accent={C.green} labelColor={C.green} label="折扣碼帶單"
              foot={`帶單營收 ${ntDollar(kpi.totalRevenue)}`}>
              <span style={{ fontFamily: F.anton, fontSize: 38, color: C.ink, lineHeight: 0.85 }}>{kpi.totalOrders}</span>
              <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: C.mut, marginLeft: 6 }}>單</span>
            </KpiCard>

            {/* 平均 ROI — 特殊底色 */}
            <div style={{ background: "#1c1600", border: `1px solid ${C.acc}`, borderLeft: `3px solid ${C.acc}`, padding: 18 }}>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7a6600", letterSpacing: ".12em" }}>平均 ROI</div>
              <div style={{ display: "flex", alignItems: "baseline", marginTop: 8 }}>
                {kpi.avgRoi !== null ? (
                  <>
                    <span style={{ fontFamily: F.anton, fontSize: 42, color: C.acc, lineHeight: 0.85 }}>{kpi.avgRoi.toFixed(1)}</span>
                    <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: "#8A7a00", marginLeft: 3 }}>×</span>
                  </>
                ) : (
                  <span style={{ fontFamily: F.mono, fontSize: 14, color: C.mut3 }}>—</span>
                )}
              </div>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: C.ink3, marginTop: 6 }}>帶單營收 / 寄出成本</div>
            </div>
          </div>

          {/* 明細表區域 — flex-1 min-h-0，內部捲動 */}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "8px 24px 0", overflowX: "auto" }}>
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, minWidth: 820, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              {/* 表頭 — flex-none */}
              <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "11px 16px", background: "#141417", borderBottom: `1px solid ${C.line}`, fontFamily: F.mono, fontSize: 10, color: C.mut2, letterSpacing: ".06em" }}>
                <span>KOL</span><span>提供品項</span>
                <span style={{ textAlign: "right" }}>成本</span><span>折扣碼</span>
                <span style={{ textAlign: "right" }}>帶單</span><span style={{ textAlign: "right" }}>帶單營收</span>
                <span style={{ textAlign: "right" }}>ROI</span><span style={{ textAlign: "right" }}>狀態</span>
              </div>
              {/* 資料列區 — flex-1 min-h-0 overflow-y-auto */}
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                {rows.map((row) => <TableRow key={row.handle} row={row} />)}
              </div>
            </div>
          </div>

          {/* 冠軍榜 + 洞察 — flex-none，固定在表格下方 */}
          <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12, padding: "12px 24px 16px" }}>
            {/* Claude Code 洞察（靜態，#2 不呼叫 LLM）*/}
            <div style={{ background: "#160f26", border: `1px solid ${C.purple}`, borderLeft: `3px solid ${C.purple}`, padding: 18 }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#b79ae6", marginBottom: 6 }}>◆ Claude Code 洞察 · kol_roi_analysis</div>
              <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: C.ink3, lineHeight: 1.7 }}>{insightText}</div>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, marginTop: 8 }}>
                來源 sourceOrderIds: {insightSourceOrderIds.length} · 防護 #8 附引用
                {insightSourceOrderIds.length > 0 && (
                  <span style={{ display: "block", color: "#3a3060", marginTop: 4, wordBreak: "break-all", fontSize: 9 }}>
                    [{insightSourceOrderIds.slice(0, 5).join(", ")}{insightSourceOrderIds.length > 5 ? ` … +${insightSourceOrderIds.length - 5}` : ""}]
                  </span>
                )}
              </div>
            </div>

            {/* ROI 冠軍榜 */}
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 18 }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: C.ink, marginBottom: 14 }}>ROI 冠軍</div>
              {champions.length === 0 ? (
                <div style={{ fontFamily: F.mono, fontSize: 12, color: C.mut3 }}>尚無已出貨 KOL 帶單資料</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {champions.map((c, i) => (
                    <div key={c.handle} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontFamily: F.anton, fontSize: 20, color: i === 0 ? "#111" : "#fff", background: i === 0 ? C.acc : "#3a3a40", padding: "0 8px", minWidth: 28, textAlign: "center" }}>
                        {i + 1}
                      </span>
                      <span style={{ flex: 1, fontFamily: F.mono, fontSize: 12, color: C.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.handle}</span>
                      <span style={{ fontFamily: F.anton, fontSize: 20, color: C.green }}>{fmtRoi(c.roi)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
