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
  const [diagOpen, setDiagOpen] = useState(false);
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

  // 診斷：待排（排程頁）vs 待處理桶 差集 · 訂單分佈 · confirmed 去向
  const diag = useMemo(() => {
    const bucket = orders.filter((o) =>
      o.status.startsWith("pending_") ||
      o.status === "change_pending_resolution" ||
      o.status === "disappeared_pending_resolution"
    );
    const wait = orders.filter((o) =>
      (o.status === "confirmed" || o.status === "pending_batch_date") &&
      (o.assignment_source === "pending" || o.batchDate === null)
    );
    const bSet = new Set(bucket.map((o) => o.id));
    const wSet = new Set(wait.map((o) => o.id));

    // 訂單分佈總覽（互斥分類、Σ = 全部訂單）
    const shipped = orders.filter((o) => o.status === "shipped" || o.status === "kol_shipped");
    const canceled = orders.filter((o) => o.status === "canceled");
    const confirmedAll = orders.filter((o) => o.status === "confirmed");
    const confirmedScheduled = confirmedAll.filter(
      (o) => o.batchDate !== null && o.assignment_source !== "pending"
    );
    const confirmedUnscheduled = confirmedAll.filter(
      (o) => o.batchDate === null || o.assignment_source === "pending"
    );
    // confirmed 已排入的按 batchDate 分佈（給 Yen 找他的 confirmed 訂單去了哪些日子）
    const confirmedByDate = new Map<string, Order[]>();
    for (const o of confirmedScheduled) {
      const d = o.batchDate!;
      const arr = confirmedByDate.get(d) ?? [];
      arr.push(o);
      confirmedByDate.set(d, arr);
    }
    const confirmedDateRows = [...confirmedByDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, list]) => ({ date, count: list.length }));

    // status × assignment_source 交叉分佈（快速看整體卡在哪裡）
    const crossTable = new Map<string, number>();
    for (const o of orders) {
      const key = `${o.status}|${o.assignment_source ?? "null"}|${o.batchDate ? "有date" : "無date"}`;
      crossTable.set(key, (crossTable.get(key) ?? 0) + 1);
    }
    const crossRows = [...crossTable.entries()]
      .map(([key, n]) => {
        const [status, source, hasDate] = key.split("|");
        return { status: status!, source: source!, hasDate: hasDate!, n };
      })
      .sort((a, b) => b.n - a.n);

    return {
      total: orders.length,
      waitCount: wait.length,
      bucketCount: bucket.length,
      inWaitOnly: wait.filter((o) => !bSet.has(o.id)),
      inBucketOnly: bucket.filter((o) => !wSet.has(o.id)),
      // 分佈
      shippedCount: shipped.length,
      canceledCount: canceled.length,
      confirmedTotalCount: confirmedAll.length,
      confirmedScheduledCount: confirmedScheduled.length,
      confirmedUnscheduledCount: confirmedUnscheduled.length,
      confirmedDateRows,
      crossRows,
    };
  }, [orders]);

  // 待排訂單分頁 + 搜尋（供雇主插單搜尋）
  const [pendingTab, setPendingTab] = useState<"all" | "賣貨便" | "KOL" | "面交" | "指定日">("all");
  const [pendingQuery, setPendingQuery] = useState("");
  const pendingFiltered = useMemo(() => {
    const q = pendingQuery.trim().toLowerCase();
    return pending.filter((o) => {
      if (pendingTab === "賣貨便" && o.channel !== "賣貨便") return false;
      if (pendingTab === "KOL" && o.channel !== "KOL") return false;
      if (pendingTab === "面交" && !o.channel.startsWith("面交")) return false;
      if (pendingTab === "指定日" && !o.customer_wish_date) return false;
      if (!q) return true;
      // 搜尋：訂單編號、收件人、IG、品項顯示名、指定日
      const hay = [
        o.id,
        o.recipient.name ?? "",
        o.recipient.igOrLine ?? "",
        o.customer_wish_date ?? "",
        ...o.items.map((it) => it.productSkuId ? getDisplayName(it.productSkuId, menu) : it.rawName),
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [pending, pendingTab, pendingQuery, menu]);
  const pendingCounts = useMemo(() => ({
    all: pending.length,
    賣貨便: pending.filter((o) => o.channel === "賣貨便").length,
    KOL: pending.filter((o) => o.channel === "KOL").length,
    面交: pending.filter((o) => o.channel.startsWith("面交")).length,
    指定日: pending.filter((o) => !!o.customer_wish_date).length,
  }), [pending]);

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

        {/* 診斷按鈕：查待排 vs 待處理桶差集 */}
        <button
          type="button"
          onClick={() => setDiagOpen(true)}
          title="診斷 待排 vs 待處理桶"
          style={{ fontFamily: F.mono, fontSize: 10, color: "#8A8A93", background: "transparent", border: "1px solid #3a3a40", padding: "5px 8px", cursor: "pointer", letterSpacing: ".1em" }}
        >
          🩺 診斷
        </button>

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
              <div style={{ flex: 1, minWidth: 120, height: 16, background: "#161619", position: "relative" }}>
                <div style={{ width: `${pct}%`, height: 16, background: barColor }} />
                <div style={{ position: "absolute", top: -3, bottom: -3, left: `${stdPct}%`, width: 2, background: "#F5F4EF" }} />
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

      {/* 內容區：月/週檢視 */}
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
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, minHeight: 0 }}>
          <div
            data-day="pending"
            onDragOver={(e) => { e.preventDefault(); setOverDay("pending"); }}
            onDragLeave={() => setOverDay((x) => (x === "pending" ? null : x))}
            onDrop={(e) => { e.preventDefault(); if (dragId) attemptDrop(dragId, "pending"); }}
            style={{ background: overDay === "pending" ? "#141008" : "#0F0F12", border: "1px solid #26262C", padding: 16, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
          >
            <div className="flex justify-between items-baseline" style={{ marginBottom: 10 }}>
              <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: "#F5F4EF" }}>待排訂單</span>
              <span style={{ fontFamily: F.anton, fontSize: 22, color: pending.length ? "#E5622A" : "#43B23C" }}>{pending.length}</span>
            </div>

            {/* 分頁：全部 / 賣貨便 / KOL / 面交 / 指定日 */}
            <div className="flex flex-wrap" style={{ gap: 2, marginBottom: 8 }}>
              {([
                { k: "all" as const, label: "全部", n: pendingCounts.all },
                { k: "賣貨便" as const, label: "賣貨便", n: pendingCounts.賣貨便 },
                { k: "KOL" as const, label: "KOL", n: pendingCounts.KOL },
                { k: "面交" as const, label: "面交", n: pendingCounts.面交 },
                { k: "指定日" as const, label: "指定日", n: pendingCounts.指定日 },
              ]).map((t) => {
                const active = pendingTab === t.k;
                return (
                  <button
                    key={t.k}
                    type="button"
                    onClick={() => setPendingTab(t.k)}
                    style={{
                      fontFamily: F.tc, fontWeight: 900, fontSize: 11,
                      color: active ? "#111" : "#9A9AA2",
                      background: active ? "var(--acc,#F5D400)" : "#161619",
                      padding: "5px 10px", border: "none", cursor: active ? "default" : "pointer",
                    }}
                  >
                    {t.label} <span style={{ fontFamily: F.mono, fontSize: 10, opacity: 0.75 }}>{t.n}</span>
                  </button>
                );
              })}
            </div>

            {/* 搜尋：雇主插單用（訂單編號 / 收件人 / IG / 品項） */}
            <input
              type="text"
              value={pendingQuery}
              onChange={(e) => setPendingQuery(e.target.value)}
              placeholder="🔍 搜尋 姓名 / 訂單編號 / IG / 品項 / 日期…"
              style={{
                fontFamily: F.mono, fontSize: 11, color: "#E7E7EA",
                background: "#111114", border: "1px solid #3a3a40",
                padding: "7px 10px", width: "100%", outline: "none", borderRadius: 0,
                marginBottom: 10, boxSizing: "border-box",
              }}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: 9, flex: 1, minHeight: 0, overflowY: "auto" }}>
              {pendingFiltered.length === 0 && (
                <div style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74", padding: "16px 0", textAlign: "center" }}>
                  {pendingQuery
                    ? "無符合搜尋的待排單"
                    : pendingTab === "all"
                      ? "✓ 全部已排入"
                      : pendingTab === "指定日"
                        ? "無指定日期的待排單"
                        : "此通路無待排單"}
                </div>
              )}
              {pendingFiltered.map((o) => (
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
                  {/* 訂單人名字 · 亦供搜尋（搜尋 hay 早已含 recipient.name / igOrLine） */}
                  <div style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#F5F4EF", marginTop: 3 }}>
                    {o.recipient.name ?? o.recipient.igOrLine ?? "—"}
                    {o.recipient.name && o.recipient.igOrLine ? (
                      <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#7A7A82", marginLeft: 6 }}>
                        {o.recipient.igOrLine}
                      </span>
                    ) : null}
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

      </div>
      )}
      </div>

      {/* 診斷 modal：待排 vs 待處理桶 差集列表 */}
      {diagOpen && (
        <div
          onClick={() => setDiagOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 20px", overflowY: "auto" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#0F0F12", border: "1px solid #26262C", maxWidth: 900, width: "100%", maxHeight: "90vh", overflowY: "auto", padding: 24 }}
          >
            <div className="flex justify-between items-baseline" style={{ marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".14em" }}>DIAGNOSTICS</div>
                <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 20, color: "#F5F4EF", marginTop: 4 }}>待排 vs 待處理桶 · 差集</div>
              </div>
              <button type="button" onClick={() => setDiagOpen(false)} style={{ fontFamily: F.mono, fontSize: 13, color: "#8A8A93", background: "transparent", border: "none", cursor: "pointer" }}>✕</button>
            </div>

            {/* 訂單分佈總覽（互斥、Σ = 全部訂單） */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#F5F4EF", marginBottom: 10 }}>
                訂單分佈總覽
                <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#7A7A82", marginLeft: 8 }}>
                  總 {diag.total} = 已出貨 + confirmed(已排+未排) + 待處理桶 + 已取消
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8 }}>
                <div style={{ background: "#111114", padding: 10, borderLeft: "3px solid #43B23C" }}>
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>已出貨</div>
                  <div style={{ fontFamily: F.anton, fontSize: 22, color: "#F5F4EF" }}>{diag.shippedCount}</div>
                </div>
                <div style={{ background: "#111114", padding: 10, borderLeft: "3px solid #F5D400" }}>
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>confirmed 已排</div>
                  <div style={{ fontFamily: F.anton, fontSize: 22, color: "#F5F4EF" }}>{diag.confirmedScheduledCount}</div>
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: "#43B23C", marginTop: 2 }}>拍板 · 週/月曆</div>
                </div>
                <div style={{ background: "#111114", padding: 10, borderLeft: "3px solid #E5622A" }}>
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>confirmed 未排</div>
                  <div style={{ fontFamily: F.anton, fontSize: 22, color: "#F5F4EF" }}>{diag.confirmedUnscheduledCount}</div>
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: "#E5622A", marginTop: 2 }}>在待排列表</div>
                </div>
                <div style={{ background: "#111114", padding: 10, borderLeft: "3px solid #8557C9" }}>
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>待處理桶</div>
                  <div style={{ fontFamily: F.anton, fontSize: 22, color: "#F5F4EF" }}>{diag.bucketCount}</div>
                </div>
                <div style={{ background: "#111114", padding: 10, borderLeft: "3px solid #6C6C74" }}>
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>已取消</div>
                  <div style={{ fontFamily: F.anton, fontSize: 22, color: "#F5F4EF" }}>{diag.canceledCount}</div>
                </div>
              </div>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", marginTop: 8 }}>
                Σ 檢查：{diag.shippedCount + diag.confirmedScheduledCount + diag.confirmedUnscheduledCount + diag.bucketCount + diag.canceledCount} / {diag.total}
                {(diag.shippedCount + diag.confirmedScheduledCount + diag.confirmedUnscheduledCount + diag.bucketCount + diag.canceledCount) === diag.total
                  ? <span style={{ color: "#43B23C" }}> ✓ 一致</span>
                  : <span style={{ color: "#E5352B" }}> ✗ 有訂單狀態不在分類內</span>}
              </div>
            </div>

            {/* confirmed 已排 · 按 batchDate 分佈 */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#F5D400", marginBottom: 8 }}>
                confirmed 已排 · 按出貨日分佈（{diag.confirmedScheduledCount} 單）
                <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#7A7A82", marginLeft: 8 }}>
                  = 這些單去了哪些日子（在排程週/月曆的日欄裡）
                </span>
              </div>
              {diag.confirmedDateRows.length === 0 && <div style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74" }}>—</div>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 6 }}>
                {diag.confirmedDateRows.map((row) => (
                  <div key={row.date} style={{ background: "#111114", padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontFamily: F.mono, fontSize: 11, color: "#C9C9CF" }}>{row.date}</span>
                    <span style={{ fontFamily: F.anton, fontSize: 18, color: "#F5D400" }}>{row.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* status × assignment_source × batchDate 交叉分佈（每列 = 一種組合） */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#F5F4EF", marginBottom: 8 }}>
                訂單交叉分佈 · status × assignment_source × 有無 batchDate
                <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#7A7A82", marginLeft: 8 }}>
                  = 每一單卡在哪個組合、靜默失效就會現形
                </span>
              </div>
              <div style={{ background: "#111114", padding: "6px 12px", display: "grid", gridTemplateColumns: "2fr 1.4fr 0.8fr 0.6fr", gap: 8, fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".1em", borderBottom: "1px solid #26262C" }}>
                <span>status</span>
                <span>assignment_source</span>
                <span>batchDate</span>
                <span style={{ textAlign: "right" }}>n</span>
              </div>
              {diag.crossRows.length === 0 && (
                <div style={{ background: "#111114", padding: "10px 12px", fontFamily: F.mono, fontSize: 11, color: "#6C6C74" }}>—</div>
              )}
              {diag.crossRows.map((row, i) => {
                // 高亮潛在異常組合
                const isConfirmedScheduledPending = row.status === "confirmed" && row.source === "pending" && row.hasDate === "有date";
                const highlight = isConfirmedScheduledPending ? "#E5622A" : "#C9C9CF";
                return (
                  <div key={i} style={{ background: "#111114", padding: "8px 12px", display: "grid", gridTemplateColumns: "2fr 1.4fr 0.8fr 0.6fr", gap: 8, fontFamily: F.mono, fontSize: 11, color: highlight, borderBottom: "1px solid #1a1a1e" }}>
                    <span>{row.status}</span>
                    <span>{row.source}</span>
                    <span style={{ color: row.hasDate === "有date" ? "#43B23C" : "#E5622A" }}>{row.hasDate}</span>
                    <span style={{ textAlign: "right", fontFamily: F.anton, fontSize: 14, color: "#F5F4EF" }}>{row.n}</span>
                  </div>
                );
              })}
            </div>

            {/* 當前 UI filter 狀態（排除 tab/query 藏單造成的錯覺） */}
            <div style={{ marginBottom: 20, background: "#161619", padding: "12px 14px", borderLeft: "3px solid #F5D400" }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: "#F5F4EF", marginBottom: 6 }}>
                當前排程頁待排列表 UI 狀態
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, fontFamily: F.mono, fontSize: 10, color: "#C9C9CF" }}>
                <div>
                  <div style={{ color: "#7A7A82", fontSize: 9, marginBottom: 2 }}>pending 總數</div>
                  <div style={{ fontFamily: F.anton, fontSize: 20, color: "#F5F4EF" }}>{pending.length}</div>
                </div>
                <div>
                  <div style={{ color: "#7A7A82", fontSize: 9, marginBottom: 2 }}>UI 顯示（filtered）</div>
                  <div style={{ fontFamily: F.anton, fontSize: 20, color: pendingFiltered.length !== pending.length ? "#E5622A" : "#F5F4EF" }}>{pendingFiltered.length}</div>
                </div>
                <div>
                  <div style={{ color: "#7A7A82", fontSize: 9, marginBottom: 2 }}>當前 tab</div>
                  <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 14, color: pendingTab !== "all" ? "#E5622A" : "#C9C9CF" }}>{pendingTab}</div>
                </div>
                <div>
                  <div style={{ color: "#7A7A82", fontSize: 9, marginBottom: 2 }}>搜尋字串</div>
                  <div style={{ fontFamily: F.mono, fontSize: 12, color: pendingQuery ? "#E5622A" : "#6C6C74" }}>{pendingQuery ? `"${pendingQuery}"` : "（空）"}</div>
                </div>
              </div>
              {pendingFiltered.length !== pending.length && (
                <div style={{ marginTop: 8, fontFamily: F.mono, fontSize: 10, color: "#E5622A" }}>
                  ⚠ 當前 tab／搜尋隱藏了 {pending.length - pendingFiltered.length} 單 · 切「全部」+ 清搜尋看完整清單
                </div>
              )}
            </div>

            {/* 差集統計（原本的四卡片） */}
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#F5F4EF", marginBottom: 10 }}>差集分析</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
              <div style={{ background: "#111114", padding: 12, borderLeft: "3px solid #E5622A" }}>
                <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>排程待排</div>
                <div style={{ fontFamily: F.anton, fontSize: 28, color: "#F5F4EF" }}>{diag.waitCount}</div>
              </div>
              <div style={{ background: "#111114", padding: 12, borderLeft: "3px solid #8557C9" }}>
                <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>待處理桶</div>
                <div style={{ fontFamily: F.anton, fontSize: 28, color: "#F5F4EF" }}>{diag.bucketCount}</div>
              </div>
              <div style={{ background: "#111114", padding: 12, borderLeft: "3px solid #F5D400" }}>
                <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>只在排程</div>
                <div style={{ fontFamily: F.anton, fontSize: 28, color: diag.inWaitOnly.length > 0 ? "#F5D400" : "#43B23C" }}>{diag.inWaitOnly.length}</div>
              </div>
              <div style={{ background: "#111114", padding: 12, borderLeft: "3px solid #F5D400" }}>
                <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>只在待處理</div>
                <div style={{ fontFamily: F.anton, fontSize: 28, color: diag.inBucketOnly.length > 0 ? "#F5D400" : "#43B23C" }}>{diag.inBucketOnly.length}</div>
              </div>
            </div>

            {/* 只在排程待排的 */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#E5622A", marginBottom: 8 }}>
                只在「排程待排」的訂單（{diag.inWaitOnly.length}）
                <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#7A7A82", marginLeft: 8 }}>= confirmed 未拍板 · 你 resolve 過但沒拖到日欄</span>
              </div>
              {diag.inWaitOnly.length === 0 && <div style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74" }}>—</div>}
              {diag.inWaitOnly.map((o) => (
                <div key={o.id} style={{ background: "#111114", padding: "10px 12px", marginBottom: 4, display: "grid", gridTemplateColumns: "1.4fr 0.9fr 0.9fr 0.8fr 1.5fr", gap: 8, fontFamily: F.mono, fontSize: 11, color: "#C9C9CF" }}>
                  <span>{o.id}</span>
                  <span style={{ color: "#8A8A93" }}>{o.status}</span>
                  <span style={{ color: "#8A8A93" }}>{o.assignment_source ?? "—"}</span>
                  <span style={{ color: o.batchDate ? "#43B23C" : "#E5622A" }}>{o.batchDate ?? "無日期"}</span>
                  <span style={{ color: "#F5F4EF", fontFamily: F.tc }}>{o.recipient?.name ?? o.recipient?.igOrLine ?? "—"} · {o.channel}</span>
                </div>
              ))}
            </div>

            {/* 只在待處理桶的 */}
            <div>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#8557C9", marginBottom: 8 }}>
                只在「待處理桶」的訂單（{diag.inBucketOnly.length}）
                <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#7A7A82", marginLeft: 8 }}>= status 是 pending_channel / pending_product / pending_amount / disappeared 等</span>
              </div>
              {diag.inBucketOnly.length === 0 && <div style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74" }}>—</div>}
              {diag.inBucketOnly.map((o) => (
                <div key={o.id} style={{ background: "#111114", padding: "10px 12px", marginBottom: 4, display: "grid", gridTemplateColumns: "1.4fr 1.4fr 1fr 1.8fr", gap: 8, fontFamily: F.mono, fontSize: 11, color: "#C9C9CF" }}>
                  <span>{o.id}</span>
                  <span style={{ color: "#8A8A93" }}>{o.status}</span>
                  <span style={{ color: "#8A8A93" }}>{o.assignment_source ?? "—"}</span>
                  <span style={{ color: "#F5F4EF", fontFamily: F.tc }}>{(o.pendingReasons ?? []).map((r) => r.code).join(", ") || "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
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
