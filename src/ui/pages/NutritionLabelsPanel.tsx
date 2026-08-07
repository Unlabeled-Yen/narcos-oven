/**
 * NutritionLabelsPanel · #15 營養成分表（印標籤頁的子分頁 · 2026-08-06）
 *
 * 盒模型計數見 src/domain/nutrition.ts；版面沿用 #1 的 labelLayout()
 * 基建、走 5x8cm preset（50mm×80mm、一張一頁、圖檔滿版）。
 *
 * 資產：src/assets/nutrition/*.jpg，檔名對照存在 menu.yaml 各 atom 的
 * nutrition_label 欄位——這裡只負責「照 menu 給的檔名找圖」，不做任何
 * 猜測比對。
 */
import { useCallback, useMemo, useState } from "react";
import type { Menu, Order } from "../../domain/models";
import { nutritionSheetsFor } from "../../domain/nutrition";
import { labelLayout, pagesFor } from "../../domain/label-layout";
import { F, C } from "./LabelsPage.helpers";

// Vite：一次性把 nutrition 資產夾下全部圖檔解成 URL，key 是完整相對路徑
const NUTRITION_ASSETS = import.meta.glob<string>("../../assets/nutrition/*.jpg", {
  eager: true,
  import: "default",
});
function resolveNutritionUrl(filename: string): string | null {
  for (const [path, url] of Object.entries(NUTRITION_ASSETS)) {
    if (path.endsWith(`/${filename}`)) return url;
  }
  return null;
}

const NUTRITION_LABEL_VERSION = "2026-05-12";
const SHEET_PRESET = "5x8cm" as const;

function NutritionSheetPage({ imageUrl, layout }: { imageUrl: string; layout: ReturnType<typeof labelLayout> }) {
  const PREVIEW_ZOOM = 3;
  const wPx = Math.round(layout.pageWidthMm * 3.7795275591);
  const hPx = Math.round(layout.pageHeightMm * 3.7795275591);
  return (
    <div
      className="label-page"
      style={{
        width: wPx * PREVIEW_ZOOM,
        height: hPx * PREVIEW_ZOOM,
        maxWidth: "100%",
        boxShadow: "0 30px 70px rgba(0,0,0,.5)",
        overflow: "hidden",
      }}
    >
      <div
        className="label-page-zoom"
        style={{
          width: `${layout.pageWidthMm}mm`,
          height: `${layout.pageHeightMm}mm`,
          transform: `scale(${PREVIEW_ZOOM})`,
          transformOrigin: "top left",
        }}
      >
        <img
          src={imageUrl}
          alt=""
          className="nutrition-sheet-img"
          style={{
            width: `${layout.pageWidthMm}mm`,
            height: `${layout.pageHeightMm}mm`,
            objectFit: "cover",
            display: "block",
          }}
        />
      </div>
    </div>
  );
}

export function NutritionLabelsPanel({
  batchOrders,
  menu,
  selectedBatch,
}: {
  batchOrders: Order[];
  menu: Menu;
  selectedBatch: string;
}) {
  const [previewPage, setPreviewPage] = useState(0);
  const [printing, setPrinting] = useState(false);
  const layout = labelLayout(SHEET_PRESET);

  // 只算 confirmed/已批次的訂單（跟出貨標籤同一批訂單集合）
  const result = useMemo(() => nutritionSheetsFor(batchOrders, menu), [batchOrders, menu]);

  // 展開成一張一頁的清單：sheets 裡每個 atom 重複 count 次
  const allSheets = useMemo(() => {
    const out: { atomId: string; nutritionLabel: string }[] = [];
    for (const s of result.sheets) {
      if (!s.nutritionLabel) continue;
      for (let i = 0; i < s.count; i++) out.push({ atomId: s.atomId, nutritionLabel: s.nutritionLabel });
    }
    return out;
  }, [result.sheets]);

  const totalPages = pagesFor(allSheets.length, layout);
  const safePageIdx = Math.min(previewPage, Math.max(0, totalPages - 1));
  const currentSheet = allSheets[safePageIdx];
  const currentUrl = currentSheet ? resolveNutritionUrl(currentSheet.nutritionLabel) : null;

  const isEmpty = !selectedBatch || allSheets.length === 0;

  const handlePrint = useCallback(async () => {
    if (allSheets.length === 0) return;
    setPrinting(true);
    document.body.classList.add("printing-nutrition");
    try {
      window.print();
    } catch (err) {
      console.error("[NutritionLabelsPanel] print failed:", err);
    } finally {
      const cleanup = () => document.body.classList.remove("printing-nutrition");
      window.addEventListener("afterprint", cleanup, { once: true });
      setTimeout(cleanup, 2000);
      setPrinting(false);
    }
  }, [allSheets]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "300px 1fr",
        gap: 16,
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* 「只印 .nutrition-print-area、其餘區塊移出 flow」的規則在 index.css
          （body.printing-nutrition 那段、跟 .print-area 同一套 :has() 技巧）。 */}
      <style>{`
        @media print {
          @page { ${layout.pageCss} }
          .label-page { box-shadow: none !important; width: auto !important; height: auto !important; page-break-after: always; }
          .label-page:last-child { page-break-after: auto; }
          .label-page-zoom { transform: none !important; }
          .nutrition-sheet-img { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* 左控制欄 */}
      <div className="no-print" style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0, overflowY: "auto" }}>
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 16 }}>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 14, color: C.ink, marginBottom: 6 }}>本批需求總表</div>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, marginBottom: 10 }}>
            成分表版本 {NUTRITION_LABEL_VERSION} · 真實尺寸 {layout.pageWidthMm}×{layout.pageHeightMm}mm
          </div>
          {result.sheets.length === 0 ? (
            <div style={{ fontFamily: F.mono, fontSize: 12, color: C.mut3 }}>（本批無需成分表）</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {result.sheets.map((s) => {
                const url = s.nutritionLabel ? resolveNutritionUrl(s.nutritionLabel) : null;
                return (
                  <div key={s.atomId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {url ? (
                      <img src={url} alt="" style={{ width: 28, height: 28, objectFit: "cover", border: `1px solid ${C.line}` }} />
                    ) : (
                      <div style={{ width: 28, height: 28, background: C.line2 }} />
                    )}
                    <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: "#C9C9CF", flex: 1 }}>{s.atomId}</div>
                    <div style={{ fontFamily: F.mono, fontSize: 12, color: C.acc, fontWeight: 700 }}>{s.count} 張</div>
                  </div>
                );
              })}
              <div style={{ marginTop: 6, paddingTop: 8, borderTop: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: C.ink }}>成分表總數</span>
                <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 12, color: C.acc }}>{result.totalSheets} 張</span>
              </div>
            </div>
          )}
        </div>

        {result.undecidedAtoms.length > 0 && (
          <div style={{ background: "#2A1A0E", border: `1px solid ${C.orange}`, padding: 12 }}>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: C.orange, marginBottom: 6 }}>
              ⚠ {result.undecidedAtoms.length} 個品項尚未設定成分表（無法列印）
            </div>
            {result.undecidedAtoms.map((u) => (
              <div key={u.atomId} style={{ fontFamily: F.mono, fontSize: 11, color: "#E7B98A" }}>
                {u.atomId} · 本應 {u.count} 張 · {u.sourceOrderIds.length} 筆訂單受影響
              </div>
            ))}
          </div>
        )}

        {result.boxMismatchWarnings.length > 0 && (
          <div style={{ background: "#2A1A0E", border: `1px solid ${C.orange}`, padding: 12 }}>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: C.orange, marginBottom: 6 }}>
              ⚠ {result.boxMismatchWarnings.length} 筆訂單推導盒數跟標籤張數不一致
            </div>
            {result.boxMismatchWarnings.map((w) => (
              <div key={w.order_id} style={{ fontFamily: F.mono, fontSize: 11, color: "#E7B98A" }}>
                {w.order_id} · 推導 {w.derivedBoxCount} 盒、標籤張數 {w.labelCount}，請人工核對成分表配置
              </div>
            ))}
          </div>
        )}

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
            {printing ? "列印中…" : "🖨 列印成分表"}
          </button>
        )}
      </div>

      {/* 右預覽 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10, minHeight: 0, overflowY: "auto" }}>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mut3 }}>
          {isEmpty ? "（無成分表）" : `預覽 · 第 ${safePageIdx + 1} 張 / 共 ${totalPages} 張 · ${currentSheet?.atomId ?? ""}`}
        </div>

        {isEmpty && (
          <div style={{ width: 590, maxWidth: "100%", background: C.panel, border: `1px solid ${C.line}`, padding: "48px 32px", textAlign: "center" }}>
            <div style={{ fontFamily: F.anton, fontSize: 28, color: C.mut3 }}>本批無需成分表</div>
            <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 13, color: C.mut, marginTop: 10 }}>
              {!selectedBatch ? "請先選一個批次。" : "此批次沒有品項需要貼成分表。"}
            </div>
          </div>
        )}

        {!isEmpty && currentSheet && currentUrl && <NutritionSheetPage imageUrl={currentUrl} layout={layout} />}
        {!isEmpty && currentSheet && !currentUrl && (
          <div style={{ width: 400, background: "#2A1A0E", border: `1px solid ${C.orange}`, padding: 24, textAlign: "center" }}>
            <div style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 13, color: C.orange }}>
              ⚠ 找不到 {currentSheet.atomId} 的圖檔（{currentSheet.nutritionLabel}）
            </div>
          </div>
        )}

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

      {/* Print Area */}
      <div className="nutrition-print-area" style={{ display: "none" }} aria-hidden="true">
        {allSheets.map((s, i) => {
          const url = resolveNutritionUrl(s.nutritionLabel);
          if (!url) return null;
          return <NutritionSheetPage key={`${s.atomId}-${i}`} imageUrl={url} layout={layout} />;
        })}
      </div>
    </div>
  );
}
