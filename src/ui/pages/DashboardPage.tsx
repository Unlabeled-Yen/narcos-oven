/**
 * DashboardPage — NARCOS.sugar 深色倉儲控制台
 * 憲章 #1: 禁 hardcode 品項字串（一律 getDisplayName）
 * 憲章 #2: 主軌 0 LLM，數字全由 props.orders 即時算
 *
 * Shell 負責 CommandBar / WarningTape / GrainOverlay。
 * 本頁 render：PageHeader + body。
 *
 * Yen 2026-07-16 · 版面改為「鎖一個視窗、不滾輪」：
 *   釘住   KPI 六宮格 + 資料健康度狀態條
 *   牌組   ‹ › 左右翻頁，P1 趨勢 / P2 結構（鍵盤 ← → 可翻）
 * 健康度刻意不進牌組 —— 它是產出閘門（憲章 #9/#10），
 * 是門不是分析面板，翻到第二頁去就等於沒在守。
 */
import { useEffect, useMemo, useState } from "react";
import { PageHeader, PeriodChips } from "../brand/PageHeader";
import { ExportBtn } from "../brand/ExportBtn";
import { writePeriodSummaryExcel } from "../../output/period-summary-excel";
import { BackupControls } from "../brand/BackupControls";
import { getDisplayName } from "../../domain/menu";
import {
  computeKpiCounts,
  computeBatchKpi,
  computeMonthTrend,
  computeTopProducts,
  computeChannelShare,
  computeRepeatCustomers,
  computeHealthChecks,
  type HealthCheck,
} from "../../domain/compute-dashboard";
import type { PageProps } from "./types";

const F = { anton: "'Anton',sans-serif", tc: "'Noto Sans TC',sans-serif", mono: "'Space Mono',monospace" } as const;
const PERIODS = [{ key: "june", label: "六月" }, { key: "8w", label: "近 8 週" }, { key: "all", label: "全部" }];
const DECK = [{ key: "trend", label: "趨勢" }, { key: "mix", label: "結構" }] as const;
const EMBER = "#E5622A";

// ── Small shared components ───────────────────────────────────────────────────

function PanelBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "#0F0F12", border: "1px solid #26262C", padding: 20,
      display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden",
    }}>
      {children}
    </div>
  );
}

function PanelHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16, flex: "none" }}>
      <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: "#F5F4EF" }}>
        {title} {sub && <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 11, color: "#6C6C74" }}>{sub}</span>}
      </span>
      {right}
    </div>
  );
}

function Kpi({ label, accent, labelColor, foot, footColor, children }: {
  label: string; accent?: string; labelColor?: string; foot?: string; footColor?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ background: "#111114", border: "1px solid #26262C", borderLeft: accent ? `3px solid ${accent}` : "1px solid #26262C", padding: 14 }}>
      <div style={{ fontFamily: F.mono, fontSize: 10, color: labelColor ?? "#7A7A82", letterSpacing: ".12em" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", marginTop: 6 }}>{children}</div>
      {foot && <div style={{ fontFamily: F.mono, fontSize: 10, color: footColor ?? "#6C6C74", marginTop: 6 }}>{foot}</div>}
    </div>
  );
}

function BigNum({ v, color = "#F5F4EF", size = 38 }: { v: string | number; color?: string; size?: number }) {
  return <span style={{ fontFamily: F.anton, fontSize: size, color, lineHeight: 0.85 }}>{v}</span>;
}

/**
 * 長條圖的一根。高度用 % 而非固定 px —— 牌組高度隨視窗變，
 * 固定 px 會在矮螢幕爆出去、逼出滾輪（正是本次要根治的）。
 */
function Bar({ label, v, pct, color, isHot, hatch }: { label: string; v: string; pct: number; color: string; isHot?: boolean; hatch?: boolean }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: F.mono, fontSize: isHot ? 13 : 12, color: isHot ? color : "#8A8A93", fontWeight: isHot ? 700 : 400, flex: "none" }}>{v}</span>
      <div style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", alignItems: "flex-end" }}>
        <div style={{ width: "100%", height: `${Math.max(pct, 0.6)}%`, background: color, position: "relative" }}>
          {hatch && <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(45deg,#2E2E34 0 6px,#161619 6px 12px)" }} />}
        </div>
      </div>
      <span style={{ fontFamily: F.mono, fontSize: 11, color: isHot ? color : "#6C6C74", flex: "none" }}>{label}</span>
    </div>
  );
}

function BarField({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", alignItems: "stretch", gap: 16, flex: 1, minHeight: 0 }}>{children}</div>;
}

function EmptyRow() {
  return <div style={{ fontFamily: F.mono, fontSize: 12, color: "#6C6C74" }}>暫無資料</div>;
}

/**
 * 資料健康度狀態條 —— 產出閘門的常駐燈號。永遠釘在 KPI 底下、翻頁翻不掉。
 */
function HealthStrip({ checks }: { checks: HealthCheck[] }) {
  const blocked = checks.some((h) => h.color === EMBER);
  return (
    <div style={{
      flex: "none", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap",
      padding: "8px 24px", background: "#0F0F12",
      borderTop: "1px solid #26262C", borderBottom: "1px solid #26262C",
    }}>
      <span style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", letterSpacing: ".12em" }}>資料健康度 · 憲章防護</span>
      {checks.map((h) => (
        <span key={h.label} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: h.color, flexShrink: 0, display: "inline-block" }} />
          <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#C9C9CF" }}>{h.label}</span>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: h.color }}>{h.value}</span>
        </span>
      ))}
      {blocked && (
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, padding: "3px 11px", background: "#161619", borderLeft: `3px solid ${EMBER}` }}>
          <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 11, color: EMBER }}>⚠ 產出閘門</span>
          <span style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 11, color: "#8A8A93" }}>待處理清空前 Excel/PDF disabled</span>
        </span>
      )}
    </div>
  );
}

/**
 * 牌組翻頁器。刻意放底部、用箭頭＋圓點 —— 上方已有一排黃色子分頁
 * （總覽/分潤/出爐/KOL/駐店），再做成同款 chip 會變成兩層水平切換、分不清。
 */
function Pager({ active, onChange }: { active: number; onChange: (i: number) => void }) {
  const arrow = (dir: -1 | 1, glyph: string) => {
    const next = active + dir;
    const disabled = next < 0 || next >= DECK.length;
    return (
      <button
        type="button"
        onClick={() => !disabled && onChange(next)}
        disabled={disabled}
        aria-label={dir === -1 ? "上一頁" : "下一頁"}
        style={{
          fontFamily: F.mono, fontSize: 15, lineHeight: 1,
          color: disabled ? "#2E2E34" : "#8A8A93",
          background: "transparent", border: "1px solid " + (disabled ? "#1C1C21" : "#26262C"),
          padding: "5px 12px", cursor: disabled ? "default" : "pointer",
        }}
      >
        {glyph}
      </button>
    );
  };
  return (
    <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "10px 24px 14px" }}>
      {arrow(-1, "‹")}
      {DECK.map((p, i) => {
        const on = i === active;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(i)}
            aria-label={`第 ${i + 1} 頁 · ${p.label}`}
            aria-current={on ? "true" : undefined}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              background: "transparent", border: "none", padding: "5px 8px", cursor: "pointer",
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: on ? "var(--acc,#F5D400)" : "#3E3E46", display: "inline-block" }} />
            <span style={{ fontFamily: F.tc, fontWeight: on ? 900 : 500, fontSize: 12, color: on ? "#F5F4EF" : "#6C6C74" }}>{p.label}</span>
          </button>
        );
      })}
      {arrow(1, "›")}
      <span style={{ fontFamily: F.mono, fontSize: 10, color: "#3E3E46", marginLeft: 6 }}>← →</span>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function DashboardPage({ orders, menu, refreshOrders }: PageProps) {
  const [period, setPeriod] = useState("8w");
  const [page, setPage] = useState(0);

  const kpi = useMemo(() => computeKpiCounts(orders), [orders]);
  const batchKpi = useMemo(() => computeBatchKpi(orders), [orders]);
  const monthTrend = useMemo(() => computeMonthTrend(orders), [orders]);
  const topProducts = useMemo(() => computeTopProducts(orders), [orders]);
  const channelShare = useMemo(() => computeChannelShare(orders), [orders]);
  const repeatStats = useMemo(() => computeRepeatCustomers(orders), [orders]);
  const healthChecks = useMemo(() => computeHealthChecks(orders), [orders]);

  // 鍵盤翻頁。沿用專案既有的鍵盤流文化（待處理桶用 J/K、排程用 ‹ ›）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "ArrowLeft") setPage((p) => Math.max(0, p - 1));
      else if (e.key === "ArrowRight") setPage((p) => Math.min(DECK.length - 1, p + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const batchDateDisplay = batchKpi.batchDate ? batchKpi.batchDate.slice(5).replace("-", "/") : "—";
  const topMax = topProducts[0]?.qty ?? 1;
  const maxRevenue = Math.max(...monthTrend.map((m) => m.revenue), 1);
  const maxOrders = Math.max(...monthTrend.map((m) => m.orders), 1);
  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  if (orders.length === 0) {
    return (
      <div className="h-full flex flex-col min-h-0" style={{ fontFamily: F.tc }}>
        <PageHeader caption="DASHBOARD · 跨批統計" title="OVEN CENTRAL"
          right={<PeriodChips options={PERIODS} active={period} onChange={setPeriod} />} />
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <div style={{ margin: "40px 24px", padding: "32px 24px", background: "#0F0F12", border: "1px solid #26262C", borderLeft: `3px solid ${EMBER}`, fontFamily: F.mono, fontSize: 13, color: "#8A8A93" }}>
            <span style={{ fontFamily: F.tc, fontWeight: 900, color: EMBER }}>暫無資料</span>
            {" "}— 請上傳訂單 Excel 以開始。
          </div>
        </div>
      </div>
    );
  }

  const latestMonth = monthTrend[monthTrend.length - 1]?.month;

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden" style={{ fontFamily: F.tc }}>
      <PageHeader caption="DASHBOARD · 跨批統計" title="OVEN CENTRAL"
        right={
          <div className="flex items-center" style={{ gap: 10 }}>
            <PeriodChips options={PERIODS} active={period} onChange={setPeriod} />
            <ExportBtn
              label="匯出彙總"
              filename="dashboard_period_summary"
              onExport={() => writePeriodSummaryExcel(orders, menu, { type: "all" })}
            />
            <BackupControls refreshOrders={refreshOrders} />
          </div>
        } />

      {/* ── 釘住層 1：KPI 六宮格 ─────────────────────────────────── */}
      <div style={{ flex: "none", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, padding: "10px 24px 12px" }}>
        <Kpi accent="var(--acc,#F5D400)" label={`本批出爐 · ${batchDateDisplay}`}
          foot={Object.entries(batchKpi.otherAtoms).slice(0, 3).map(([id, n]) => `+${n} ${getDisplayName(id, menu)}`).join(" · ") || "—"}>
          <BigNum v={batchKpi.cinnamonCount} />
          <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 14, color: "#8A8A93", marginLeft: 7 }}>顆肉桂捲</span>
        </Kpi>
        <Kpi label="活躍訂單" foot={channelShare.slice(0, 3).map((c) => `${c.label}${c.count}`).join(" ") || "—"}>
          <BigNum v={kpi.active} />
        </Kpi>
        <Kpi accent="#43B23C" labelColor="#43B23C" label="CONFIRMED" foot="主軌通過">
          <BigNum v={kpi.confirmed} />
        </Kpi>
        <Kpi accent={EMBER} labelColor={EMBER} label="待處理桶" foot="標籤未定">
          <BigNum v={kpi.pending} color={EMBER} />
        </Kpi>
        <Kpi accent="#43B23C" labelColor="#43B23C" label="消失待拍板"
          foot={kpi.disappeared === 0 ? "✓ 可產出" : `${kpi.disappeared} 待確認`}
          footColor={kpi.disappeared === 0 ? "#43B23C" : EMBER}>
          <BigNum v={kpi.disappeared} color={kpi.disappeared === 0 ? "#F5F4EF" : EMBER} />
        </Kpi>
        <Kpi label="本月 GMV" foot={kpi.currentMonthGmv > 0 ? "已確認訂單加總" : "暫無本月訂單"} footColor={kpi.currentMonthGmv > 0 ? "#43B23C" : "#6C6C74"}>
          <span style={{ fontFamily: F.mono, fontSize: 14, color: "#8A8A93" }}>NT$</span>
          <BigNum v={kpi.currentMonthGmv.toLocaleString()} size={32} />
        </Kpi>
      </div>

      {/* ── 釘住層 2：產出閘門燈號 ───────────────────────────────── */}
      <HealthStrip checks={healthChecks} />

      {/* ── 牌組：P1 趨勢 / P2 結構 ──────────────────────────────── */}
      {page === 0 && (
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(330px,1fr))", gap: 12, padding: "12px 24px 0" }}>
          {/* 出爐量趨勢 */}
          <PanelBox>
            <PanelHead title="出爐量趨勢" sub="訂單數 / 月"
              right={<span style={{ fontFamily: F.mono, fontSize: 11, color: "var(--acc,#F5D400)" }}>● 週二出爐</span>} />
            {monthTrend.length === 0 ? <EmptyRow /> : (
              <BarField>
                {monthTrend.map((m) => {
                  const isHot = m.month === latestMonth;
                  return (
                    <Bar key={m.month}
                      label={m.month.slice(5).replace("-", "/")}
                      v={String(m.orders)}
                      pct={(m.orders / maxOrders) * 100}
                      color={isHot ? "var(--acc,#F5D400)" : "#2E2E34"}
                      isHot={isHot} />
                  );
                })}
              </BarField>
            )}
          </PanelBox>

          {/* 月營收趨勢 */}
          <PanelBox>
            <PanelHead title="月營收趨勢" sub="NT$ · 含運"
              right={(() => {
                if (monthTrend.length < 2) return null;
                const prev = monthTrend[monthTrend.length - 2]!.revenue;
                const curr = monthTrend[monthTrend.length - 1]!.revenue;
                const pct = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
                return <span style={{ fontFamily: F.mono, fontSize: 11, color: pct >= 0 ? "#43B23C" : "#E5352B" }}>{pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%</span>;
              })()} />
            {monthTrend.length === 0 ? <EmptyRow /> : (
              <>
                <BarField>
                  {monthTrend.map((m, idx) => {
                    const isLatest = idx === monthTrend.length - 1;
                    const isCurrentMonth = m.month === currentYM;
                    const shortLabel = m.month.slice(5).replace(/^0/, "") + "月" + (isCurrentMonth ? "*" : "");
                    const revLabel = m.revenue >= 1000 ? `${(m.revenue / 1000).toFixed(1)}k` : m.revenue.toLocaleString();
                    return (
                      <Bar key={m.month}
                        label={shortLabel}
                        v={revLabel}
                        pct={(m.revenue / maxRevenue) * 100}
                        color={isLatest ? "#2AC7E8" : "#2E2E34"}
                        isHot={isLatest}
                        hatch={isCurrentMonth} />
                    );
                  })}
                </BarField>
                {monthTrend.some((m) => m.month === currentYM) && (
                  <div style={{ flex: "none", fontFamily: F.mono, fontSize: 10, color: "#6C6C74", marginTop: 8, textAlign: "right" }}>* 本月至今 · 進行中</div>
                )}
              </>
            )}
          </PanelBox>
        </div>
      )}

      {page === 1 && (
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, padding: "12px 24px 0" }}>
          {/* 通路占比 */}
          <PanelBox>
            <PanelHead title="通路占比" />
            {channelShare.length === 0 ? <EmptyRow /> : (
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                <div style={{ display: "flex", height: 26, marginBottom: 16 }}>
                  {channelShare.map((c) => <div key={c.label} style={{ width: `${c.pct}%`, background: c.color }} />)}
                </div>
                {channelShare.map((c) => (
                  <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: F.mono, fontSize: 12, marginBottom: 8 }}>
                    <span style={{ width: 9, height: 9, background: c.color, flexShrink: 0, display: "inline-block" }} />
                    <span style={{ flex: 1, color: "#C9C9CF" }}>{c.label}</span>
                    <span style={{ color: "#7A7A82" }}>{c.count} · {c.pct.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}
          </PanelBox>

          {/* 回頭率 */}
          <PanelBox>
            <PanelHead title="客戶回頭率" />
            <div style={{ flex: "none", display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontFamily: F.anton, fontSize: 46, color: "#2AC7E8", lineHeight: 0.85 }}>
                {repeatStats.totalUnique > 0 ? `${Math.round(repeatStats.repeatPct)}%` : "—"}
              </span>
              <span style={{ fontFamily: F.mono, fontSize: 11, color: "#7A7A82" }}>{repeatStats.repeatCount} / {repeatStats.totalUnique} 位</span>
            </div>
            <div style={{ flex: "none", height: 1, background: "#26262C", margin: "14px 0" }} />
            <div style={{ flex: "none", fontFamily: F.mono, fontSize: 10, color: "#6C6C74", letterSpacing: ".1em", marginBottom: 10 }}>TOP 回頭客</div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {repeatStats.topRepeats.length === 0 ? (
                <div style={{ fontFamily: F.mono, fontSize: 12, color: "#6C6C74" }}>暫無回頭客</div>
              ) : repeatStats.topRepeats.map(({ key, count }) => (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: 12, marginBottom: 7 }}>
                  <span style={{ color: "#C9C9CF" }}>{key}</span>
                  <span style={{ color: "#7A7A82" }}>{count} 單</span>
                </div>
              ))}
            </div>
          </PanelBox>

          {/* TOP 10 品項 */}
          <PanelBox>
            <PanelHead title="TOP 10 品項" sub="份 · 本月" />
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {topProducts.length === 0 ? <EmptyRow /> : topProducts.map((it, i) => {
                const isLead = i === 0;
                const barW = Math.round((it.qty / topMax) * 100);
                return (
                  <div key={it.skuId} style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: F.mono, marginBottom: 9 }}>
                    <span style={{ width: 20, color: isLead ? "var(--acc,#F5D400)" : "#7A7A82", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span style={{ width: "40%", fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#E7E7EA", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {getDisplayName(it.skuId, menu)}
                    </span>
                    <div style={{ flex: 1, height: 13, background: "#161619" }}>
                      <div style={{ width: `${barW}%`, height: 13, background: isLead ? "var(--acc,#F5D400)" : "#3E3E46" }} />
                    </div>
                    <span style={{ width: 24, textAlign: "right", fontSize: 12, color: "#C9C9CF" }}>{it.qty}</span>
                  </div>
                );
              })}
            </div>
          </PanelBox>
        </div>
      )}

      <Pager active={page} onChange={setPage} />
    </div>
  );
}
