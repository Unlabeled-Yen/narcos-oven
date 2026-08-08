/**
 * PrintLabelsPage · 印標籤（熱感紙預覽 + 印出 · Yen 2026-07-04 從 LabelsPage 拆出）
 *
 * #1 2026-08-06 改版：真實尺寸 4cm×3cm、一標一頁（Xprinter XP-P3301B 熱感應
 * 標籤機，203dpi）。@page size 跟著選的尺寸走，不再是固定「每頁 3 張」的
 * 文案版面——見 src/domain/label-layout.ts。
 *
 * 左控制欄：批次選擇、尺寸切換、標籤規則、總數計算、印出按鈕
 * 右預覽：畫面用 CSS transform 放大同一份 mm/pt 標記（跟列印同源，不會
 *         有「畫面看起來對、印出來不對」的落差）
 *
 * LabelsPage 現在只負責出貨明細（BatchDetailPanel）· 印標籤獨立為此頁
 */
import { useState, useMemo, useCallback } from "react";
import { extractLabels } from "../../output/label-data";
import type { PageProps } from "./types";
import { F, C, LabelPage } from "./LabelsPage.helpers";
import { labelLayout, pagesFor, LABEL_PRESET_ORDER, type LabelPresetKey } from "../../domain/label-layout";
import { loadDayOverrides, makeDayTypeOf, shippingDayFor } from "../../domain/day-type";
import { batchListFrom } from "../../domain/current-batch";
import { NutritionLabelsPanel } from "./NutritionLabelsPanel";

const INNER_TABS = [
  { key: "shipping", label: "出貨標籤" },
  { key: "nutrition", label: "營養成分表" },
] as const;
type InnerTabKey = (typeof INNER_TABS)[number]["key"];

export function PrintLabelsPage({ orders, menu, currentBatch, setCurrentBatch }: PageProps) {
  const [innerTab, setInnerTab] = useState<InnerTabKey>("shipping");

  const dayTypeOf = useMemo(() => makeDayTypeOf(menu, loadDayOverrides()), [menu]);
  const orderBatchMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) {
      if (o.batchDate) m.set(o.id, shippingDayFor(o.batchDate, dayTypeOf));
    }
    return m;
  }, [orders, dayTypeOf]);
  // #11+#14：跟工單/出貨明細共用同一顆 batchListFrom；印標籤語意不排除全 shipped 批
  //   （師傅事後可能還要重印歷史批次的標籤）
  const shippingBatchDates = useMemo(
    () => batchListFrom(orders, dayTypeOf, { excludeFullyShipped: false }),
    [orders, dayTypeOf]
  );

  // #15：印標籤跟營養成分表共用同一個批次選擇器；#11+#14：批次改走全域狀態
  const batchMissing = currentBatch !== null && !shippingBatchDates.includes(currentBatch);
  const selectedBatch = currentBatch !== null && shippingBatchDates.includes(currentBatch)
    ? currentBatch
    : (shippingBatchDates[shippingBatchDates.length - 1] ?? "");

  const batchOrders = useMemo(() => {
    if (!selectedBatch) return [];
    return orders.filter((o) => orderBatchMap.get(o.id) === selectedBatch);
  }, [orders, orderBatchMap, selectedBatch]);

  const [sizeKey, setSizeKey] = useState<LabelPresetKey>("4x3cm");
  const [previewPage, setPreviewPage] = useState(0);
  const [printing, setPrinting] = useState(false);

  const layout = labelLayout(sizeKey);

  const allLabels = useMemo(() => {
    if (!selectedBatch || batchOrders.length === 0) return [];
    const rawDates = new Set(batchOrders.map((o) => o.batchDate).filter(Boolean) as string[]);
    const out: ReturnType<typeof extractLabels> = [];
    for (const bd of rawDates) {
      out.push(...extractLabels(batchOrders, menu, { batchDate: bd }));
    }
    return out;
  }, [batchOrders, menu, selectedBatch]);

  // 一標一頁：頁數 = 標籤數，不再分批分組
  const totalPages = pagesFor(allLabels.length, layout);
  const safePageIdx = Math.min(previewPage, Math.max(0, totalPages - 1));
  const currentLabel = allLabels[safePageIdx];

  const orderCount = useMemo(() => new Set(allLabels.map((l) => l.order_id)).size, [allLabels]);
  const nonSellerBuyCount = useMemo(() => allLabels.filter((l) => l.kind !== "賣貨便").length, [allLabels]);

  const isEmpty = shippingBatchDates.length === 0 || allLabels.length === 0;

  const handlePrint = useCallback(async () => {
    if (allLabels.length === 0) return;
    setPrinting(true);
    document.body.classList.add("printing-labels");
    try {
      window.print();
    } catch (err) {
      console.error("[PrintLabelsPage] print failed:", err);
    } finally {
      const cleanup = () => document.body.classList.remove("printing-labels");
      window.addEventListener("afterprint", cleanup, { once: true });
      setTimeout(cleanup, 2000);
      setPrinting(false);
    }
  }, [allLabels]);

  return (
    <div className="h-full flex flex-col min-h-0" style={{ overflowY: "auto" }}>
      {/* 「只印 .label-print-area、其餘區塊移出 flow」的規則在 index.css
          （body.printing-labels 那段、跟 .print-area 同一套 :has() 技巧）。
          這裡只放版面相關、隨選擇的尺寸而變的規則。 */}
      <style>{`
        @media print {
          @page { ${layout.pageCss} }
          .label-page { box-shadow: none !important; width: auto !important; height: auto !important; page-break-after: always; }
          .label-page:last-child { page-break-after: auto; }
          .label-page-zoom { transform: none !important; }
          .label-card { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* 分頁切換 + 共用批次選擇器（#15：出貨標籤/營養成分表共用同一個批次） */}
      <div className="no-print" style={{ padding: "16px 24px 0", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 2 }}>
          {INNER_TABS.map((t) => {
            const isActive = t.key === innerTab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => { setInnerTab(t.key); setPreviewPage(0); }}
                style={{
                  fontFamily: F.tc, fontWeight: 700, fontSize: 13,
                  color: isActive ? "#0B0B0C" : C.mut2,
                  background: isActive ? C.acc : C.line2,
                  padding: "8px 18px", border: "none",
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 16 }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut2, letterSpacing: ".12em", marginBottom: 8 }}>批次</div>
          {batchMissing && (
            <div style={{ background: "#2a1010", border: "1px solid #E5352B", padding: "6px 10px", marginBottom: 8, fontFamily: F.mono, fontSize: 11, color: "#E5352B" }}>
              ⚠ 選中的批次已不存在（顯示改回最近批次）
            </div>
          )}
          {shippingBatchDates.length === 0 ? (
            <div style={{ fontFamily: F.mono, fontSize: 12, color: C.mut3 }}>（無批次）</div>
          ) : (
            <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
              {shippingBatchDates.map((d) => {
                const isActive = d === selectedBatch;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { setCurrentBatch(d); setPreviewPage(0); }}
                    style={{
                      fontFamily: F.mono, fontSize: 12,
                      color: isActive ? "#0B0B0C" : C.mut2,
                      background: isActive ? C.acc : C.line2,
                      padding: "7px 14px", border: "none",
                      cursor: "pointer", fontWeight: isActive ? 700 : 400,
                    }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {innerTab === "nutrition" ? (
        <div style={{ padding: "0 24px 16px", flex: 1, minHeight: 0, display: "flex" }}>
          <NutritionLabelsPanel batchOrders={batchOrders} menu={menu} selectedBatch={selectedBatch} />
        </div>
      ) : (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "300px 1fr",
          gap: 16,
          padding: "0 24px 16px",
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* 左控制欄 */}
        <div className="no-print" style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0, overflowY: "auto" }}>
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 16 }}>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut2, letterSpacing: ".12em", marginBottom: 8 }}>標籤尺寸</div>
            <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
              {LABEL_PRESET_ORDER.map((key) => {
                const isActive = key === sizeKey;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setSizeKey(key); setPreviewPage(0); }}
                    style={{
                      fontFamily: F.mono, fontSize: 12,
                      color: isActive ? "#0B0B0C" : C.mut2,
                      background: isActive ? C.acc : C.line2,
                      padding: "7px 12px", border: "none",
                      cursor: "pointer", fontWeight: isActive ? 700 : 400,
                    }}
                  >
                    {labelLayout(key).displayLabel}
                  </button>
                );
              })}
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, lineHeight: 1.7, marginTop: 10 }}>
              真實尺寸 {layout.pageWidthMm}×{layout.pageHeightMm}mm · 一標一頁
            </div>
          </div>

          <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 16 }}>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 14, color: C.ink, marginBottom: 10 }}>標籤規則</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: "#9A9AA2" }}>
              <div>· 賣貨便：每箱一張（依配送數量）</div>
              <div>· 面交 / KOL：每品項一張</div>
              <div>· 分盒編號 <span style={{ fontFamily: F.mono, color: "#C9C9CF" }}>N-1 / N-2…</span></div>
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}`, display: "flex", flexDirection: "column", gap: 6, fontFamily: F.mono, fontSize: 11 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: C.mut }}>本批訂單</span>
                <span style={{ color: "#E7E7EA" }}>{orderCount} 單</span>
              </div>
              {nonSellerBuyCount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: C.mut }}>面交/KOL 品項展開</span>
                  <span style={{ color: C.orange }}>+{nonSellerBuyCount} 張</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: C.ink, fontWeight: 700 }}>標籤總數</span>
                <span style={{ color: C.acc, fontWeight: 700 }}>{allLabels.length} 張</span>
              </div>
            </div>
          </div>

          {!isEmpty && (
            <button
              type="button"
              onClick={handlePrint}
              disabled={printing}
              style={{
                width: "100%",
                fontFamily: F.tc, fontWeight: 900, fontSize: 13,
                color: "#111", background: C.acc, border: "none",
                padding: "12px 0", cursor: printing ? "wait" : "pointer",
                opacity: printing ? 0.6 : 1,
              }}
            >
              {printing ? "列印中…" : "🖨 列印 / 存 PDF"}
            </button>
          )}
        </div>

        {/* 右預覽 */}
        <div className="labels-preview" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10, minHeight: 0, overflowY: "auto" }}>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mut3 }}>
            {isEmpty ? "（無標籤）" : `預覽 · 第 ${safePageIdx + 1} 張 / 共 ${totalPages} 張 · ${layout.displayLabel}`}
          </div>

          {isEmpty && (
            <div
              style={{
                width: 590, maxWidth: "100%",
                background: C.panel, border: `1px solid ${C.line}`,
                padding: "48px 32px", textAlign: "center",
              }}
            >
              <div style={{ fontFamily: F.anton, fontSize: 32, color: C.mut3 }}>NO LABELS</div>
              <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 13, color: C.mut, marginTop: 10 }}>
                {shippingBatchDates.length === 0
                  ? "尚無任何出爐批次。請先匯入訂單並確認批次日期。"
                  : "此批次沒有 confirmed 訂單、無法產生標籤。"}
              </div>
            </div>
          )}

          {!isEmpty && currentLabel && <LabelPage label={currentLabel} layout={layout} />}

          {!isEmpty && totalPages > 1 && (
            <div style={{ display: "flex", gap: 6, alignSelf: "center", marginTop: 4, flexWrap: "wrap", maxWidth: 590 }}>
              {Array.from({ length: totalPages }).map((_, i) => {
                const isActive = i === safePageIdx;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPreviewPage(i)}
                    style={{
                      fontFamily: F.mono, fontSize: 11,
                      color: isActive ? "#0B0B0C" : C.mut2,
                      background: isActive ? C.acc : C.line2,
                      padding: "5px 11px", border: "none",
                      cursor: "pointer", fontWeight: isActive ? 700 : 400,
                    }}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Label Print Area · 螢幕隱藏、印時透過 body.printing-labels 顯示 */}
      <div className="label-print-area" style={{ display: "none" }} aria-hidden="true">
        {allLabels.map((label, i) => (
          <LabelPage key={`${label.order_id}-${label.index}-${i}`} label={label} layout={layout} />
        ))}
      </div>
    </div>
  );
}
