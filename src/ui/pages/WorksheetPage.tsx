/**
 * WorksheetPage — 當週工單（麵包師傅列印版）
 *
 * Yen 2026-07-03：整週鎖定後印給師傅使用
 * Yen 2026-07-06：主要展示當週批次的「單品各項統計數量」（atom 級）· 訂單組合降為對照
 *   內容：單品製作統計（todo list 風格）+ 訂單組合對照
 *   列印：瀏覽器 Cmd+P · print CSS 排版
 *   資料源：跟 SchedulePage 同套（accumulateAtoms / day-type / week-locks / batch range）
 */
import { useMemo, useState } from "react";
import { makeDayTypeOf, loadDayOverrides, shippingDayFor } from "../../domain/day-type";
import { computeBatchRange } from "../../domain/batch-range";
import { accumulateAtoms } from "../../domain/production-time";
import { getDisplayName } from "../../domain/menu";
import { batchListFrom } from "../../domain/current-batch";
import { isDayLocked } from "../../db/week-locks";
import type { PageProps } from "./types";

const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
};
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

export function WorksheetPage({ orders, menu, currentBatch, setCurrentBatch }: PageProps) {
  const today = useMemo(() => new Date(), []);
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = useMemo(() => mondayOf(today, weekOffset), [today, weekOffset]);
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekISO = week.map(toISO);

  const dayOverrides = loadDayOverrides();
  const dayTypeOf = makeDayTypeOf(menu, dayOverrides);

  // Yen 2026-07-06：一週可能有多個出貨日 · 全部列出讓使用者選 · 不再只鎖定最後一個
  const weekShipDays = useMemo(
    () => weekISO.filter((iso) => dayTypeOf(iso) === "ship"),
    [weekISO.join(","), dayOverrides, menu]
  );

  // #11+#14：批次清單改用跨週收斂（複用 LabelsPage 同一顆 batchListFrom）
  //   ·「上週/本週/下週」保留為快速捲動輔助、不再是資料邊界
  //   · 不排除全 shipped 批（工單語意跟印標籤一致，見 docs 順位 9 規格 3）
  const allBatches = useMemo(
    () => batchListFrom(orders, dayTypeOf, { excludeFullyShipped: false }),
    [orders, dayTypeOf]
  );
  // 全域批次存在但這頁的清單裡沒有（極少見：day-overrides 剛好把它排除掉）
  //   → 顯性提示，不靜默 fallback 到別的批次
  const batchMissing = currentBatch !== null && !allBatches.includes(currentBatch);
  const anchor = currentBatch !== null && allBatches.includes(currentBatch)
    ? currentBatch
    : (allBatches[allBatches.length - 1] ?? null);

  const locked = anchor ? isDayLocked(anchor) : false;

  // Yen 2026-07-03 新語意：「當週工單 = 一個批次單位」
  //   Range = anchor（選中的 shipping day）· 往前掃到前一批 ship break
  //   可含上週六日的工作日（跨週）· 只有 range 內的訂單算進本工單
  const rangeISO = useMemo(() => (anchor ? computeBatchRange(anchor, dayTypeOf) : []), [anchor, dayTypeOf, menu, dayOverrides]);

  // Yen 2026-07-06：shipped 徹底離開流程 · 只在訂單總覽看得到
  //   · 分組維度：shippingDayFor(batchDate) === anchor（出貨日）
  //   · Status 篩選：confirmed / kol_shipped（已出貨的排除）
  const batchOrders = useMemo(() => {
    if (!anchor) return [];
    return orders.filter((o) => {
      if (!o.batchDate) return false;
      if (o.status !== "confirmed" && o.status !== "kol_shipped") return false;
      return shippingDayFor(o.batchDate, dayTypeOf) === anchor;
    });
  }, [orders, anchor, dayTypeOf]);

  // Yen 2026-07-06 決策：主要展示「單品各項統計」· 師傅實際要烤的是單品顆數
  //   atom 級（單品）為主 · SKU 級（訂單組合）降為出貨對照參考
  const atomBreakdown = useMemo(() => {
    return [...accumulateAtoms(batchOrders).entries()]
      .filter(([, q]) => q > 0)
      .map(([atom, qty]) => ({ atom, qty }))
      .sort((a, b) => b.qty - a.qty);
  }, [batchOrders]);
  const atomTotal = atomBreakdown.reduce((s, r) => s + r.qty, 0);

  const skuBreakdown = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of batchOrders) {
      for (const it of o.items) {
        if (!it.productSkuId) continue;
        m.set(it.productSkuId, (m.get(it.productSkuId) ?? 0) + it.quantity);
      }
    }
    return [...m.entries()]
      .filter(([, q]) => q > 0)
      .map(([sku, qty]) => ({ sku, qty }))
      .sort((a, b) => b.qty - a.qty);
  }, [batchOrders]);

  return (
    <div className="h-full flex flex-col min-h-0" style={{ overflowY: "auto" }}>
      <style>{`
        @media print {
          .print-area * { color: #000 !important; border-color: #000 !important; }
          .print-area .day-block { break-inside: avoid; page-break-inside: avoid; }
          .print-area .week-summary { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="print-area px-6 py-4" style={{ flex: 1, minHeight: 0 }}>
        {/* 頂端：批次身份 + 週切換 + 列印 button */}
        <div className="flex items-baseline justify-between flex-wrap no-print" style={{ marginBottom: 16, gap: 12 }}>
          <div>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 22, color: "#F5F4EF" }}>
              當週工單
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 11, color: "#7A7A82", marginTop: 4, letterSpacing: ".08em" }}>
              {anchor
                ? <>批次 {mdOf(anchor)}出貨 · 製作 range {rangeISO[0] ? mdOf(rangeISO[0]) : "—"} – {mdOf(anchor)}（{rangeISO.length} 天）</>
                : <>尚無任何批次</>}
              {anchor && (locked
                ? <span style={{ color: "var(--acc,#F5D400)", marginLeft: 10 }}>🔒 本批次已鎖定</span>
                : <span style={{ color: "#E5622A", marginLeft: 10 }}>⚠ 本批次未鎖定 · 排程可能仍在調整</span>)}
              {batchMissing && (
                <span style={{ color: "#E5352B", marginLeft: 10 }}>⚠ 選中的批次已不存在（可能被排程日設定變更影響）</span>
              )}
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

        {/* 批次選 chip · #11+#14：跨週全批次清單（不用按「下週」找兩週後的批次）
            點選會寫回全域「當前批次」→ 切工單/出貨明細/印標籤/排程自動同步 */}
        {allBatches.length >= 1 && (
          <div className="no-print" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, alignItems: "baseline" }}>
            <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".14em", marginRight: 4 }}>
              批次 · 共 {allBatches.length} 個出貨日
            </span>
            {allBatches.map((d) => {
              const isActive = d === anchor;
              const isThisWeek = weekShipDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCurrentBatch(d)}
                  title={isThisWeek ? "本週出貨日" : undefined}
                  style={{
                    fontFamily: F.mono, fontSize: 12,
                    color: isActive ? "#111" : "#C9C9CF",
                    background: isActive ? "var(--acc,#F5D400)" : "transparent",
                    border: `1px solid ${isActive ? "var(--acc,#F5D400)" : isThisWeek ? "#7A7A82" : "#3a3a40"}`,
                    padding: "5px 12px", cursor: "pointer",
                    fontWeight: isActive ? 900 : 400,
                    letterSpacing: ".03em",
                  }}
                >
                  {mdOf(d)} 出貨
                </button>
              );
            })}
          </div>
        )}

        {/* 簡潔列印 header（Yen 2026-07-04：緊湊排版節省空間） */}
        <div style={{ marginBottom: 10, borderBottom: "2px solid #26262C", paddingBottom: 8 }}>
          <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 10 }}>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 18, color: "#F5F4EF" }}>
              當週工單 {anchor ? `· ${mdOf(anchor)}批次` : ""}
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: "#8A8A93" }}>
              {anchor
                ? <>製作 range {rangeISO[0] ? mdOf(rangeISO[0]) : "—"} – {mdOf(anchor)}（{rangeISO.length} 天）</>
                : <>本週無出貨日</>}
            </div>
          </div>
        </div>

        {/* Section 主要：本批單品製作統計（atom 級）
            Yen 2026-07-06：師傅照這張烤 · 單品顆數為主要展示 */}
        <div className="week-summary" style={{ background: "#0F0F12", border: "1px solid #26262C", padding: "14px 16px" }}>
          <div className="flex items-baseline justify-between flex-wrap" style={{ marginBottom: 12, gap: 10 }}>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 16, color: "var(--acc,#F5D400)" }}>
              📊 本週要製作 · 單品統計 {anchor && <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", marginLeft: 6 }}>· {mdOf(anchor)} 出貨</span>}
            </div>
            <div className="flex items-baseline" style={{ gap: 12 }}>
              <span style={{ fontFamily: F.anton, fontSize: 26, color: "#F5F4EF" }}>{batchOrders.length}</span>
              <span style={{ fontFamily: F.tc, fontSize: 11, color: "#8A8A93" }}>單</span>
              <span style={{ fontFamily: F.anton, fontSize: 28, color: "var(--acc,#F5D400)" }}>{atomTotal}</span>
              <span style={{ fontFamily: F.tc, fontSize: 11, color: "#8A8A93" }}>顆</span>
            </div>
          </div>
          {atomBreakdown.length === 0 ? (
            <div style={{ fontFamily: F.mono, fontSize: 12, color: "#6C6C74", padding: "12px 0" }}>本批尚無任何排入訂單</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "6px 14px" }}>
              {atomBreakdown.map((r) => (
                <div key={r.atom} className="flex items-baseline justify-between" style={{ padding: "8px 12px", background: "#141417", borderLeft: "3px solid var(--acc,#F5D400)" }}>
                  <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 13, color: "#F5F4EF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>☐ {getDisplayName(r.atom, menu)}</span>
                  <span style={{ fontFamily: F.anton, fontSize: 18, color: "#F5F4EF", marginLeft: 8 }}>{r.qty}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 次要：訂單組合（SKU）對照 · 出貨明細那邊對貨用的同一組數字 */}
        {skuBreakdown.length > 0 && (
          <div className="week-summary" style={{ background: "#0F0F12", border: "1px solid #26262C", padding: "12px 16px", marginTop: 10 }}>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#8A8A93", marginBottom: 8 }}>
              訂單組合對照（出貨明細同數字）
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "4px 12px" }}>
              {skuBreakdown.map((r) => {
                const p = menu.products[r.sku];
                const name = p?.display_name ?? r.sku;
                return (
                  <div key={r.sku} className="flex items-baseline justify-between" style={{ padding: "5px 10px", background: "#141417" }}>
                    <span style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 11, color: "#C9C9CF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                    <span style={{ fontFamily: F.anton, fontSize: 14, color: "#C9C9CF", marginLeft: 8 }}>{r.qty}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* footer 列印時省略 · 資料源說明不必要 */}
      </div>
    </div>
  );
}
