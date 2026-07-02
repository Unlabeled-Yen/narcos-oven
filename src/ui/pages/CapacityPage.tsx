/**
 * CapacityPage — 產能設定
 *
 * 讀 menu.production_capacity / weekly_production_budget / overhead /
 * scheduling / product_lead_time，提供 local-state 編輯。
 * 儲存/還原 = in-memory only。
 * 真實寫回走 MCP/下載（瀏覽器無法直接寫 menu.yaml）。
 *
 * 排程 Stage 9（憲章 #12）：超載一律回退待排、不自動指派。
 */
import { useState } from "react";
import { PageHeader } from "../brand/PageHeader";
import type { PageProps } from "./types";
import type { WeeklyBudget, Overhead, SchedulingConfig } from "../../domain/models";
import {
  C, F, GROUPS, WEEK_DAYS,
  DEFAULT_CAPS, DEFAULT_WEEKLY, DEFAULT_PRODUCT_LEAD,
  atomLabel, SectionTitle, FieldRow, EstimateTag, PendingTag,
} from "./CapacityPage.helpers";

// ─── State resolution from menu ──────────────────────────────────────────────
function resolveInitialState(menu: PageProps["menu"]) {
  const caps: Record<string, number> = {};
  let capsFromMenu = false;

  if (menu.production_capacity?.daily_max_by_atom) {
    capsFromMenu = true;
    Object.assign(caps, menu.production_capacity.daily_max_by_atom);
  }
  for (const g of GROUPS) {
    for (const it of g.items) {
      if (!(it.key in caps)) caps[it.key] = DEFAULT_CAPS[it.key] ?? 50;
    }
  }

  const weekly: Record<string, number> = menu.production_capacity?.weekly_pattern
    ? { ...menu.production_capacity.weekly_pattern }
    : { ...DEFAULT_WEEKLY };

  const budget: WeeklyBudget = menu.weekly_production_budget ?? {
    total_hours_min: 24, total_hours_max: 30, overflow_tuesday_extra_hours: 8,
  };
  const overhead: Overhead = menu.overhead ?? {
    product_switch_hours: 0.67, wash_mold_after_batches: 3, wash_mold_hours: 1.0,
  };
  const scheduling: SchedulingConfig = menu.scheduling ?? {
    lead_time_days: 5, regular_shipping_weekday: 2, max_retry_weeks: 10,
  };
  const productLead: Record<string, number> = {};
  for (const g of GROUPS) {
    for (const it of g.items) {
      productLead[it.key] = menu.product_lead_time?.[it.key] ?? DEFAULT_PRODUCT_LEAD[it.key] ?? 1;
    }
  }

  return { caps, weekly, budget, overhead, scheduling, productLead, capsFromMenu };
}

// ─── Main Component ──────────────────────────────────────────────────────────
export function CapacityPage(props: PageProps) {
  const { menu } = props;
  const initial = resolveInitialState(menu);

  const [caps, setCaps] = useState<Record<string, number>>(initial.caps);
  const [capInputs, setCapInputs] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(initial.caps).map(([k, v]) => [k, String(v)]))
  );
  const [weekly, setWeekly] = useState<Record<string, number>>(initial.weekly);
  const [weeklyInputs, setWeeklyInputs] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(initial.weekly).map(([k, v]) => [k, String(v)]))
  );
  const [budget, setBudget] = useState<WeeklyBudget>(initial.budget);
  const [budgetInputs, setBudgetInputs] = useState({
    min: String(initial.budget.total_hours_min),
    max: String(initial.budget.total_hours_max),
    extra: String(initial.budget.overflow_tuesday_extra_hours),
  });
  const [overhead, setOverhead] = useState<Overhead>(initial.overhead);
  const [overheadInputs, setOverheadInputs] = useState({
    switch: String(initial.overhead.product_switch_hours),
    washAfter: String(initial.overhead.wash_mold_after_batches),
    washHours: String(initial.overhead.wash_mold_hours),
  });
  const [scheduling, setScheduling] = useState<SchedulingConfig>(initial.scheduling);
  const [schedulingInputs, setSchedulingInputs] = useState({
    lead: String(initial.scheduling.lead_time_days),
  });
  const [productLead, setProductLead] = useState<Record<string, number>>(initial.productLead);
  const [productLeadInputs, setProductLeadInputs] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(initial.productLead).map(([k, v]) => [k, String(v)]))
  );
  const [saved, setSaved] = useState(false);

  // 這三個 numeric state 目前只透過 *Inputs 字串鏡像顯示、setter 在 handleReset 用到；
  // 明確 void 以滿足 noUnusedLocals（值本身保留供未來 domain 計算接用）。
  void budget;
  void overhead;
  void scheduling;

  // ── Handlers ────────────────────────────────────────────────────────────
  function handleCapChange(key: string, raw: string) {
    setCapInputs((p) => ({ ...p, [key]: raw }));
    const n = parseFloat(raw);
    if (!isNaN(n) && n >= 0) setCaps((p) => ({ ...p, [key]: n }));
    setSaved(false);
  }

  function handleWeeklyChange(dayKey: string, raw: string) {
    setWeeklyInputs((p) => ({ ...p, [dayKey]: raw }));
    const n = parseFloat(raw);
    if (!isNaN(n) && n >= 0) setWeekly((p) => ({ ...p, [dayKey]: n }));
    setSaved(false);
  }

  function handleProductLeadChange(key: string, raw: string) {
    setProductLeadInputs((p) => ({ ...p, [key]: raw }));
    const n = parseFloat(raw);
    if (!isNaN(n) && n >= 0) setProductLead((p) => ({ ...p, [key]: n }));
    setSaved(false);
  }

  function handleReset() {
    const fresh = resolveInitialState(menu);
    setCaps(fresh.caps);
    setCapInputs(Object.fromEntries(Object.entries(fresh.caps).map(([k, v]) => [k, String(v)])));
    setWeekly(fresh.weekly);
    setWeeklyInputs(Object.fromEntries(Object.entries(fresh.weekly).map(([k, v]) => [k, String(v)])));
    setBudget(fresh.budget);
    setBudgetInputs({ min: String(fresh.budget.total_hours_min), max: String(fresh.budget.total_hours_max), extra: String(fresh.budget.overflow_tuesday_extra_hours) });
    setOverhead(fresh.overhead);
    setOverheadInputs({ switch: String(fresh.overhead.product_switch_hours), washAfter: String(fresh.overhead.wash_mold_after_batches), washHours: String(fresh.overhead.wash_mold_hours) });
    setScheduling(fresh.scheduling);
    setSchedulingInputs({ lead: String(fresh.scheduling.lead_time_days) });
    setProductLead(fresh.productLead);
    setProductLeadInputs(Object.fromEntries(Object.entries(fresh.productLead).map(([k, v]) => [k, String(v)])));
    setSaved(false);
  }

  const isEstimate = !initial.capsFromMenu;

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col min-h-0" style={{ fontFamily: F.tc }}>
      {/* Page header + actions */}
      <PageHeader
        caption="CAPACITY · 產能設定 · 雇主編輯"
        title="CAPACITY"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {saved && (
              <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: C.green }}>
                ✓ 已寫入本機狀態
              </span>
            )}
            <button
              type="button"
              onClick={() => setSaved(true)}
              style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: "#111", background: C.acc, padding: "9px 16px", border: "none", cursor: "pointer", borderRadius: 0 }}
            >
              儲存設定
            </button>
            <button
              type="button"
              onClick={handleReset}
              style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: C.mut, background: "transparent", border: "1px solid #3a3a40", padding: "9px 16px", cursor: "pointer", borderRadius: 0 }}
            >
              還原預設
            </button>
          </div>
        }
      />

      {/* Estimate warning */}
      <div style={{ padding: "14px 24px 4px" }}>
        <div style={{ background: isEstimate ? "#1a1206" : "#0c140c", borderLeft: `3px solid ${isEstimate ? C.orange : C.green}`, padding: "12px 16px" }}>
          {isEstimate ? (
            <>
              <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: C.orange }}>⚠ 目前為系統估值</span>
              <span style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: C.mut }}> · 請依實際烤爐/人力設定真實值。排程 Stage 9 會用這裡的上限做超載檢核（憲章 #12：超載一律回退待排、不自動指派）。</span>
            </>
          ) : (
            <>
              <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: C.green }}>✓ 已載入 menu.yaml 設定值</span>
              <span style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: C.mut }}> · 排程 Stage 9 超載檢核啟用中（憲章 #12）。</span>
            </>
          )}
        </div>
      </div>

      {/* ── Scrollable form body ────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>

      {/* ── Daily max by atom ──────────────────────────────────────────────── */}
      <div style={{ padding: "12px 24px 8px" }}>
        <SectionTitle title="每日產能上限" monoSub="daily_max_by_atom" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12 }}>
          {GROUPS.map((g) => (
            <div key={g.cat} style={{ background: C.panel, border: `1px solid ${C.line}`, padding: "16px 18px" }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: g.color, marginBottom: 12 }}>{g.cat}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {g.items.map((it) => {
                  const rawVal = capInputs[it.key] ?? String(caps[it.key] ?? 0);
                  const pct = Math.min(100, Math.round(((parseFloat(rawVal) || 0) / 200) * 100));
                  const isDefault = !(menu.production_capacity?.daily_max_by_atom?.[it.key] != null);
                  return (
                    <div key={it.key}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
                        <span style={{ flex: 1, fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#E7E7EA" }}>
                          {atomLabel(it.key, menu)}
                          {isDefault && <EstimateTag />}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", background: C.card, border: "1px solid #3a3a40" }}>
                          <input
                            type="text"
                            value={rawVal}
                            onChange={(e) => handleCapChange(it.key, e.target.value)}
                            style={{ width: 46, textAlign: "right", fontSize: 14, fontWeight: 700, color: C.ink, background: "transparent", border: "none", padding: "5px 4px", outline: "none", fontFamily: F.mono }}
                          />
                          <span style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", padding: "0 8px 0 2px" }}>{it.unit}/日</span>
                        </div>
                      </div>
                      <div style={{ height: 6, background: C.track }}>
                        <div style={{ width: `${pct}%`, height: 6, background: g.color, transition: "width .2s" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Weekly pattern ─────────────────────────────────────────────────── */}
      <div style={{ padding: "12px 24px 8px" }}>
        <SectionTitle title="週幾產能倍率" monoSub="weekly_pattern · 週末可設 ×1.5" />
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 16, display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 8 }}>
          {WEEK_DAYS.map((d) => {
            const mult = weeklyInputs[d.key] ?? String(weekly[d.key] ?? 1);
            const boosted = (parseFloat(mult) || 1) > 1;
            const noMenuWeekly = !menu.production_capacity?.weekly_pattern;
            return (
              <div key={d.key} style={{ background: d.isTue ? "#1c1600" : C.card, border: `1px solid ${d.isTue ? "var(--acc,#F5D400)" : C.line}`, padding: "12px 8px", textAlign: "center" }}>
                <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: d.isTue ? "var(--acc,#F5D400)" : C.ink3 }}>{d.label}</div>
                {d.isTue && <div style={{ fontFamily: F.mono, fontSize: 8, color: "#7a5f00", marginTop: 1 }}>主出爐</div>}
                {noMenuWeekly && <div style={{ fontFamily: F.mono, fontSize: 8, color: C.orange, marginTop: 1 }}>待設</div>}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginTop: 8 }}>
                  <span style={{ fontFamily: F.mono, fontSize: 12, color: C.mut }}>×</span>
                  <input
                    type="text"
                    value={mult}
                    onChange={(e) => handleWeeklyChange(d.key, e.target.value)}
                    style={{ width: 40, textAlign: "center", fontSize: 16, fontWeight: 700, color: boosted ? C.green : C.ink, background: "transparent", border: "none", borderBottom: "1px solid #3a3a40", padding: 2, outline: "none", fontFamily: F.mono }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Budget / Overhead / Lead time ─────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12, padding: "12px 24px 16px" }}>

        {/* 週工時預算 */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 18 }}>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: C.ink, marginBottom: 14 }}>
            週工時預算 <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#6C6C74" }}>weekly_budget</span>
            {!menu.weekly_production_budget && <PendingTag />}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <FieldRow label="標準工時" value={budgetInputs.min} unit="h"
              onChange={(v) => { setBudgetInputs((p) => ({ ...p, min: v })); const n = parseFloat(v); if (!isNaN(n)) setBudget((p) => ({ ...p, total_hours_min: n })); setSaved(false); }} />
            <FieldRow label="上限工時" value={budgetInputs.max} unit="h"
              onChange={(v) => { setBudgetInputs((p) => ({ ...p, max: v })); const n = parseFloat(v); if (!isNaN(n)) setBudget((p) => ({ ...p, total_hours_max: n })); setSaved(false); }} />
            <FieldRow label="爆量週二加工" labelColor={C.orange} value={budgetInputs.extra} unit="+h"
              onChange={(v) => { setBudgetInputs((p) => ({ ...p, extra: v })); const n = parseFloat(v); if (!isNaN(n)) setBudget((p) => ({ ...p, overflow_tuesday_extra_hours: n })); setSaved(false); }} />
          </div>
        </div>

        {/* Overhead */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 18 }}>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: C.ink, marginBottom: 14 }}>
            工序 overhead
            {!menu.overhead && <PendingTag />}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <FieldRow label="品項切換" value={overheadInputs.switch} unit="h" width={52}
              onChange={(v) => { setOverheadInputs((p) => ({ ...p, switch: v })); const n = parseFloat(v); if (!isNaN(n)) setOverhead((p) => ({ ...p, product_switch_hours: n })); setSaved(false); }} />
            <FieldRow label="洗模（每幾爐）" value={overheadInputs.washAfter} unit="爐" width={52}
              onChange={(v) => { setOverheadInputs((p) => ({ ...p, washAfter: v })); const n = parseInt(v, 10); if (!isNaN(n)) setOverhead((p) => ({ ...p, wash_mold_after_batches: n })); setSaved(false); }} />
            <FieldRow label="洗模耗時" value={overheadInputs.washHours} unit="h" width={52}
              onChange={(v) => { setOverheadInputs((p) => ({ ...p, washHours: v })); const n = parseFloat(v); if (!isNaN(n)) setOverhead((p) => ({ ...p, wash_mold_hours: n })); setSaved(false); }} />
          </div>
        </div>

        {/* Lead time */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 18 }}>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: C.ink, marginBottom: 14 }}>
            前置期 lead time <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#6C6C74" }}>出貨前 N 天</span>
            {!menu.scheduling && <PendingTag />}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <FieldRow label="整體前置（週二出爐）" value={schedulingInputs.lead} unit="天" width={44}
              onChange={(v) => { setSchedulingInputs((p) => ({ ...p, lead: v })); const n = parseInt(v, 10); if (!isNaN(n)) setScheduling((p) => ({ ...p, lead_time_days: n })); setSaved(false); }} />
            {GROUPS.flatMap((g) =>
              g.items.map((it) => {
                const rawVal = productLeadInputs[it.key] ?? String(productLead[it.key] ?? 0);
                const isDefault = !(menu.product_lead_time?.[it.key] != null);
                return (
                  <div key={it.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ flex: 1, fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: "#9A9AA2" }}>
                      {atomLabel(it.key, menu)}
                      {isDefault && <span style={{ fontFamily: F.mono, fontSize: 9, color: "#5a5a62", marginLeft: 4 }}>估算</span>}
                    </span>
                    <input type="text" value={rawVal}
                      onChange={(e) => handleProductLeadChange(it.key, e.target.value)}
                      style={{ width: 44, textAlign: "right", fontSize: 14, fontWeight: 700, color: C.ink, background: C.card, border: "1px solid #3a3a40", padding: 5, outline: "none", fontFamily: F.mono }}
                    />
                    <span style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74" }}>天</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Stage 9 info card */}
      <div style={{ padding: "4px 24px 16px" }}>
        <div style={{ background: "#0d0d11", border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.cyan}`, padding: "14px 18px" }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.cyan, letterSpacing: ".15em", marginBottom: 6 }}>
            SCHEDULING · STAGE 9 · 憲章 #12
          </div>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: C.ink3, marginBottom: 4 }}>超載檢核邏輯</div>
          <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: C.mut, lineHeight: 1.7 }}>
            排程引擎在 Stage 9 對每個出爐日加總確認訂單的原子需求，與此頁的{" "}
            <span style={{ color: C.ink3, fontFamily: F.mono, fontSize: 11 }}>daily_max × weekly_pattern</span>{" "}
            比對。任何 atom 超出上限時，該訂單一律退回「待排」桶，不自動分配到下一批次。
            超載批次顯示於儀表板警示區，由雇主手動決定如何調配。
          </div>
        </div>
      </div>

      {/* Footer note */}
      <div style={{ padding: "8px 24px 16px" }}>
        <div style={{ background: C.track, border: `1px solid ${C.line}`, padding: "12px 16px" }}>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", letterSpacing: ".05em" }}>NOTE</span>
          <span style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 11, color: "#5a5a62", marginLeft: 8 }}>
            「儲存」只更新本機記憶體狀態（重新整理後還原）。真實寫回{" "}
            <span style={{ fontFamily: F.mono }}>menu.yaml production_capacity</span>{" "}
            請透過 MCP 工具或直接下載修改後的 yaml（瀏覽器無法直接寫入本機檔案）。
          </span>
        </div>
      </div>

      </div>{/* end scrollable form body */}
    </div>
  );
}
