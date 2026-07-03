/**
 * SchedulePage — 排程週檢視 + 拖拉排單（P4, Opus 親做）
 *
 * 憲章落實：
 *   #11 排程雇主拍板守恆：拖入某出貨日 = 寫 assignment_source="boss_scheduled"，人拍板才進主軌。
 *   #12 產能超載守恆：拖入使當日工時 > 週預算 → 紅色 loud 警示 + 需二次確認才持久化（絕不靜默排入）。
 *   #14 最低前置期：拖到 < lead_time_days（預設 5 天）→ 警示。
 * 主軌 0 LLM。所有數字由 domain（production-time.ts）即時算。
 */
import { useMemo, useState } from "react";
import type { Menu, Order } from "../../domain/models";
import { getDisplayName } from "../../domain/menu";
import {
  accumulateAtoms,
  calculateBatchHours,
  estimateOrderHours,
  batchesAndHoursForAtom,
} from "../../domain/production-time";
import { upsertOrder } from "../../db/orders";
import type { PageProps } from "./types";

const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
};
const WD = ["日", "一", "二", "三", "四", "五", "六"];

// ── 日期 helpers ─────────────────────────────────────────
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function mdOf(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${m}/${d}`;
}
function mondayOf(ref: Date, weekOffset: number): Date {
  const d = new Date(ref);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=Sun
  const diff = (dow + 6) % 7; // 到週一的距離
  d.setDate(d.getDate() - diff + weekOffset * 7);
  return d;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function daysBetween(aISO: string, b: Date): number {
  const a = new Date(aISO);
  a.setHours(0, 0, 0, 0);
  const bb = new Date(b);
  bb.setHours(0, 0, 0, 0);
  return Math.round((a.getTime() - bb.getTime()) / 86400000);
}

// 需排程的訂單（待排）：主軌 confirmed / pending_batch_date 且尚未由雇主拍板日期
function isPendingSchedule(o: Order): boolean {
  const schedulable = o.status === "confirmed" || o.status === "pending_batch_date";
  return schedulable && (o.assignment_source === "pending" || o.batchDate === null);
}

export function SchedulePage({ orders, menu, refreshOrders }: PageProps) {
  const [viewMode, setViewMode] = useState<"week" | "month">("week");
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<{ id: string; toISO: string; msg: string } | null>(null);

  const today = useMemo(() => new Date(), []);
  const budget = menu.weekly_production_budget?.total_hours_max ?? 30;
  const stdBudget = menu.weekly_production_budget?.total_hours_min ?? 24;
  const leadDays = menu.scheduling?.lead_time_days ?? 5;

  const monday = useMemo(() => mondayOf(today, weekOffset), [today, weekOffset]);
  const week = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(monday, i)),
    [monday]
  );
  const weekISO = week.map(toISO);

  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  // 各日已排訂單
  const assignedByDay = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const iso of weekISO) m.set(iso, []);
    for (const o of orders) {
      if (o.batchDate && m.has(o.batchDate) && o.assignment_source !== "pending") {
        m.get(o.batchDate)!.push(o);
      }
    }
    return m;
  }, [orders, weekISO.join(",")]);

  const pending = useMemo(() => orders.filter(isPendingSchedule), [orders]);

  // 全部有日期的訂單（月曆計數用）
  const ordersByDate = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of orders) {
      if (o.batchDate && o.assignment_source !== "pending") {
        (m.get(o.batchDate) ?? m.set(o.batchDate, []).get(o.batchDate)!).push(o);
      }
    }
    return m;
  }, [orders]);

  // 月曆：含當月的完整週列（週一起始）
  const monthInfo = useMemo(() => {
    const base = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    const y = base.getFullYear();
    const mo = base.getMonth();
    const firstMon = mondayOf(new Date(y, mo, 1), 0);
    const weeks: Date[][] = [];
    let cur = new Date(firstMon);
    for (let w = 0; w < 6; w++) {
      const row = Array.from({ length: 7 }, (_, i) => addDays(cur, i));
      weeks.push(row);
      cur = addDays(cur, 7);
      // 若整週都超過當月且已排過當月最後一天、可提早停
      if (row[0]!.getMonth() > mo && row[0]!.getFullYear() >= y) break;
    }
    return { year: y, month: mo, weeks };
  }, [today, monthOffset]);

  // 該日工時
  function dayHours(iso: string): number {
    const list = assignedByDay.get(iso) ?? [];
    if (list.length === 0) return 0;
    return calculateBatchHours(accumulateAtoms(list), menu);
  }

  // 拖放持久化（憲章 #11 拍板）
  async function commitAssign(id: string, toISO: string | null) {
    const o = orderById.get(id);
    if (!o) return;
    const updated: Order =
      toISO === null
        ? { ...o, batchDate: null, assignment_source: "pending", estimated_production_hours: null }
        : {
            ...o,
            batchDate: toISO,
            system_suggested_date: o.system_suggested_date ?? toISO,
            assignment_source: "boss_scheduled", // 憲章 #11：雇主拍板
            estimated_production_hours: estimateOrderHours(o, menu),
          };
    await upsertOrder(updated);
    await refreshOrders();
  }

  function attemptDrop(id: string, toISOorPending: string) {
    setOverDay(null);
    const o = orderById.get(id);
    if (!o) return;
    if (toISOorPending === "pending") {
      void commitAssign(id, null);
      return;
    }
    const toISO = toISOorPending;
    if (o.batchDate === toISO) return;

    // 憲章 #14：前置期檢查
    const lead = daysBetween(toISO, today);
    const leadWarn = lead < leadDays ? `前置期只剩 ${lead} 天（< ${leadDays} 天最低前置期，憲章 #14）` : null;

    // 憲章 #12：產能超載檢查
    const list = (assignedByDay.get(toISO) ?? []).filter((x) => x.id !== id);
    const projected = calculateBatchHours(
      accumulateAtoms([...list, o]),
      menu
    );
    const overWarn =
      projected > budget
        ? `排入後當日工時 ${projected}h > 週上限 ${budget}h（產能超載，憲章 #12）`
        : null;

    if (leadWarn || overWarn) {
      const msg = [overWarn, leadWarn].filter(Boolean).join("；");
      setConfirmDrop({ id, toISO, msg });
      return;
    }
    void commitAssign(id, toISO);
  }

  // 主出貨日（本週的週二，getDay===2）
  const shipISO = weekISO.find((iso) => new Date(iso).getDay() === 2) ?? weekISO[1];
  const shipHours = dayHours(shipISO);
  const shipList = assignedByDay.get(shipISO) ?? [];

  return (
    <div
      className="h-full flex flex-col min-h-0"
      onDragOver={(e) => { if (dragId) e.preventDefault(); }}
      onDrop={(e) => {
        if (!dragId) return;
        // 判斷 drop target 是否落在任何 [data-day]（日欄或待排軌）內；
        // 若在框外 → 自動退回待排（batchDate=null, assignment_source="pending"）
        const inZone = (e.target as HTMLElement).closest?.("[data-day]");
        if (!inZone) {
          e.preventDefault();
          attemptDrop(dragId, "pending");
        }
      }}
    >
      {/* 薄工具列：月/週切換 + 週/月導覽 + 本週工時 gauge（取代 PageHeader，把版面高度讓給月/週曆與待排訂單） */}
      <div className="flex items-center gap-[10px] flex-wrap px-6 py-2" style={{ flexShrink: 0, borderBottom: "1px solid #26262C" }}>
        <div className="flex gap-[2px]">
          <button type="button" onClick={() => setViewMode("month")} style={viewMode === "month" ? btnActive : btn}>月</button>
          <button type="button" onClick={() => setViewMode("week")} style={viewMode === "week" ? btnActive : btn}>週</button>
        </div>
        {viewMode === "week" ? (
          <>
            <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 16, color: "#8A8A93" }}>
              {mdOf(weekISO[0])}–{mdOf(weekISO[6])}
            </span>
            <div className="flex gap-[2px]">
              <button type="button" onClick={() => setWeekOffset((w) => w - 1)} style={btn}>‹ 上週</button>
              <button type="button" onClick={() => setWeekOffset(0)} style={weekOffset === 0 ? btnActive : btn}>本週</button>
              <button type="button" onClick={() => setWeekOffset((w) => w + 1)} style={btn}>下週 ›</button>
            </div>
          </>
        ) : (
          <>
            <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 16, color: "#8A8A93" }}>
              {monthInfo.year} / {String(monthInfo.month + 1).padStart(2, "0")}
            </span>
            <div className="flex gap-[2px]">
              <button type="button" onClick={() => setMonthOffset((m) => m - 1)} style={btn}>‹ 上月</button>
              <button type="button" onClick={() => setMonthOffset(0)} style={monthOffset === 0 ? btnActive : btn}>本月</button>
              <button type="button" onClick={() => setMonthOffset((m) => m + 1)} style={btn}>下月 ›</button>
            </div>
          </>
        )}

        {/* 本週工時 gauge — 水平薄款、貼齊工具列右側 */}
        {(() => {
          const barColor = shipHours > budget ? "#E5352B" : shipHours > stdBudget ? "#E5622A" : "#43B23C";
          const pct = Math.min(100, (shipHours / budget) * 100);
          const stdPct = (stdBudget / budget) * 100;
          const over = shipHours > stdBudget;
          return (
            <div className="ml-auto flex items-center" style={{ gap: 10, minWidth: 320 }}>
              <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".1em", whiteSpace: "nowrap" }}>
                本週工時 · 批 {mdOf(shipISO)}
              </span>
              <span className="flex items-baseline" style={{ gap: 4 }}>
                <span style={{ fontFamily: F.anton, fontSize: 20, color: barColor, lineHeight: 0.85 }}>{shipHours}</span>
                <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82" }}>/ {stdBudget}–{budget}h</span>
              </span>
              <div style={{ flex: 1, minWidth: 120, height: 8, background: "#161619", position: "relative" }}>
                <div style={{ width: `${pct}%`, height: 8, background: barColor }} />
                <div style={{ position: "absolute", top: -2, bottom: -2, left: `${stdPct}%`, width: 2, background: "#F5F4EF" }} />
              </div>
              {over && (
                <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 10, color: "#E5622A", whiteSpace: "nowrap" }}>
                  ⚠ 近上限 · 可 +{menu.weekly_production_budget?.overflow_tuesday_extra_hours ?? 8}h
                </span>
              )}
            </div>
          );
        })()}
      </div>

      {warn && (
        <div className="mx-6 mt-2 px-4 py-3 flex items-center justify-between" style={{ background: "#2a1010", border: "1px solid #E5352B" }}>
          <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#E5352B" }}>⚠ {warn}</span>
          <button type="button" onClick={() => setWarn(null)} style={{ fontFamily: F.mono, fontSize: 11, color: "#8A8A93", cursor: "pointer" }}>✕</button>
        </div>
      )}

      {/* 超載/前置期 二次確認（憲章 #12 不靜默） */}
      {confirmDrop && (
        <div className="mx-6 mt-2 px-4 py-3" style={{ background: "#2a1a10", border: "1px solid #E5622A" }}>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#E5622A" }}>⚠ 需雇主確認</div>
          <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: "#C9C9CF", marginTop: 4 }}>{confirmDrop.msg}</div>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => { const c = confirmDrop; setConfirmDrop(null); void commitAssign(c.id, c.toISO); }}
              style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: "#111", background: "#E5622A", padding: "6px 14px", cursor: "pointer" }}
            >
              仍要排入 · 我負責
            </button>
            <button
              type="button"
              onClick={() => setConfirmDrop(null)}
              style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#C9C9CF", background: "#161619", padding: "6px 14px", cursor: "pointer" }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 內容區：header/banner 固定 */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {viewMode === "month" ? (
        <MonthCalendar
          weeks={monthInfo.weeks}
          month={monthInfo.month}
          today={today}
          ordersByDate={ordersByDate}
          menu={menu}
          onPickDay={(d) => { setViewMode("week"); setWeekOffset(weekOffsetForDate(d, today)); }}
        />
      ) : (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="px-6 py-2" style={{ display: "grid", gridTemplateColumns: "2.7fr 1fr", gap: 12, flex: 1, minHeight: 0 }}>
        {/* WEEK GRID */}
        <div style={{ background: "#0F0F12", border: "1px solid #26262C", padding: 16, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div className="flex justify-between items-baseline flex-wrap" style={{ marginBottom: 12, gap: 6, flexShrink: 0 }}>
            <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: "#F5F4EF" }}>
              本週工作排程 <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 11, color: "#6C6C74" }}>出貨日回推備料</span>
            </span>
            <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 11, color: "var(--acc,#F5D400)" }}>⠿ 拖曳待排訂單 → 出貨日</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, flex: 1, minHeight: 0 }}>
            {week.map((d) => {
              const iso = toISO(d);
              const isShip = d.getDay() === 2;
              const list = assignedByDay.get(iso) ?? [];
              const isOver = overDay === iso;
              return (
                <div
                  key={iso}
                  style={{
                    background: isShip ? "#1c1600" : "#111114",
                    border: isShip ? "2px solid var(--acc,#F5D400)" : "1px solid #26262C",
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    boxShadow: isShip ? "0 0 0 3px rgba(245,212,0,.12)" : undefined,
                  }}
                >
                  <div
                    className="flex items-baseline justify-between"
                    style={{ padding: "8px 9px", background: isShip ? "var(--acc,#F5D400)" : undefined, borderBottom: isShip ? undefined : "1px solid #26262C" }}
                  >
                    <span style={{ fontFamily: isShip ? F.tc : F.mono, fontWeight: isShip ? 900 : 400, fontSize: isShip ? 11 : 10, color: isShip ? "#111" : "#6C6C74" }}>
                      {isShip ? `${WD[d.getDay()]} · 出貨` : WD[d.getDay()]}
                    </span>
                    <span style={{ fontFamily: F.anton, fontSize: isShip ? 20 : 18, color: isShip ? "#111" : "#8A8A93" }}>{d.getDate()}</span>
                  </div>

                  <div
                    data-day={iso}
                    onDragOver={(e) => { e.preventDefault(); setOverDay(iso); }}
                    onDragLeave={() => setOverDay((x) => (x === iso ? null : x))}
                    onDrop={(e) => { e.preventDefault(); if (dragId) attemptDrop(dragId, iso); }}
                    style={{
                      flex: 1,
                      minHeight: 0,
                      overflowY: "auto",
                      margin: 8,
                      border: `1.5px dashed ${isShip ? "#4a3f00" : "#2a2a30"}`,
                      padding: 6,
                      display: "flex",
                      flexDirection: "column",
                      gap: 5,
                      background: isOver ? "rgba(245,212,0,0.08)" : undefined,
                    }}
                  >
                    {list.map((o) => (
                      <div
                        key={o.id}
                        draggable
                        onDragStart={() => setDragId(o.id)}
                        onDragEnd={() => { setDragId(null); setOverDay(null); }}
                        title={o.id}
                        style={{
                          cursor: "grab",
                          background: isShip ? "#3a2f00" : "#1c1600",
                          borderLeft: "3px solid var(--acc,#F5D400)",
                          padding: "5px 7px",
                          fontFamily: F.tc,
                          fontWeight: 700,
                          fontSize: 10,
                          color: "#F5F4EF",
                          opacity: dragId === o.id ? 0.35 : 1,
                        }}
                      >
                        {orderItemLabel(o, menu)}
                        <span style={{ color: "#6C6C74", fontWeight: 400 }}> · {o.channel.replace(/^面交_/, "面交")}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: "auto", textAlign: "center", fontFamily: F.mono, fontSize: 9, color: isShip ? "#7a6600" : "#3a3a40" }}>
                      ＋ 拖曳排入{isShip ? "本批" : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap" style={{ gap: 14, marginTop: 14, fontFamily: F.mono, fontSize: 10, color: "#7A7A82" }}>
            <Legend c="var(--acc,#F5D400)" t="出貨日" />
            <Legend c="#8557C9" t="開麵糰" />
            <Legend c="#2AC7E8" t="冷藏·烤磅" />
            <Legend c="#43B23C" t="面交" />
          </div>
        </div>

        {/* RIGHT RAIL */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
          <div
            data-day="pending"
            onDragOver={(e) => { e.preventDefault(); setOverDay("pending"); }}
            onDragLeave={() => setOverDay((x) => (x === "pending" ? null : x))}
            onDrop={(e) => { e.preventDefault(); if (dragId) attemptDrop(dragId, "pending"); }}
            style={{ background: overDay === "pending" ? "#141008" : "#0F0F12", border: "1px solid #26262C", padding: 16 }}
          >
            <div className="flex justify-between items-baseline" style={{ marginBottom: 4 }}>
              <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: "#F5F4EF" }}>待排訂單</span>
              <span style={{ fontFamily: F.anton, fontSize: 22, color: pending.length ? "#E5622A" : "#43B23C" }}>{pending.length}</span>
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", marginBottom: 12 }}>憲章 #11 · 拖到出貨日即拍板</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9, maxHeight: "50vh", overflowY: "auto" }}>
              {pending.map((o) => (
                <div
                  key={o.id}
                  draggable
                  onDragStart={() => setDragId(o.id)}
                  onDragEnd={() => { setDragId(null); setOverDay(null); }}
                  style={{ cursor: "grab", background: "#111114", border: "1px solid #26262C", padding: "10px 11px", opacity: dragId === o.id ? 0.35 : 1 }}
                >
                  <div className="flex justify-between items-center">
                    <span style={{ fontFamily: F.mono, fontSize: 11, color: "#C9C9CF" }}>{o.id}</span>
                    <span style={{ fontFamily: F.mono, fontSize: 13, color: "#4a4a52" }}>⠿</span>
                  </div>
                  <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 11, color: "#8A8A93", margin: "4px 0 8px" }}>
                    {orderItemLabel(o, menu)}
                    {o.customer_wish_date ? ` · 希望 ${mdOf(o.customer_wish_date)}` : " · 無指定"}
                  </div>
                  <div className="flex items-center" style={{ gap: 8 }}>
                    {o.system_suggested_date && (
                      <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 10, color: "#111", background: "var(--acc,#F5D400)", padding: "3px 9px" }}>
                        建議 {mdOf(o.system_suggested_date)}
                      </span>
                    )}
                    {o.wish_priority === "strict" && (
                      <span style={{ fontFamily: F.mono, fontSize: 9, color: "#E5352B", border: "1px solid #E5352B", padding: "2px 6px" }}>STRICT</span>
                    )}
                  </div>
                </div>
              ))}
              {pending.length === 0 && (
                <div style={{ textAlign: "center", padding: "18px 8px", fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#43B23C" }}>
                  ✓ 全部已排入<br />
                  <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#6C6C74" }}>可產出 Excel / 標籤</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SELECTED BATCH DETAIL */}
      <div className="px-6 pb-4" style={{ flexShrink: 0 }}>
        <div style={{ background: "#0F0F12", border: "1px solid #26262C" }}>
          <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, padding: "18px 20px 14px" }}>
            <div className="flex items-baseline" style={{ gap: 12 }}>
              <span style={{ fontFamily: F.anton, fontSize: 24, color: "var(--acc,#F5D400)" }}>{mdOf(shipISO).replace("/", " / ")}</span>
              <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 16, color: "#F5F4EF" }}>出爐批次明細</span>
              <span style={{ fontFamily: F.mono, fontSize: 11, color: "#7A7A82" }}>{WD[new Date(shipISO).getDay()]} · {shipList.length} 單</span>
            </div>
            <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: "#111", background: pending.length === 0 ? "#43B23C" : "#E5622A", padding: "7px 14px" }}>
              {pending.length === 0 ? "✓ 待排已清空 · 可產出" : `⚠ ${pending.length} 單待排`}
            </span>
          </div>
          <div style={{ height: 9, background: "repeating-linear-gradient(45deg,var(--acc,#F5D400) 0 14px,#111 14px 28px)" }} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 20, padding: 20 }}>
            <BatchCapacity shipList={shipList} menu={menu} />
            <BatchHours shipList={shipList} menu={menu} />
            <BatchAtoms shipList={shipList} menu={menu} />
          </div>
        </div>
      </div>
      </div>
      )}
      </div>
    </div>
  );
}

// 給某日期算出它落在 today 的第幾週偏移（月曆點日 → 週檢視）
function weekOffsetForDate(d: Date, today: Date): number {
  const m0 = mondayOf(today, 0).getTime();
  const md = mondayOf(d, 0).getTime();
  return Math.round((md - m0) / (7 * 86400000));
}

// 訂單顯示標籤：第一個 item 的 SKU 顯示名（禁 raw hardcode、經 menu）
function orderItemLabel(o: Order, menu: Menu): string {
  const first = o.items[0];
  if (!first) return o.id;
  const name = first.productSkuId ? getDisplayName(first.productSkuId, menu) : first.rawName;
  return o.items.length > 1 ? `${name} +${o.items.length - 1}` : name;
}

function BatchCapacity({ shipList, menu }: { shipList: Order[]; menu: Menu }) {
  const totals = accumulateAtoms(shipList);
  const caps = menu.production_capacity?.daily_max_by_atom ?? {};
  const rows = [...totals.entries()].filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return (
    <div>
      <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".14em", marginBottom: 12 }}>當日產能檢核</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, fontFamily: F.mono, fontSize: 11 }}>
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
              <div style={{ flex: 1, height: 13, background: "#161619" }}>
                <div style={{ width: `${pct}%`, height: 13, background: col }} />
              </div>
              <span style={{ width: 60, textAlign: "right", color: col }}>{qty}{cap ? `/${cap}` : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BatchHours({ shipList, menu }: { shipList: Order[]; menu: Menu }) {
  const totals = accumulateAtoms(shipList);
  const rows = [...totals.entries()]
    .map(([atom, qty]) => ({ atom, ...batchesAndHoursForAtom(atom, qty, menu) }))
    .filter((r) => r.hours > 0)
    .sort((a, b) => b.hours - a.hours);
  const total = calculateBatchHours(totals, menu);
  return (
    <div>
      <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".14em", marginBottom: 12 }}>工時分解 · {total}h</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, fontFamily: F.mono, fontSize: 11 }}>
        {rows.length === 0 && <span style={{ color: "#6C6C74" }}>—</span>}
        {rows.map((r) => (
          <div key={r.atom} className="flex justify-between" style={{ padding: "7px 11px", background: "#161619" }}>
            <span style={{ color: "#C9C9CF" }}>{getDisplayName(r.atom, menu)} · {Math.ceil(r.batches)} 爐</span>
            <span style={{ color: "#F5F4EF", fontWeight: 700 }}>{(r.hours + r.washMoldHours).toFixed(1)}h</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BatchAtoms({ shipList, menu }: { shipList: Order[]; menu: Menu }) {
  const totals = accumulateAtoms(shipList);
  const rows = [...totals.entries()].filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".14em", marginBottom: 12 }}>備料原子總量 <span style={{ color: "#4a4a52" }}>· 配方待雇主補(R3-4)</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, fontFamily: F.mono, fontSize: 12 }}>
        {rows.length === 0 && <span style={{ color: "#6C6C74" }}>—</span>}
        {rows.map(([atom, qty]) => (
          <div key={atom} className="flex justify-between" style={{ padding: "8px 12px", background: "#161619" }}>
            <span style={{ color: "#C9C9CF" }}>{getDisplayName(atom, menu)}</span>
            <span style={{ color: "#F5F4EF", fontWeight: 700 }}>{qty}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 月曆視圖：整月排程一眼（每日已排單數 + 顆數），點某日 → 跳該週檢視
function MonthCalendar({
  weeks, month, today, ordersByDate, menu, onPickDay,
}: {
  weeks: Date[][];
  month: number;
  today: Date;
  ordersByDate: Map<string, Order[]>;
  menu: Menu;
  onPickDay: (d: Date) => void;
}) {
  const todayISO = toISO(today);
  return (
    <div className="px-6 py-2" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* 星期頭 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, flexShrink: 0, marginBottom: 6 }}>
        {["一", "二", "三", "四", "五", "六", "日"].map((w, i) => (
          <div key={w} style={{ fontFamily: F.mono, fontSize: 11, color: i === 1 ? "var(--acc,#F5D400)" : "#7A7A82", textAlign: "center", letterSpacing: ".1em" }}>
            {w}{i === 1 ? " · 出貨" : ""}
          </div>
        ))}
      </div>
      {/* 週列 */}
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: `repeat(${weeks.length},1fr)`, gap: 6 }}>
        {weeks.map((row, ri) => (
          <div key={ri} style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, minHeight: 0 }}>
            {row.map((d) => {
              const iso = toISO(d);
              const inMonth = d.getMonth() === month;
              const isShip = d.getDay() === 2;
              const isToday = iso === todayISO;
              const list = ordersByDate.get(iso) ?? [];
              const atoms = list.length ? [...accumulateAtoms(list).values()].reduce((s, n) => s + n, 0) : 0;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => onPickDay(d)}
                  style={{
                    background: isShip && inMonth ? "#1c1600" : "#111114",
                    border: isToday ? "2px solid var(--acc,#F5D400)" : isShip ? "1px solid #4a3f00" : "1px solid #26262C",
                    opacity: inMonth ? 1 : 0.35,
                    padding: "8px 9px",
                    cursor: "pointer",
                    textAlign: "left",
                    borderRadius: 0,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                    overflow: "hidden",
                  }}
                >
                  <div className="flex items-baseline justify-between" style={{ flexShrink: 0 }}>
                    <span style={{ fontFamily: F.mono, fontSize: 9, color: isShip ? "var(--acc,#F5D400)" : "#6C6C74" }}>{isShip ? "出貨" : ""}</span>
                    <span style={{ fontFamily: F.anton, fontSize: 18, color: inMonth ? "#E7E7EA" : "#6C6C74" }}>{d.getDate()}</span>
                  </div>
                  {list.length > 0 && (
                    <div style={{ marginTop: "auto", flexShrink: 0 }}>
                      <div style={{ height: 4, background: "var(--acc,#F5D400)", marginBottom: 4, width: `${Math.min(100, list.length * 20)}%` }} />
                      <div style={{ fontFamily: F.mono, fontSize: 10, color: "#C9C9CF" }}>{list.length} 單 · {atoms} 顆</div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", marginTop: 8, flexShrink: 0 }}>
        點任一日 → 跳該週檢視拖拉排單 · 週二為出貨日 · 黃框＝今天 · {menu.scheduling?.regular_shipping_weekday === 2 ? "常態週二出貨" : ""}
      </div>
    </div>
  );
}

function Legend({ c, t }: { c: string; t: string }) {
  return (
    <span className="flex items-center" style={{ gap: 6 }}>
      <span style={{ width: 9, height: 9, background: c }} />
      {t}
    </span>
  );
}

const btn: React.CSSProperties = { fontFamily: F.mono, fontSize: 13, color: "#8A8A93", background: "#161619", padding: "7px 12px", cursor: "pointer" };
const btnActive: React.CSSProperties = { ...btn, color: "#0B0B0C", background: "var(--acc,#F5D400)", fontWeight: 700 };
