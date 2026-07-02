/**
 * DashboardPage — NARCOS.sugar 深色倉儲控制台
 * 憲章 #1: 禁 hardcode 品項字串（一律 getDisplayName）
 * 憲章 #2: 主軌 0 LLM，數字全由 props.orders 即時算
 *
 * Shell 負責 CommandBar / WarningTape / GrainOverlay。
 * 本頁 render：PageHeader + body。
 */
import { useState, useMemo } from "react";
import { PageHeader, PeriodChips } from "../brand/PageHeader";
import { getDisplayName } from "../../domain/menu";
import {
  computeKpiCounts,
  computeBatchKpi,
  computeMonthTrend,
  computeTopProducts,
  computeChannelShare,
  computeRepeatCustomers,
  computeAtomTotals,
  computeHealthChecks,
} from "../../domain/compute-dashboard";
import type { PageProps } from "./types";

const F = { anton: "'Anton',sans-serif", tc: "'Noto Sans TC',sans-serif", mono: "'Space Mono',monospace" } as const;
const PERIODS = [{ key: "june", label: "六月" }, { key: "8w", label: "近 8 週" }, { key: "all", label: "全部" }];
const MAX_BAR_H = 190;

// ── Small shared components ───────────────────────────────────────────────────

function PanelBox({ children }: { children: React.ReactNode }) {
  return <div style={{ background: "#0F0F12", border: "1px solid #26262C", padding: 20 }}>{children}</div>;
}

function PanelHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
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
    <div style={{ background: "#111114", border: "1px solid #26262C", borderLeft: accent ? `3px solid ${accent}` : "1px solid #26262C", padding: 18 }}>
      <div style={{ fontFamily: F.mono, fontSize: 10, color: labelColor ?? "#7A7A82", letterSpacing: ".12em" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", marginTop: 8 }}>{children}</div>
      {foot && <div style={{ fontFamily: F.mono, fontSize: 10, color: footColor ?? "#6C6C74", marginTop: 7 }}>{foot}</div>}
    </div>
  );
}

function BigNum({ v, color = "#F5F4EF", size = 42 }: { v: string | number; color?: string; size?: number }) {
  return <span style={{ fontFamily: F.anton, fontSize: size, color, lineHeight: 0.85 }}>{v}</span>;
}

function Bar({ label, v, h, color, isHot, hatch }: { label: string; v: string; h: number; color: string; isHot?: boolean; hatch?: boolean }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: F.mono, fontSize: isHot ? 13 : 12, color: isHot ? color : "#8A8A93", fontWeight: isHot ? 700 : 400 }}>{v}</span>
      <div style={{ width: "100%", height: h, background: color, position: "relative" }}>
        {hatch && <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(45deg,#2E2E34 0 6px,#161619 6px 12px)" }} />}
      </div>
      <span style={{ fontFamily: F.mono, fontSize: 11, color: isHot ? color : "#6C6C74" }}>{label}</span>
    </div>
  );
}

function EmptyRow() {
  return <div style={{ fontFamily: F.mono, fontSize: 12, color: "#6C6C74" }}>暫無資料</div>;
}

// ── Main page ────────────────────────────────────────────────────────────────

export function DashboardPage({ orders, menu }: PageProps) {
  const [period, setPeriod] = useState("8w");

  const kpi = useMemo(() => computeKpiCounts(orders), [orders]);
  const batchKpi = useMemo(() => computeBatchKpi(orders), [orders]);
  const monthTrend = useMemo(() => computeMonthTrend(orders), [orders]);
  const topProducts = useMemo(() => computeTopProducts(orders), [orders]);
  const channelShare = useMemo(() => computeChannelShare(orders), [orders]);
  const repeatStats = useMemo(() => computeRepeatCustomers(orders), [orders]);
  const atomTotals = useMemo(() => computeAtomTotals(orders), [orders]);
  const healthChecks = useMemo(() => computeHealthChecks(orders), [orders]);

  const batchDateDisplay = batchKpi.batchDate ? batchKpi.batchDate.slice(5).replace("-", "/") : "—";
  const topMax = topProducts[0]?.qty ?? 1;
  const maxAtomTotal = atomTotals[0]?.total ?? 1;
  const totalAtomSum = atomTotals.reduce((s, a) => s + a.total, 0);
  const maxRevenue = Math.max(...monthTrend.map((m) => m.revenue), 1);
  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  if (orders.length === 0) {
    return (
      <div style={{ fontFamily: F.tc }}>
        <PageHeader caption="DASHBOARD · 跨批統計" title="OVEN CENTRAL"
          right={<PeriodChips options={PERIODS} active={period} onChange={setPeriod} />} />
        <div style={{ margin: "40px 24px", padding: "32px 24px", background: "#0F0F12", border: "1px solid #26262C", borderLeft: "3px solid #E5622A", fontFamily: F.mono, fontSize: 13, color: "#8A8A93" }}>
          <span style={{ fontFamily: F.tc, fontWeight: 900, color: "#E5622A" }}>暫無資料</span>
          {" "}— 請上傳訂單 Excel 以開始。
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: F.tc }}>
      <PageHeader caption="DASHBOARD · 跨批統計" title="OVEN CENTRAL"
        right={<PeriodChips options={PERIODS} active={period} onChange={setPeriod} />} />

      {/* KPI ROW */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, padding: "16px 24px" }}>
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
        <Kpi accent="#E5622A" labelColor="#E5622A" label="待處理桶" foot="標籤未定">
          <BigNum v={kpi.pending} color="#E5622A" />
        </Kpi>
        <Kpi accent="#43B23C" labelColor="#43B23C" label="消失待拍板"
          foot={kpi.disappeared === 0 ? "✓ 可產出" : `${kpi.disappeared} 待確認`}
          footColor={kpi.disappeared === 0 ? "#43B23C" : "#E5622A"}>
          <BigNum v={kpi.disappeared} color={kpi.disappeared === 0 ? "#F5F4EF" : "#E5622A"} />
        </Kpi>
        <Kpi label="本月 GMV" foot={kpi.currentMonthGmv > 0 ? "已確認訂單加總" : "暫無本月訂單"} footColor={kpi.currentMonthGmv > 0 ? "#43B23C" : "#6C6C74"}>
          <span style={{ fontFamily: F.mono, fontSize: 14, color: "#8A8A93" }}>NT$</span>
          <BigNum v={kpi.currentMonthGmv.toLocaleString()} size={36} />
        </Kpi>
      </div>

      {/* 趨勢兩欄 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: 12, padding: "8px 24px" }}>
        {/* 出爐量趨勢 */}
        <PanelBox>
          <PanelHead title="出爐量趨勢" sub="訂單數 / 月"
            right={<span style={{ fontFamily: F.mono, fontSize: 11, color: "var(--acc,#F5D400)" }}>● 週二出爐</span>} />
          {monthTrend.length === 0 ? <EmptyRow /> : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 16, height: MAX_BAR_H }}>
              {(() => {
                const maxOrders = Math.max(...monthTrend.map((m) => m.orders), 1);
                const latestMonth = monthTrend[monthTrend.length - 1]?.month;
                return monthTrend.map((m) => {
                  const isHot = m.month === latestMonth;
                  const barH = Math.round((m.orders / maxOrders) * MAX_BAR_H);
                  return (
                    <Bar key={m.month}
                      label={m.month.slice(5).replace("-", "/")}
                      v={String(m.orders)}
                      h={barH}
                      color={isHot ? "var(--acc,#F5D400)" : "#2E2E34"}
                      isHot={isHot} />
                  );
                });
              })()}
            </div>
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
              <div style={{ display: "flex", alignItems: "flex-end", gap: 26, height: MAX_BAR_H }}>
                {monthTrend.map((m, idx) => {
                  const isLatest = idx === monthTrend.length - 1;
                  const isCurrentMonth = m.month === currentYM;
                  const barH = Math.round((m.revenue / maxRevenue) * MAX_BAR_H);
                  const shortLabel = m.month.slice(5).replace(/^0/, "") + "月" + (isCurrentMonth ? "*" : "");
                  const revLabel = m.revenue >= 1000 ? `${(m.revenue / 1000).toFixed(1)}k` : m.revenue.toLocaleString();
                  return (
                    <Bar key={m.month}
                      label={shortLabel}
                      v={revLabel}
                      h={barH}
                      color={isLatest ? "#2AC7E8" : "#2E2E34"}
                      isHot={isLatest}
                      hatch={isCurrentMonth} />
                  );
                })}
              </div>
              {monthTrend.some((m) => m.month === currentYM) && (
                <div style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", marginTop: 10, textAlign: "right" }}>* 本月至今 · 進行中</div>
              )}
            </>
          )}
        </PanelBox>
      </div>

      {/* 通路 + 回頭 + 健康 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12, padding: "8px 24px" }}>
        {/* 通路占比 */}
        <PanelBox>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: "#F5F4EF", marginBottom: 16 }}>通路占比</div>
          {channelShare.length === 0 ? <EmptyRow /> : (
            <>
              <div style={{ display: "flex", height: 28, marginBottom: 16 }}>
                {channelShare.map((c) => <div key={c.label} style={{ width: `${c.pct}%`, background: c.color }} />)}
              </div>
              {channelShare.map((c) => (
                <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: F.mono, fontSize: 12, marginBottom: 8 }}>
                  <span style={{ width: 9, height: 9, background: c.color, flexShrink: 0, display: "inline-block" }} />
                  <span style={{ flex: 1, color: "#C9C9CF" }}>{c.label}</span>
                  <span style={{ color: "#7A7A82" }}>{c.count} · {c.pct.toFixed(0)}%</span>
                </div>
              ))}
            </>
          )}
        </PanelBox>

        {/* 回頭率 */}
        <PanelBox>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: "#F5F4EF", marginBottom: 16 }}>客戶回頭率</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: F.anton, fontSize: 52, color: "#2AC7E8", lineHeight: 0.85 }}>
              {repeatStats.totalUnique > 0 ? `${Math.round(repeatStats.repeatPct)}%` : "—"}
            </span>
            <span style={{ fontFamily: F.mono, fontSize: 11, color: "#7A7A82" }}>{repeatStats.repeatCount} / {repeatStats.totalUnique} 位</span>
          </div>
          <div style={{ height: 1, background: "#26262C", margin: "16px 0" }} />
          <div style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", letterSpacing: ".1em", marginBottom: 10 }}>TOP 回頭客</div>
          {repeatStats.topRepeats.length === 0 ? (
            <div style={{ fontFamily: F.mono, fontSize: 12, color: "#6C6C74" }}>暫無回頭客</div>
          ) : repeatStats.topRepeats.map(({ key, count }) => (
            <div key={key} style={{ display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: 12, marginBottom: 7 }}>
              <span style={{ color: "#C9C9CF" }}>{key}</span>
              <span style={{ color: "#7A7A82" }}>{count} 單</span>
            </div>
          ))}
        </PanelBox>

        {/* 資料健康度 */}
        <PanelBox>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: "#F5F4EF", marginBottom: 16 }}>
            資料健康度 <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 11, color: "#6C6C74" }}>憲章防護</span>
          </div>
          {healthChecks.map((h) => (
            <div key={h.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 11 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: h.color, flexShrink: 0, display: "inline-block" }} />
              <span style={{ flex: 1, fontFamily: F.tc, fontWeight: 700, fontSize: 13, color: "#C9C9CF" }}>{h.label}</span>
              <span style={{ fontFamily: F.mono, fontSize: 12, color: h.color }}>{h.value}</span>
            </div>
          ))}
          {healthChecks.some((h) => h.color === "#E5622A") && (
            <div style={{ marginTop: 16, padding: "11px 13px", background: "#161619", borderLeft: "3px solid #E5622A" }}>
              <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 11, color: "#E5622A" }}>⚠ 產出閘門</span>
              <span style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 11, color: "#8A8A93" }}> · 待處理清空前 Excel/PDF disabled</span>
            </div>
          )}
        </PanelBox>
      </div>

      {/* TOP 品項 + 原物料出爐總量 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: 12, padding: "8px 24px 40px" }}>
        {/* TOP 10 品項 */}
        <PanelBox>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: "#F5F4EF", marginBottom: 18 }}>
            TOP 10 品項 <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 11, color: "#6C6C74" }}>份 · 本月</span>
          </div>
          {topProducts.length === 0 ? <EmptyRow /> : topProducts.map((it, i) => {
            const isLead = i === 0;
            const barW = Math.round((it.qty / topMax) * 100);
            return (
              <div key={it.skuId} style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: F.mono, marginBottom: 10 }}>
                <span style={{ width: 20, color: isLead ? "var(--acc,#F5D400)" : "#7A7A82", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span style={{ width: "44%", fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#E7E7EA", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {getDisplayName(it.skuId, menu)}
                </span>
                <div style={{ flex: 1, height: 14, background: "#161619" }}>
                  <div style={{ width: `${barW}%`, height: 14, background: isLead ? "var(--acc,#F5D400)" : "#3E3E46" }} />
                </div>
                <span style={{ width: 24, textAlign: "right", fontSize: 12, color: "#C9C9CF" }}>{it.qty}</span>
              </div>
            );
          })}
        </PanelBox>

        {/* 原物料出爐總量 */}
        <PanelBox>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: "#F5F4EF", marginBottom: 18 }}>
            原物料出爐總量 <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 11, color: "#6C6C74" }}>atom · 本月</span>
          </div>
          {atomTotals.length === 0 ? <EmptyRow /> : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 20px" }}>
                {atomTotals.slice(0, 8).map((a, i) => {
                  const isLead = i === 0;
                  const barW = Math.round((a.total / maxAtomTotal) * 100);
                  const unit = menu.atoms[a.atomId]?.unit ?? "顆";
                  return (
                    <div key={a.atomId}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                        <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#C9C9CF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>
                          {getDisplayName(a.atomId, menu)}
                        </span>
                        <span style={{ fontFamily: F.mono, fontSize: 12, color: isLead ? "var(--acc,#F5D400)" : "#8A8A93" }}>
                          {a.total} {unit}
                        </span>
                      </div>
                      <div style={{ height: 8, background: "#161619" }}>
                        <div style={{ width: `${barW}%`, height: 8, background: isLead ? "var(--acc,#F5D400)" : "#3E3E46" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid #26262C", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#8A8A93" }}>本月出爐合計</span>
                <span style={{ fontFamily: F.anton, fontSize: 26, color: "#F5F4EF" }}>
                  {totalAtomSum} <span style={{ fontFamily: F.mono, fontSize: 12, color: "#6C6C74" }}>顆+罐</span>
                </span>
              </div>
            </>
          )}
        </PanelBox>
      </div>
    </div>
  );
}
