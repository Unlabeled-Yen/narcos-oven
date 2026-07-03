/**
 * LabelsPage — 出貨標籤（熱感紙預覽 + 印出即凍結，憲章 #10）
 *
 * 左控制欄（深色）：批次選擇、尺寸切換、標籤規則、總數計算、印出即凍結按鈕。
 * 右預覽（淺色熱感紙 #F5F1E6）：每頁 3 張直排 + 虛線裁切線、590×315px / 張。
 *
 * 資料來源：props.orders + props.menu（憲章 #1 禁 hardcode）。
 * 凍結：印出後 db.orders.where("id").anyOf(ids).modify({ frozen_after_label_print: true })
 * 並呼叫 refreshOrders（憲章 #10）。
 *
 * 子元件（LabelCard / LabelPage）見 LabelsPage.helpers.tsx。
 */
import { useState, useMemo, useCallback } from "react";
import { extractLabels } from "../../output/label-data";
import { BatchDetailPanel } from "./BatchDetail";
import type { PageProps } from "./types";
import { F, C, LABELS_PER_PAGE, LabelPage } from "./LabelsPage.helpers";
import { loadDayOverrides, makeDayTypeOf, shippingDayFor } from "../../domain/day-type";

// ── 標籤紙尺寸選項 ─────────────────────────────────────────────
const SIZES = [
  { key: "60x90", label: "60×90mm", note: "熱感應標籤機預設" },
  { key: "75x120", label: "75×120mm", note: "200 DPI 換算" },
] as const;
type SizeKey = (typeof SIZES)[number]["key"];

// ── LabelsPage ─────────────────────────────────────────────────
export function LabelsPage({ orders, menu, refreshOrders }: PageProps) {
  // 判定每張訂單歸屬的「出貨批」= 從 batchDate 往後找第一個 shipping day
  // 訂單若排在工作日、會被歸到後面那個 shipping day 出貨批
  const dayTypeOf = useMemo(() => makeDayTypeOf(menu, loadDayOverrides()), [menu]);
  const orderBatchMap = useMemo(() => {
    // Map<orderId, shippingDay>
    const m = new Map<string, string>();
    for (const o of orders) {
      if (o.batchDate) m.set(o.id, shippingDayFor(o.batchDate, dayTypeOf));
    }
    return m;
  }, [orders, dayTypeOf]);
  const shippingBatchDates = useMemo(() => {
    const seen = new Set<string>();
    for (const shipDay of orderBatchMap.values()) seen.add(shipDay);
    return Array.from(seen).sort();
  }, [orderBatchMap]);

  const [selectedBatch, setSelectedBatch] = useState<string>(
    shippingBatchDates[shippingBatchDates.length - 1] ?? ""
  );
  const [size, setSize] = useState<SizeKey>("60x90");
  const [previewPage, setPreviewPage] = useState(0);
  const [freezing, setFreezing] = useState(false);

  const sizeObj = SIZES.find((s) => s.key === size) ?? SIZES[0]!;

  // 該批的訂單（訂單 batchDate 對應 shippingDay = selectedBatch）
  const batchOrders = useMemo(() => {
    if (!selectedBatch) return [];
    return orders.filter((o) => orderBatchMap.get(o.id) === selectedBatch);
  }, [orders, orderBatchMap, selectedBatch]);

  // 標籤資料（憲章 #1：從 menu.label_short_forms 抽簡碼）
  // 用 batch 內每個 order.batchDate 逐一 extract、合併
  const allLabels = useMemo(() => {
    if (!selectedBatch || batchOrders.length === 0) return [];
    // extractLabels 只吃 batchDate filter · 但 batch 內可能含多個 batchDate
    // → 對每個 unique batchDate 各自 extract 再合併
    const rawDates = new Set(batchOrders.map((o) => o.batchDate).filter(Boolean) as string[]);
    const out: ReturnType<typeof extractLabels> = [];
    for (const bd of rawDates) {
      out.push(...extractLabels(batchOrders, menu, { batchDate: bd }));
    }
    return out;
  }, [batchOrders, menu, selectedBatch]);

  // 分頁（每頁 3 張）
  const pages = useMemo(() => {
    const result: (typeof allLabels)[] = [];
    for (let i = 0; i < allLabels.length; i += LABELS_PER_PAGE) {
      result.push(allLabels.slice(i, i + LABELS_PER_PAGE));
    }
    return result;
  }, [allLabels]);

  const totalPages = pages.length;
  const safePageIdx = Math.min(previewPage, Math.max(0, totalPages - 1));
  const currentPageLabels = pages[safePageIdx] ?? [];

  // 統計
  const orderCount = useMemo(() => {
    return new Set(allLabels.map((l) => l.order_id)).size;
  }, [allLabels]);

  const nonSellerBuyCount = useMemo(() => {
    return allLabels.filter((l) => l.kind !== "賣貨便").length;
  }, [allLabels]);

  // 本批訂單清單（給 BatchDetailPanel 用：對貨核對當週工作內容）
  const batchShipList = useMemo(() => {
    return batchOrders.filter(
      (o) => o.status === "confirmed" || o.status === "kol_shipped"
    );
  }, [batchOrders]);

  // 全域待排單數（跨批次、給閘門狀態用；憲章 #9 待排未清空前不應產出）
  const pendingCount = useMemo(() => {
    return orders.filter(
      (o) =>
        (o.status === "confirmed" || o.status === "pending_batch_date") &&
        (o.assignment_source === "pending" || o.batchDate === null)
    ).length;
  }, [orders]);

  const isEmpty = shippingBatchDates.length === 0 || allLabels.length === 0;

  // 列印（憲章 #10 凍結已依 Yen 決策取消 · 標籤是純輸出動作、不改狀態）
  const handlePrintAndFreeze = useCallback(async () => {
    if (allLabels.length === 0) return;
    setFreezing(true);
    try {
      window.print();
    } catch (err) {
      console.error("[LabelsPage] print failed:", err);
    } finally {
      setFreezing(false);
    }
  }, [allLabels, orders, selectedBatch, refreshOrders]);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Print CSS：只列印 .print-area，隱藏其他 */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: fixed; top: 0; left: 0; width: 100%; overflow: visible !important; }
          .label-page { box-shadow: none !important; page-break-after: always; }
          .label-page:last-child { page-break-after: auto; }
        }
      `}</style>

      {/* 出爐批次明細（排程完 → 對貨 → 印標；憲章 #9 產出閘門） */}
      {selectedBatch && !isEmpty && (
        <div style={{ padding: "12px 24px", flexShrink: 0 }}>
          <BatchDetailPanel
            shipISO={selectedBatch}
            shipList={batchShipList}
            pendingCount={pendingCount}
            menu={menu}
          />
        </div>
      )}

      {/* 主體：左控制欄 + 右預覽（flex-1 min-h-0，各自內滾） */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "300px 1fr",
          gap: 16,
          padding: "8px 24px 0",
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* ── 左控制欄（min-h-0 overflow-y-auto） ─────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0, overflowY: "auto" }}>

          {/* 批次 + 尺寸 */}
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 16 }}>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut2, letterSpacing: ".12em", marginBottom: 8 }}>
              批次
            </div>
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
                      onClick={() => { setSelectedBatch(d); setPreviewPage(0); }}
                      style={{
                        fontFamily: F.mono,
                        fontSize: 12,
                        color: isActive ? "#0B0B0C" : C.mut2,
                        background: isActive ? C.acc : C.line2,
                        padding: "7px 14px",
                        border: "none",
                        cursor: "pointer",
                        fontWeight: isActive ? 700 : 400,
                      }}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            )}

            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut2, letterSpacing: ".12em", margin: "16px 0 8px" }}>
              標籤尺寸
            </div>
            <div style={{ display: "flex", gap: 2 }}>
              {SIZES.map((s) => {
                const isActive = s.key === size;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSize(s.key)}
                    style={{
                      fontFamily: F.mono,
                      fontSize: 12,
                      color: isActive ? "#0B0B0C" : C.mut2,
                      background: isActive ? C.acc : C.line2,
                      padding: "7px 12px",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: isActive ? 700 : 400,
                    }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, lineHeight: 1.7, marginTop: 10 }}>
              單張 590×315px（1.87:1）· 每頁 3 張直排、虛線分隔 · {sizeObj.note}
            </div>
          </div>

          {/* 標籤規則 + 統計 */}
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 16 }}>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 14, color: C.ink, marginBottom: 10 }}>
              標籤規則
            </div>
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

          {/* 列印按鈕（不再凍結 · Yen 決策） */}
          {!isEmpty && (
            <button
              type="button"
              onClick={handlePrintAndFreeze}
              disabled={freezing}
              style={{
                width: "100%",
                fontFamily: F.tc,
                fontWeight: 900,
                fontSize: 13,
                color: "#111",
                background: C.acc,
                border: "none",
                padding: "12px 0",
                cursor: freezing ? "wait" : "pointer",
                opacity: freezing ? 0.6 : 1,
              }}
            >
              {freezing ? "列印中…" : "🖨 列印 / 存 PDF"}
            </button>
          )}
        </div>

        {/* ── 右預覽（flex-1 min-h-0 overflow-y-auto） ────── */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10, minHeight: 0, overflowY: "auto" }}>
          {/* 頁碼提示 */}
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mut3 }}>
            {isEmpty
              ? "（無標籤）"
              : `預覽 · 第 ${safePageIdx + 1} 頁 / ${totalPages} · ${sizeObj.label}`}
          </div>

          {/* 空狀態 */}
          {isEmpty && (
            <div
              style={{
                width: 590,
                maxWidth: "100%",
                background: C.panel,
                border: `1px solid ${C.line}`,
                padding: "48px 32px",
                textAlign: "center",
              }}
            >
              <div style={{ fontFamily: F.anton, fontSize: 32, color: C.mut3 }}>NO LABELS</div>
              <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 13, color: C.mut, marginTop: 10 }}>
                {shippingBatchDates.length === 0
                  ? "尚無任何出爐批次。請先匯入訂單並確認批次日期。"
                  : "此批次沒有 confirmed 訂單，無法產生標籤。"}
              </div>
            </div>
          )}

          {/* 標籤頁預覽 */}
          {!isEmpty && (
            <LabelPage
              labels={currentPageLabels}
              sizeLabel={sizeObj.label}
              pageIndex={safePageIdx}
              totalPages={totalPages}
            />
          )}

          {/* 頁碼導覽 */}
          {!isEmpty && totalPages > 1 && (
            <div style={{ display: "flex", gap: 6, alignSelf: "center", marginTop: 4 }}>
              {Array.from({ length: totalPages }).map((_, i) => {
                const isActive = i === safePageIdx;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPreviewPage(i)}
                    style={{
                      fontFamily: F.mono,
                      fontSize: 11,
                      color: isActive ? "#0B0B0C" : C.mut2,
                      background: isActive ? C.acc : C.line2,
                      padding: "5px 11px",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: isActive ? 700 : 400,
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

      {/* Print Area（全部頁一次列印，螢幕隱藏；print CSS 讓它 position:fixed 完整浮出） */}
      <div className="print-area" style={{ display: "none" }} aria-hidden="true">
        {pages.map((pageLabels, pi) => (
          <LabelPage
            key={pi}
            labels={pageLabels}
            sizeLabel={sizeObj.label}
            pageIndex={pi}
            totalPages={totalPages}
          />
        ))}
      </div>
    </div>
  );
}
