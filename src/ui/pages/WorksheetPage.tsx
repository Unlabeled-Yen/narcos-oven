/**
 * WorksheetPage — 當週工單（麵包師傅列印版）
 *
 * Yen 2026-07-03：整週鎖定後印給師傅使用
 *   內容：當週工作日排程 + 製作量規劃 + 當週總出貨統計（todo list 風格）
 *   列印：瀏覽器 Cmd+P · print CSS 排版
 *   資料源：跟 SchedulePage 同套（accumulateAtoms / day-type / week-locks / batch range）
 */
import { useMemo } from "react";
import type { Order } from "../../domain/models";
import { getDisplayName } from "../../domain/menu";
import { accumulateAtoms } from "../../domain/production-time";
import { makeDayTypeOf, loadDayOverrides } from "../../domain/day-type";
import { isWeekLocked } from "../../db/week-locks";
import type { PageProps } from "./types";

const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
};
const WD = ["日", "一", "二", "三", "四", "五", "六"];

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
  const weekStart = useMemo(() => mondayOf(today, 0), [today]);
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekISO = week.map(toISO);
  const weekLockKey = weekISO[0]!;
  const locked = isWeekLocked(weekLockKey);

  const dayOverrides = loadDayOverrides();
  const dayTypeOf = makeDayTypeOf(menu, dayOverrides);

  // 依日欄分組已排訂單
  const byDay = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const iso of weekISO) m.set(iso, []);
    for (const o of orders) {
      if (!o.batchDate) continue;
      if (o.assignment_source === "pending") continue;
      if (!weekISO.includes(o.batchDate)) continue;
      m.get(o.batchDate)!.push(o);
    }
    return m;
  }, [orders, weekISO.join(",")]);

  // 當週總出貨量（本週所有 shipping day 的訂單合計）
  const weekShipOrders = useMemo(() => {
    return orders.filter((o) => o.batchDate && weekISO.includes(o.batchDate) && dayTypeOf(o.batchDate) === "ship" && o.assignment_source !== "pending");
  }, [orders, weekISO.join(","), dayOverrides]);

  const weekAtomBreakdown = useMemo(() => {
    return [...accumulateAtoms(weekShipOrders).entries()]
      .filter(([, q]) => q > 0)
      .map(([atom, qty]) => ({ atom, qty }))
      .sort((a, b) => b.qty - a.qty);
  }, [weekShipOrders]);
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
        {/* 頂端：週次 + 列印 button */}
        <div className="flex items-baseline justify-between flex-wrap no-print" style={{ marginBottom: 16, gap: 12 }}>
          <div>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 22, color: "#F5F4EF" }}>
              當週工單 · 麵包師傅版
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 11, color: "#7A7A82", marginTop: 4, letterSpacing: ".08em" }}>
              {mdOf(weekISO[0]!)} – {mdOf(weekISO[6]!)}
              {locked
                ? <span style={{ color: "var(--acc,#F5D400)", marginLeft: 10 }}>🔒 本週已鎖定</span>
                : <span style={{ color: "#E5622A", marginLeft: 10 }}>⚠ 本週未鎖定 · 排程可能仍在調整</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#111", background: "var(--acc,#F5D400)", border: "none", padding: "10px 20px", cursor: "pointer", letterSpacing: ".08em" }}
          >
            🖨 列印工單 (Cmd+P)
          </button>
        </div>

        {/* 列印用 header（只在 print 顯示、螢幕隱藏；用 print media 時反轉） */}
        <div style={{ marginBottom: 20, borderBottom: "2px solid #26262C", paddingBottom: 12 }}>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 20, color: "#F5F4EF" }}>NARCOS.sugar · 當週工單</div>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: "#8A8A93", marginTop: 4 }}>
            週次：{mdOf(weekISO[0]!)} – {mdOf(weekISO[6]!)} · 列印時間：{today.toLocaleString("zh-TW")}
          </div>
        </div>

        {/* Section 1：當週總出貨統計 */}
        <div className="week-summary" style={{ marginBottom: 24, background: "#0F0F12", border: "1px solid #26262C", padding: "16px 18px" }}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 12, gap: 10 }}>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 16, color: "var(--acc,#F5D400)" }}>
              📊 當週總出貨統計
            </div>
            <div className="flex items-baseline" style={{ gap: 14 }}>
              <span style={{ fontFamily: F.anton, fontSize: 26, color: "#F5F4EF" }}>{weekShipOrders.length}</span>
              <span style={{ fontFamily: F.tc, fontSize: 11, color: "#8A8A93" }}>單</span>
              <span style={{ fontFamily: F.anton, fontSize: 28, color: "var(--acc,#F5D400)" }}>{weekTotal}</span>
              <span style={{ fontFamily: F.tc, fontSize: 11, color: "#8A8A93" }}>顆</span>
            </div>
          </div>
          {weekAtomBreakdown.length === 0 ? (
            <div style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74" }}>本週無出貨訂單</div>
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

        {/* Section 2：每日排程 · todo list */}
        <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: "#F5F4EF", marginBottom: 10 }}>
          🗓 每日排程 · TODO
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {week.map((d) => {
            const iso = toISO(d);
            const t = dayTypeOf(iso);
            const label = t === "ship" ? "出貨" : t === "work" ? "工作" : "休息";
            const list = byDay.get(iso) ?? [];
            const dayBreakdown = [...accumulateAtoms(list).entries()]
              .filter(([, q]) => q > 0)
              .map(([atom, qty]) => ({ atom, qty }))
              .sort((a, b) => b.qty - a.qty);
            const dayTotal = dayBreakdown.reduce((s, r) => s + r.qty, 0);
            const bg = t === "ship" ? "#1c1600" : t === "work" ? "#0a1620" : "#0a0a0c";
            const border = t === "ship" ? "2px solid var(--acc,#F5D400)" : t === "work" ? "1px solid #2AC7E8" : "1px dashed #26262C";
            return (
              <div key={iso} className="day-block" style={{ background: bg, border, padding: "12px 14px" }}>
                <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 10, marginBottom: 8 }}>
                  <div className="flex items-baseline" style={{ gap: 8 }}>
                    <span style={{ fontFamily: F.anton, fontSize: 22, color: t === "ship" ? "var(--acc,#F5D400)" : "#F5F4EF" }}>{d.getDate()}</span>
                    <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 14, color: t === "ship" ? "var(--acc,#F5D400)" : t === "work" ? "#2AC7E8" : "#6C6C74" }}>
                      {WD[d.getDay()]} · {label}
                    </span>
                    <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82" }}>{mdOf(iso)}</span>
                  </div>
                  {dayTotal > 0 && (
                    <div className="flex items-baseline" style={{ gap: 6 }}>
                      <span style={{ fontFamily: F.anton, fontSize: 18, color: "#F5F4EF" }}>{list.length}</span>
                      <span style={{ fontFamily: F.tc, fontSize: 10, color: "#8A8A93" }}>單</span>
                      <span style={{ fontFamily: F.anton, fontSize: 20, color: "var(--acc,#F5D400)" }}>{dayTotal}</span>
                      <span style={{ fontFamily: F.tc, fontSize: 10, color: "#8A8A93" }}>顆</span>
                    </div>
                  )}
                </div>
                {t === "rest" ? (
                  <div style={{ fontFamily: F.mono, fontSize: 11, color: "#4a4a52" }}>休息 · 不排單</div>
                ) : list.length === 0 ? (
                  <div style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74" }}>{t === "ship" ? "此日無出貨" : "此工作日無排單"}</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {dayBreakdown.map((r) => (
                      <div key={r.atom} className="flex items-baseline justify-between" style={{ padding: "5px 10px", background: "#141417" }}>
                        <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#F5F4EF" }}>☐ {getDisplayName(r.atom, menu)}</span>
                        <span style={{ fontFamily: F.anton, fontSize: 15, color: "#F5F4EF" }}>{r.qty}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 24, paddingTop: 12, borderTop: "1px solid #26262C", fontFamily: F.mono, fontSize: 10, color: "#6C6C74" }}>
          資料源：narcos-oven schedule · Yen 拍板排程 · 麵包師傅參考製作
        </div>
      </div>
    </div>
  );
}
