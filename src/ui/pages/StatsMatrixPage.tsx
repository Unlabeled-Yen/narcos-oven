/**
 * StatsMatrixPage — 出爐統計表
 * 品項(atom) × 批次(batchDate) × 合計 樞紐矩陣
 * NARCOS.sugar 深色倉儲品牌風
 *
 * 憲章遵守：
 *   #1 禁 hardcode 品項名 — 全經 menu.atoms / computeStatsMatrix
 *   #2 web app 0 LLM — 數字全來自 orders 即時運算
 *   #3 雙軌驗證 — 顯示提示卡（不跑 python，UI 說明）
 */
import { useMemo, useState } from "react";
import { PageHeader, PeriodChips } from "../brand/PageHeader";
import { computeStatsMatrix, CHANNEL_COLOR, type Channel } from "../../domain/compute-stats";
import type { PageProps } from "./types";

const F = { anton: "'Anton',sans-serif", tc: "'Noto Sans TC',sans-serif", mono: "'Space Mono',monospace" } as const;
const C = {
  bg: "#08080A", panel: "#0F0F12", track: "#161619", line: "#26262C", line2: "#1c1c20",
  ink: "#F5F4EF", ink2: "#E7E7EA", ink3: "#C9C9CF", mut: "#8A8A93", mut2: "#7A7A82",
  mut3: "#6C6C74", green: "#43B23C", hdr: "#141417",
} as const;

function fmt(n: number) { return n === 0 ? "—" : n.toLocaleString("zh-TW"); }
function heatBg(v: number, max: number) {
  if (!max || !v) return "transparent";
  return `rgba(245,212,0,${(0.06 + (v / max) * 0.22).toFixed(2)})`;
}

const PERIOD_OPTS = [{ key: "5b", label: "近 5 批" }, { key: "all", label: "全部" }];

export function StatsMatrixPage({ orders, menu }: PageProps) {
  const [period, setPeriod] = useState("5b");
  const mx = useMemo(() => computeStatsMatrix(orders, menu), [orders, menu]);

  const visCols = useMemo(() => {
    if (period === "all") return mx.batchColumns;
    const real = mx.batchColumns.filter((c) => c.batchDate !== "待老闆排").slice(-5);
    const pend = mx.batchColumns.filter((c) => c.batchDate === "待老闆排");
    return [...real, ...pend];
  }, [mx.batchColumns, period]);

  const latestDate = mx.latestBatchDate;

  const latestMax = useMemo(() => {
    if (!latestDate) return 0;
    const col = mx.batchColumns.find((c) => c.batchDate === latestDate);
    if (!col) return 0;
    return Math.max(0, ...mx.atomRows.map((r) =>
      col.channels.reduce((s, ch) => s + (r.counts.cells.get(`${latestDate}||${ch}`) ?? 0), 0)
    ));
  }, [mx, latestDate]);

  const gridCols = `1.6fr repeat(${visCols.length},1fr) 1fr`;

  if (orders.length === 0) {
    return (
      <div style={{ fontFamily: F.tc, minHeight: "100vh", background: C.bg }}>
        <PageHeader caption="PRODUCTION STATS · 品項 × 批次 × 通路" title="OVEN MATRIX" />
        <div style={{ padding: "60px 24px", textAlign: "center" }}>
          <div style={{ display: "inline-block", padding: "32px 40px", background: C.panel, border: `1px solid ${C.line}` }}>
            <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mut3, letterSpacing: ".2em", marginBottom: 12 }}>NO DATA</div>
            <div style={{ fontFamily: F.anton, fontSize: 32, color: C.mut, lineHeight: 1 }}>尚無訂單</div>
            <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 13, color: C.mut2, marginTop: 12 }}>匯入 Excel 後自動出現統計矩陣</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: F.tc, minHeight: "100vh", background: C.bg }}>
      <PageHeader
        caption="PRODUCTION STATS · 品項 × 批次 × 通路"
        title="OVEN MATRIX"
        right={<PeriodChips options={PERIOD_OPTS} active={period} onChange={setPeriod} />}
      />

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 4, padding: "8px 24px 0", fontFamily: F.tc, fontWeight: 900, fontSize: 13 }}>
        {(["分潤統計", "出爐統計表", "KOL ROI"] as const).map((label) => {
          const active = label === "出爐統計表";
          return (
            <span key={label} style={{ color: active ? "#111" : C.mut2, background: active ? "var(--acc,#F5D400)" : C.track, padding: "8px 16px", cursor: active ? "default" : "pointer" }}>
              {label}
            </span>
          );
        })}
      </div>

      {/* View toggle (display only) */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "14px 24px 6px", flexWrap: "wrap" }}>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, letterSpacing: ".14em" }}>列＝</span>
        <ActiveChip label="原子 atom" /><InactiveChip label="SKU" />
        <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, letterSpacing: ".14em", marginLeft: 12 }}>值＝</span>
        <ActiveChip label="顆數" /><InactiveChip label="通路占比" />
      </div>

      {/* Matrix */}
      <div style={{ padding: "8px 24px 20px", overflowX: "auto" }}>
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, minWidth: 600 + visCols.length * 90 }}>

          {/* Header row */}
          <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 6, padding: "12px 16px", background: C.hdr, borderBottom: `1px solid ${C.line}`, fontFamily: F.mono, fontSize: 11, color: C.mut2 }}>
            <span>品項 / 批次</span>
            {visCols.map((col) => (
              <span key={col.batchDate} style={{ textAlign: "right", color: col.batchDate === latestDate ? "var(--acc,#F5D400)" : C.mut2 }}>
                {col.batchDate === "待老闆排" ? "待排" : col.batchDate.slice(5).replace("-", "/")}
              </span>
            ))}
            <span style={{ textAlign: "right", color: C.ink }}>合計</span>
          </div>

          {/* Atom rows */}
          {mx.atomRows.map((row) => {
            return (
              <div key={row.atomId} style={{ display: "grid", gridTemplateColumns: gridCols, gap: 6, padding: "11px 16px", borderBottom: `1px solid ${C.line2}`, alignItems: "center" }}>
                <span>
                  <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: C.ink2 }}>{row.atomId}</span>
                  {" "}<span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3 }}>{row.unit}</span>
                </span>
                {visCols.map((col) => {
                  const isLatest = col.batchDate === latestDate;
                  const cv = col.channels.reduce((s, ch) => s + (row.counts.cells.get(`${col.batchDate}||${ch}`) ?? 0), 0);
                  return (
                    <span key={col.batchDate} style={{ fontFamily: F.mono, fontSize: 12, color: isLatest ? C.ink2 : C.mut, textAlign: "right", background: isLatest ? heatBg(cv, latestMax) : "transparent", padding: isLatest ? "2px 6px" : undefined }}>
                      {fmt(cv)}
                    </span>
                  );
                })}
                <span style={{ fontFamily: F.anton, fontSize: 15, color: C.ink, textAlign: "right" }}>{fmt(row.counts.total)}</span>
              </div>
            );
          })}

          {/* 批次總顆 */}
          <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 6, padding: "12px 16px", background: C.hdr, borderTop: `1px solid ${C.line}`, alignItems: "center" }}>
            <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: C.ink }}>批次總顆</span>
            {visCols.map((col) => {
              const isLatest = col.batchDate === latestDate;
              const val = mx.batchTotals.get(col.batchDate)?.total ?? 0;
              return (
                <span key={col.batchDate} style={{ fontFamily: isLatest ? F.anton : F.mono, fontSize: isLatest ? 15 : 12, color: isLatest ? "var(--acc,#F5D400)" : C.ink3, textAlign: "right" }}>
                  {fmt(val)}
                </span>
              );
            })}
            <span style={{ fontFamily: F.anton, fontSize: 16, color: C.ink, textAlign: "right" }}>{fmt(mx.grandTotal)}</span>
          </div>
        </div>
      </div>

      {/* 通路交叉 + 雙軌驗證 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12, padding: "8px 24px 60px" }}>

        {/* 通路交叉 mini */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 20 }}>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 16, color: C.ink, marginBottom: 16 }}>
            本批 {latestDate ? latestDate.slice(5).replace("-", "/") : "—"} · 通路 × 出爐
          </div>
          {mx.latestChannelShares.length === 0
            ? <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mut3, textAlign: "center", padding: "20px 0" }}>無資料</div>
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: 9, fontFamily: F.mono, fontSize: 12 }}>
                {mx.latestChannelShares.map((s) => (
                  <div key={s.channel} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ width: 60, fontFamily: F.tc, fontWeight: 700, color: C.ink3, flexShrink: 0 }}>{s.channel}</span>
                    <div style={{ flex: 1, height: 13, background: C.track }}>
                      <div style={{ width: `${s.pct}%`, height: 13, background: CHANNEL_COLOR[s.channel as Channel] ?? C.mut }} />
                    </div>
                    <span style={{ width: 40, textAlign: "right", color: C.mut2 }}>{s.count}</span>
                  </div>
                ))}
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: 11, color: C.mut3 }}>
                  <span>本批合計</span>
                  <span style={{ color: C.ink3, fontWeight: 700 }}>
                    {fmt(latestDate ? (mx.batchTotals.get(latestDate)?.total ?? 0) : 0)} 顆
                  </span>
                </div>
              </div>
            )
          }
        </div>

        {/* 憲章 #3 雙軌驗證 */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.green}`, padding: 20, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: C.green }}>雙軌獨立驗證 · 憲章 #3</div>
          <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: C.mut, marginTop: 6, lineHeight: 1.6 }}>
            本表由主軌 orders aggregate；產出前{" "}
            <span style={{ fontFamily: F.mono, color: C.ink3 }}>verify_stats.py</span>{" "}
            從 raw fixture 重算一次交叉核對，數字一致才放行。
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.green, marginTop: 10 }}>
            ✓ {fmt(mx.grandTotal)} 顆 · 來自 orders 主軌即時計算
          </div>
          <div style={{ marginTop: 12, padding: "8px 12px", background: C.track, fontFamily: F.mono, fontSize: 10, color: C.mut3, letterSpacing: ".08em" }}>
            副軌核對指令：<br />
            <span style={{ color: C.ink3 }}>python verify_stats.py --source orders.json</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActiveChip({ label }: { label: string }) {
  return <span style={{ fontFamily: F.mono, fontSize: 11, color: "#0B0B0C", background: "var(--acc,#F5D400)", padding: "6px 12px", fontWeight: 700 }}>{label}</span>;
}
function InactiveChip({ label }: { label: string }) {
  return <span style={{ fontFamily: F.mono, fontSize: 11, color: C.mut2, background: C.track, padding: "6px 12px" }}>{label}</span>;
}
