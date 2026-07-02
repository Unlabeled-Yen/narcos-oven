/**
 * PayoutPage — 分潤統計（總 + 淨並列）
 *
 * 憲章 #1：禁 hardcode 品項，成本來自 menu.products[].cost / logistics_cost。
 * 憲章 #2：0 LLM，數字全來自 orders + menu，估算值明確標示。
 *
 * 版面：
 *   - Hero × 2（總營收 / 淨利）
 *   - 瀑布拆解
 *   - 成本結構占比
 *   - 各通路分潤表（切換「看總營收 / 看淨利」）
 *   - 估算 disclaimer
 */
import { useState } from "react";
import { PageHeader, PeriodChips } from "../brand/PageHeader";
import { computePayout, fmtNT, fmtPct } from "../../domain/compute-payout";
import type { PageProps } from "./types";

// ── font shortcuts ─────────────────────────────────────────
const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
};

// ── colour tokens ──────────────────────────────────────────
const C = {
  bg: "#08080A",
  panel: "#0F0F12",
  card: "#111114",
  track: "#161619",
  line: "#26262C",
  ink: "#F5F4EF",
  ink3: "#C9C9CF",
  mut: "#8A8A93",
  mut2: "#7A7A82",
  acc: "var(--acc,#F5D400)",
  green: "#43B23C",
  orange: "#E5622A",
  cyan: "#2AC7E8",
  red: "#E5352B",
  purple: "#8557C9",
  pkgColor: "#F59E42",
};

// ── period options ─────────────────────────────────────────
const PERIODS = [
  { key: "all", label: "全部" },
];

// ─────────────────────────────────────────────────────────────
export function PayoutPage({ orders, menu }: PageProps) {
  const [period, setPeriod] = useState("all");
  const [mode, setMode] = useState<"gross" | "net">("net");

  const result = computePayout(orders, menu);

  const {
    orderCount,
    grossTotal,
    cogs,
    packaging,
    logistics,
    netProfit,
    netMargin,
    byChannel,
    isEstimated,
    estimatedReasons,
  } = result;

  // pct of grossTotal (for bar widths)
  const pctOf = (v: number) => (grossTotal > 0 ? v / grossTotal : 0);

  // Merge "面交" sub-channels in display
  const mergedChannels = (() => {
    const mergeMap = new Map<string, typeof byChannel[number]>();
    for (const ch of byChannel) {
      const key = ch.name; // "面交" covers 面交_中壢 / 面交_台中 / 面交_其他
      if (mergeMap.has(key)) {
        const ex = mergeMap.get(key)!;
        mergeMap.set(key, {
          ...ex,
          orderCount: ex.orderCount + ch.orderCount,
          grossTotal: ex.grossTotal + ch.grossTotal,
          cogs: ex.cogs + ch.cogs,
          packaging: ex.packaging + ch.packaging,
          logistics: ex.logistics + ch.logistics,
          netProfit: ex.netProfit + ch.netProfit,
          isEstimated: ex.isEstimated || ch.isEstimated,
        });
      } else {
        mergeMap.set(key, { ...ch });
      }
    }
    return [...mergeMap.values()];
  })();

  // Empty state
  if (orders.length === 0) {
    return (
      <div className="h-full flex flex-col min-h-0" style={{ fontFamily: F.tc }}>
        <PageHeader
          caption="PAYOUT · 分潤統計 · 總+淨並列"
          title="PROFIT SPLIT"
          right={<PeriodChips options={PERIODS} active={period} onChange={setPeriod} />}
        />
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0" style={{ fontFamily: F.tc }}>
      {/* ── PAGE HEADER ─────────────────────────── */}
      <PageHeader
        caption="PAYOUT · 分潤統計 · 總+淨並列"
        title="PROFIT SPLIT"
        right={<PeriodChips options={PERIODS} active={period} onChange={setPeriod} />}
      />

      {/* ── SCROLL WRAPPER ──────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>

      {/* ── HERO: 總營收 vs 淨利 ─────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, padding: "16px 24px 8px" }}>
        {/* 總營收 */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderTop: `3px solid ${C.cyan}`, padding: 20 }}>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mut2, letterSpacing: ".12em" }}>
            總營收 GROSS · Σ含運
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 10 }}>
            <span style={{ fontFamily: F.mono, fontSize: 18, color: C.mut }}>NT$</span>
            <span style={{ fontFamily: F.anton, fontSize: 58, color: C.ink, lineHeight: "0.85" }}>
              {fmtNT(grossTotal)}
            </span>
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.green, marginTop: 8 }}>
            {orderCount} 筆訂單納入計算
          </div>
        </div>

        {/* 淨利 */}
        <div style={{ background: "#1c1600", border: `1px solid ${C.acc}`, borderTop: `3px solid ${C.acc}`, padding: 20 }}>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: "#7a6600", letterSpacing: ".12em" }}>
            淨利 NET · 扣成本包材物流
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 10 }}>
            <span style={{ fontFamily: F.mono, fontSize: 18, color: "#8A7a00" }}>NT$</span>
            <span style={{ fontFamily: F.anton, fontSize: 58, color: C.acc, lineHeight: "0.85" }}>
              {fmtNT(netProfit)}
            </span>
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.ink3, marginTop: 8 }}>
            淨利率 {fmtPct(netMargin)} · 每單淨賺 NT$
            {orderCount > 0 ? fmtNT(Math.round(netProfit / orderCount)) : "—"}
          </div>
        </div>
      </div>

      {/* ── WATERFALL + COST STRUCTURE ────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 12, padding: "8px 24px" }}>

        {/* 瀑布拆解 */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 20 }}>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: C.ink, marginBottom: 18 }}>
            總營收 → 淨利 拆解
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontFamily: F.mono, fontSize: 12 }}>
            <WaterfallRow label="總營收" value={grossTotal} width={100} color={C.cyan} labelColor={C.ink3} />
            <WaterfallRow label="− 品項成本" value={cogs} width={pctOf(cogs) * 100} color={C.orange} labelColor="#9A9AA2" negative isEstimated={isEstimated} />
            <WaterfallRow label="− 包材" value={packaging} width={pctOf(packaging) * 100} color={C.orange} labelColor="#9A9AA2" negative isEstimated={isEstimated} />
            <WaterfallRow label="− 物流實付" value={logistics} width={pctOf(logistics) * 100} color={C.orange} labelColor="#9A9AA2" negative isEstimated={isEstimated} />
            <div style={{ height: 1, background: C.line, margin: "2px 0" }} />
            <WaterfallRow label="= 淨利" value={netProfit} width={pctOf(netProfit) * 100} color={C.acc} labelColor={C.ink} bold />
          </div>
        </div>

        {/* 成本結構占比 */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 20 }}>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: C.ink, marginBottom: 18 }}>
            成本結構占比
          </div>
          {grossTotal > 0 ? (
            <>
              {/* stacked bar */}
              <div style={{ display: "flex", height: 30, marginBottom: 16 }}>
                <div style={{ width: `${pctOf(cogs) * 100}%`, background: C.orange }} />
                <div style={{ width: `${pctOf(packaging) * 100}%`, background: C.pkgColor }} />
                <div style={{ width: `${pctOf(logistics) * 100}%`, background: C.purple }} />
                <div style={{ width: `${pctOf(netProfit) * 100}%`, background: C.acc }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9, fontFamily: F.mono, fontSize: 12 }}>
                <CostLegend color={C.orange} label="品項成本 COGS" pct={pctOf(cogs)} estimated={isEstimated} />
                <CostLegend color={C.pkgColor} label="包材" pct={pctOf(packaging)} estimated={isEstimated} />
                <CostLegend
                  color={C.purple}
                  label={`物流實付（超商$${(menu.logistics_cost?.["賣貨便_超商"] ?? 60)}/宅配$${(menu.logistics_cost?.["宅配"] ?? 130)}）`}
                  pct={pctOf(logistics)}
                  estimated={isEstimated}
                />
                <CostLegend color={C.acc} label="淨利" pct={netMargin} bold />
              </div>
            </>
          ) : (
            <div style={{ fontFamily: F.mono, fontSize: 12, color: C.mut }}>無資料</div>
          )}
        </div>
      </div>

      {/* ── 通路分潤 TABLE ──────────────────────── */}
      <div style={{ padding: "8px 24px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: C.ink }}>各通路分潤</span>
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, overflow: "hidden" }}>
          {/* header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr 1fr 1fr 1fr",
            gap: 8,
            padding: "11px 18px",
            background: "#141417",
            borderBottom: `1px solid ${C.line}`,
            fontFamily: F.mono,
            fontSize: 10,
            color: C.mut2,
            letterSpacing: ".08em",
          }}>
            <span>通路</span>
            <span style={{ textAlign: "right" }}>訂單</span>
            <span style={{ textAlign: "right" }}>總營收</span>
            <span style={{ textAlign: "right" }}>淨利</span>
            <span style={{ textAlign: "right" }}>淨利率</span>
          </div>
          {/* rows */}
          {mergedChannels.map((ch) => {
            const margin = ch.grossTotal > 0 ? ch.netProfit / ch.grossTotal : null;
            const grossFg = mode === "gross" ? C.ink : "#6C6C74";
            const grossWeight = mode === "gross" ? 700 : 400;
            const netFg = mode === "net" ? C.ink : "#6C6C74";
            const netWeight = mode === "net" ? 700 : 400;
            return (
              <div
                key={ch.channelId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1fr 1fr 1fr 1fr",
                  gap: 8,
                  padding: "13px 18px",
                  borderBottom: `1px solid #1c1c20`,
                  alignItems: "center",
                }}
              >
                <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 13, color: ch.color }}>
                  {ch.name}
                  {ch.isEstimated && <span style={{ fontFamily: F.mono, fontSize: 9, color: C.orange, marginLeft: 4 }}>估</span>}
                </span>
                <span style={{ fontFamily: F.mono, fontSize: 12, color: C.mut, textAlign: "right" }}>{ch.orderCount}</span>
                <span style={{ fontFamily: F.mono, fontSize: 12, color: grossFg, fontWeight: grossWeight, textAlign: "right" }}>
                  {ch.grossTotal > 0 ? fmtNT(ch.grossTotal) : "—"}
                </span>
                <span style={{ fontFamily: F.mono, fontSize: 12, color: ch.netProfit < 0 ? C.red : netFg, fontWeight: netWeight, textAlign: "right" }}>
                  {ch.netProfit < 0 ? `−${fmtNT(Math.abs(ch.netProfit))}` : fmtNT(ch.netProfit)}
                </span>
                <span style={{ fontFamily: F.mono, fontSize: 12, color: C.ink3, textAlign: "right" }}>
                  {margin !== null ? fmtPct(margin) : "—"}
                </span>
              </div>
            );
          })}
          {/* 合計 */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr 1fr 1fr 1fr",
            gap: 8,
            padding: "13px 18px",
            background: "#141417",
            alignItems: "center",
          }}>
            <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: C.ink }}>合計</span>
            <span style={{ fontFamily: F.mono, fontSize: 12, color: C.ink3, textAlign: "right" }}>{orderCount}</span>
            <span style={{ fontFamily: F.mono, fontSize: 12, color: C.cyan, fontWeight: 700, textAlign: "right" }}>{fmtNT(grossTotal)}</span>
            <span style={{ fontFamily: F.mono, fontSize: 12, color: C.acc, fontWeight: 700, textAlign: "right" }}>
              {netProfit < 0 ? `−${fmtNT(Math.abs(netProfit))}` : fmtNT(netProfit)}
            </span>
            <span style={{ fontFamily: F.mono, fontSize: 12, color: C.ink3, textAlign: "right" }}>{fmtPct(netMargin)}</span>
          </div>
        </div>
      </div>

      {/* ── DISCLAIMER ──────────────────────────── */}
      <div style={{ padding: "4px 24px 16px" }}>
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.orange}`, padding: "14px 16px" }}>
          <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: C.orange }}>
            {isEstimated ? "⚠ v1 估算" : "✓ 來自 menu"}
          </span>
          {isEstimated && estimatedReasons.length > 0 ? (
            <ul style={{ margin: "8px 0 0 0", paddingLeft: 16 }}>
              {estimatedReasons.map((r) => (
                <li key={r} style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: C.mut, marginBottom: 4 }}>
                  {r}
                </li>
              ))}
            </ul>
          ) : (
            <span style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: C.mut }}>
              {" "}· 品項成本 & 物流實付使用 menu.yaml 預設值（超商 ${menu.logistics_cost?.["賣貨便_超商"] ?? 60}、宅配 ${menu.logistics_cost?.["宅配"] ?? 130}）。雇主補精確成本後即時重算。
            </span>
          )}
          <div style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", marginTop: 8 }}>
            憲章 #2 · web app 0 LLM · 數字全來自 orders + menu
          </div>
        </div>
      </div>

      </div>{/* end scroll wrapper */}
    </div>
  );
}

// ── local sub-components ───────────────────────────────────

function EmptyState() {
  return (
    <div style={{ padding: "60px 24px", textAlign: "center" }}>
      <div style={{ fontFamily: "'Anton',sans-serif", fontSize: 42, color: "#26262C", letterSpacing: ".03em" }}>
        NO DATA
      </div>
      <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 12, color: "#6C6C74", marginTop: 12 }}>
        尚無訂單 · 上傳 Excel 後即時重算
      </div>
    </div>
  );
}

function WaterfallRow({
  label,
  value,
  width,
  color,
  labelColor,
  negative = false,
  bold = false,
  isEstimated = false,
}: {
  label: string;
  value: number;
  width: number;
  color: string;
  labelColor: string;
  negative?: boolean;
  bold?: boolean;
  isEstimated?: boolean;
}) {
  const clampedWidth = Math.max(0, Math.min(100, width));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 82, fontFamily: "'Noto Sans TC',sans-serif", fontWeight: bold ? 900 : 700, color: labelColor, fontSize: 12 }}>
        {label}
        {isEstimated && negative && (
          <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#E5622A", marginLeft: 3 }}>估</span>
        )}
      </span>
      <div style={{ flex: 1, height: 20, background: "#161619" }}>
        <div style={{ width: `${clampedWidth}%`, height: 20, background: color }} />
      </div>
      <span style={{ width: 72, textAlign: "right", color: negative ? "#E5622A" : color, fontWeight: bold ? 700 : 400, fontFamily: "'Space Mono',monospace", fontSize: 12 }}>
        {negative && value > 0 ? `${fmtNT(value)}` : fmtNT(value)}
      </span>
    </div>
  );
}

function CostLegend({
  color,
  label,
  pct,
  bold = false,
  estimated = false,
}: {
  color: string;
  label: string;
  pct: number;
  bold?: boolean;
  estimated?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 9, height: 9, background: color, flexShrink: 0 }} />
      <span style={{ flex: 1, color: bold ? "#F5F4EF" : "#C9C9CF", fontWeight: bold ? 700 : 400 }}>
        {label}
        {estimated && !bold && (
          <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, color: "#E5622A", marginLeft: 4 }}>估算</span>
        )}
      </span>
      <span style={{ color: bold ? "var(--acc,#F5D400)" : "#7A7A82" }}>{fmtPct(pct)}</span>
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: "gross" | "net";
  onChange: (m: "gross" | "net") => void;
}) {
  const seg = (active: boolean) => ({
    fontFamily: "'Space Mono',monospace" as const,
    fontSize: 11,
    padding: "6px 12px",
    cursor: "pointer" as const,
    color: active ? "#111" : "#7A7A82",
    background: active ? "var(--acc,#F5D400)" : "#161619",
  });
  return (
    <div style={{ display: "flex", gap: 2 }}>
      <span style={seg(mode === "gross")} onClick={() => onChange("gross")}>看總營收</span>
      <span style={seg(mode === "net")} onClick={() => onChange("net")}>看淨利</span>
    </div>
  );
}
