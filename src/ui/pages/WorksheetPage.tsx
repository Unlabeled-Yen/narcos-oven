/**
 * WorksheetPage — 當週工單（麵包師傅列印版）
 *
 * Yen 2026-07-03：整週鎖定後印給師傅使用
 *   內容：當週工作日排程 + 製作量規劃 + 當週總出貨統計（todo list 風格）
 *   列印：瀏覽器 Cmd+P · print CSS 排版
 *   資料源：跟 SchedulePage 同套（accumulateAtoms / day-type / week-locks / batch range）
 */
import { useMemo, useState } from "react";
import type { Order } from "../../domain/models";
import { getDisplayName } from "../../domain/menu";
import { accumulateAtoms } from "../../domain/production-time";
import { makeDayTypeOf, loadDayOverrides } from "../../domain/day-type";
import { computeBatchRange, findWeekAnchor } from "../../domain/batch-range";
import { isWeekLocked } from "../../db/week-locks";
import type { PageProps } from "./types";

const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
};
const WD = ["日", "一", "二", "三", "四", "五", "六"];

const navBtn = { fontFamily: "'Space Mono',monospace", fontSize: 11, color: "#C9C9CF", background: "transparent", border: "1px solid #3a3a40", padding: "5px 10px", cursor: "pointer", letterSpacing: ".05em" } as const;
const navBtnActive = { ...navBtn, color: "#111", background: "var(--acc,#F5D400)", border: "1px solid var(--acc,#F5D400)", fontWeight: 900 } as const;

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function mdOf(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}
// 對齊 SchedulePage.mondayOf（週一開始）
function mondayOf(ref: Date, offsetWeeks: number): Date {
  const d = new Date(ref);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const diff = (dow + 6) % 7;
  d.setDate(d.getDate() - diff + offsetWeeks * 7);
  return d;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function WorksheetPage({ orders, menu }: PageProps) {
  const today = useMemo(() => new Date(), []);
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = useMemo(() => mondayOf(today, weekOffset), [today, weekOffset]);
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekISO = week.map(toISO);
  const weekLockKey = weekISO[0]!;
  const locked = isWeekLocked(weekLockKey);

  const dayOverrides = loadDayOverrides();
  const dayTypeOf = makeDayTypeOf(menu, dayOverrides);

  // Yen 2026-07-03 新語意：「當週工單 = 一個批次單位」
  //   Range = 本週最後 shipping 為 anchor · 往前掃到前一批 ship break
  //   可含上週六日的工作日（跨週）· 只有 range 內的訂單算進本工單
  const anchor = useMemo(() => findWeekAnchor(weekISO, dayTypeOf), [weekISO.join(","), dayOverrides, menu]);
  const rangeISO = useMemo(() => (anchor ? computeBatchRange(anchor, dayTypeOf) : []), [anchor, dayTypeOf, menu, dayOverrides]);

  // Range 內訂單（含上週工作日排入的 · 全部歸此工單）
  const batchOrders = useMemo(() => {
    if (rangeISO.length === 0) return [];
    const rangeSet = new Set(rangeISO);
    return orders.filter(
      (o) => o.batchDate && o.assignment_source !== "pending" && rangeSet.has(o.batchDate)
    );
  }, [orders, rangeISO.join(",")]);

  // 依日欄分組
  const byDay = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const iso of rangeISO) m.set(iso, []);
    for (const o of batchOrders) {
      if (!o.batchDate) continue;
      m.get(o.batchDate)?.push(o);
    }
    return m;
  }, [batchOrders, rangeISO.join(",")]);

  // Yen「只需要顯示已經排定訂單的日期」→ 過濾出有排單的日子
  const displayDays = useMemo(() => rangeISO.filter((iso) => (byDay.get(iso) ?? []).length > 0), [rangeISO, byDay]);

  const weekAtomBreakdown = useMemo(() => {
    return [...accumulateAtoms(batchOrders).entries()]
      .filter(([, q]) => q > 0)
      .map(([atom, qty]) => ({ atom, qty }))
      .sort((a, b) => b.qty - a.qty);
  }, [batchOrders]);
  const weekTotal = weekAtomBreakdown.reduce((s, r) => s + r.qty, 0);

  return (
    <div className="h-full flex flex-col min-h-0" style={{ overflowY: "auto" }}>
      <style>{`
        @media print {
          nav, .no-print { display: none !important; }
          body { background: #fff !important; color: #000 !important; }
          .worksheet-print { background: #fff !important; color: #000 !important; padding: 24px !important; }
          .worksheet-print * { color: #000 !important; background: transparent !important; border-color: #000 !important; }
          .worksheet-print .day-block { break-inside: avoid; page-break-inside: avoid; }
          .worksheet-print .week-summary { break-after: page; page-break-after: always; }
        }
      `}</style>

      <div className="worksheet-print px-6 py-4" style={{ flex: 1, minHeight: 0 }}>
        {/* 頂端：批次身份 + 週切換 + 列印 button */}
        <div className="flex items-baseline justify-between flex-wrap no-print" style={{ marginBottom: 16, gap: 12 }}>
          <div>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 22, color: "#F5F4EF" }}>
              當週工單 · 麵包師傅版
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 11, color: "#7A7A82", marginTop: 4, letterSpacing: ".08em" }}>
              {anchor
                ? <>批次 {mdOf(anchor)}出貨 · 製作 range {rangeISO[0] ? mdOf(rangeISO[0]) : "—"} – {mdOf(anchor)}（{rangeISO.length} 天）</>
                : <>本週無出貨日</>}
              {locked
                ? <span style={{ color: "var(--acc,#F5D400)", marginLeft: 10 }}>🔒 本週已鎖定</span>
                : <span style={{ color: "#E5622A", marginLeft: 10 }}>⚠ 本週未鎖定 · 排程可能仍在調整</span>}
            </div>
          </div>
          <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
            <div className="flex" style={{ gap: 2 }}>
              <button type="button" onClick={() => setWeekOffset((w) => w - 1)} style={navBtn}>‹ 上週</button>
              <button type="button" onClick={() => setWeekOffset(0)} style={weekOffset === 0 ? navBtnActive : navBtn}>本週</button>
              <button type="button" onClick={() => setWeekOffset((w) => w + 1)} style={navBtn}>下週 ›</button>
            </div>
            <span style={{ fontFamily: F.mono, fontSize: 11, color: "#8A8A93", padding: "0 6px" }}>
              {mdOf(weekISO[0]!)} – {mdOf(weekISO[6]!)}
            </span>
            <button
              type="button"
              onClick={() => window.print()}
              style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#111", background: "var(--acc,#F5D400)", border: "none", padding: "10px 20px", cursor: "pointer", letterSpacing: ".08em" }}
            >
              🖨 列印工單 (Cmd+P)
            </button>
          </div>
        </div>

        {/* 列印用 header */}
        <div style={{ marginBottom: 20, borderBottom: "2px solid #26262C", paddingBottom: 12 }}>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 20, color: "#F5F4EF" }}>
            NARCOS.sugar · 當週工單 {anchor ? `· ${mdOf(anchor)}批次` : ""}
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: "#8A8A93", marginTop: 4 }}>
            {anchor
              ? <>製作 range：{rangeISO[0] ? mdOf(rangeISO[0]) : "—"} – {mdOf(anchor)}（{rangeISO.length} 天）· 出貨日：{mdOf(anchor)}</>
              : <>本週無出貨日</>}
            {" · "}列印時間：{today.toLocaleString("zh-TW")}
          </div>
        </div>

        {/* Section 1：本工單總出貨統計（range 內所有訂單 · 含上週工作日排入的） */}
        <div className="week-summary" style={{ marginBottom: 24, background: "#0F0F12", border: "1px solid #26262C", padding: "16px 18px" }}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 12, gap: 10 }}>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 16, color: "var(--acc,#F5D400)" }}>
              📊 本批出貨總量 {anchor && <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", marginLeft: 6 }}>· {mdOf(anchor)} 出貨</span>}
            </div>
            <div className="flex items-baseline" style={{ gap: 14 }}>
              <span style={{ fontFamily: F.anton, fontSize: 26, color: "#F5F4EF" }}>{batchOrders.length}</span>
              <span style={{ fontFamily: F.tc, fontSize: 11, color: "#8A8A93" }}>單</span>
              <span style={{ fontFamily: F.anton, fontSize: 28, color: "var(--acc,#F5D400)" }}>{weekTotal}</span>
              <span style={{ fontFamily: F.tc, fontSize: 11, color: "#8A8A93" }}>顆</span>
            </div>
          </div>
          {weekAtomBreakdown.length === 0 ? (
            <div style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74" }}>本批 range 無排單</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "6px 20px" }}>
              {weekAtomBreakdown.map((r) => (
                <div key={r.atom} className="flex items-baseline justify-between" style={{ padding: "6px 10px", background: "#141417", borderLeft: "3px solid var(--acc,#F5D400)" }}>
                  <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 13, color: "#F5F4EF" }}>☐ {getDisplayName(r.atom, menu)}</span>
                  <span style={{ fontFamily: F.anton, fontSize: 18, color: "#F5F4EF" }}>{r.qty}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 2：每日排程 TODO · 只列有排單的日子 */}
        <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: "#F5F4EF", marginBottom: 10 }}>
          🗓 每日排程 · TODO <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 11, color: "#7A7A82", marginLeft: 6 }}>· 有排單的日子 {displayDays.length} 天</span>
        </div>
        {displayDays.length === 0 ? (
          <div style={{ background: "#0F0F12", border: "1px dashed #26262C", padding: "24px", textAlign: "center", fontFamily: F.mono, fontSize: 12, color: "#6C6C74" }}>
            本批尚無任何排定訂單
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {displayDays.map((iso) => {
              const d = new Date(iso);
              const t = dayTypeOf(iso);
              const label = t === "ship" ? "出貨" : "工作";
              const list = byDay.get(iso) ?? [];
              const dayBreakdown = [...accumulateAtoms(list).entries()]
                .filter(([, q]) => q > 0)
                .map(([atom, qty]) => ({ atom, qty }))
                .sort((a, b) => b.qty - a.qty);
              const dayTotal = dayBreakdown.reduce((s, r) => s + r.qty, 0);
              const bg = t === "ship" ? "#1c1600" : "#0a1620";
              const border = t === "ship" ? "2px solid var(--acc,#F5D400)" : "1px solid #2AC7E8";
              return (
                <div key={iso} className="day-block" style={{ background: bg, border, padding: "12px 14px" }}>
                  <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 10, marginBottom: 8 }}>
                    <div className="flex items-baseline" style={{ gap: 8 }}>
                      <span style={{ fontFamily: F.anton, fontSize: 22, color: t === "ship" ? "var(--acc,#F5D400)" : "#F5F4EF" }}>{d.getDate()}</span>
                      <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 14, color: t === "ship" ? "var(--acc,#F5D400)" : "#2AC7E8" }}>
                        {WD[d.getDay()]} · {label}
                      </span>
                      <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82" }}>{mdOf(iso)}</span>
                    </div>
                    <div className="flex items-baseline" style={{ gap: 6 }}>
                      <span style={{ fontFamily: F.anton, fontSize: 18, color: "#F5F4EF" }}>{list.length}</span>
                      <span style={{ fontFamily: F.tc, fontSize: 10, color: "#8A8A93" }}>單</span>
                      <span style={{ fontFamily: F.anton, fontSize: 20, color: "var(--acc,#F5D400)" }}>{dayTotal}</span>
                      <span style={{ fontFamily: F.tc, fontSize: 10, color: "#8A8A93" }}>顆</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {dayBreakdown.map((r) => (
                      <div key={r.atom} className="flex items-baseline justify-between" style={{ padding: "5px 10px", background: "#141417" }}>
                        <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#F5F4EF" }}>☐ {getDisplayName(r.atom, menu)}</span>
                        <span style={{ fontFamily: F.anton, fontSize: 15, color: "#F5F4EF" }}>{r.qty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 24, paddingTop: 12, borderTop: "1px solid #26262C", fontFamily: F.mono, fontSize: 10, color: "#6C6C74" }}>
          資料源：narcos-oven schedule · Yen 拍板排程 · 麵包師傅參考製作
        </div>
      </div>
    </div>
  );
}
