/**
 * LabelsPage · 出貨明細（Yen 2026-07-04 拆分後：只顯示 BatchDetailPanel + 頂端批次選）
 *
 * 印標籤功能已挪到 PrintLabelsPage · sub-nav 分兩個 tab
 * 這頁：出貨對貨用 · SKU 統計 + 訂單詳情 + 全部確認出貨 button
 */
import { useMemo } from "react";
import { BatchDetailPanel } from "./BatchDetail";
import type { PageProps } from "./types";
import { F, C } from "./LabelsPage.helpers";
import { loadDayOverrides, makeDayTypeOf, shippingDayFor } from "../../domain/day-type";
import { batchListFrom } from "../../domain/current-batch";

export function LabelsPage({ orders, menu, refreshOrders, currentBatch, setCurrentBatch }: PageProps) {
  const dayTypeOf = useMemo(() => makeDayTypeOf(menu, loadDayOverrides()), [menu]);
  // Yen 2026-07-06：只算「還有非 shipped 訂單」的批次 · 全出貨的批次直接從選項消失
  const orderBatchMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) {
      if (o.batchDate && o.status !== "shipped") {
        m.set(o.id, shippingDayFor(o.batchDate, dayTypeOf));
      }
    }
    return m;
  }, [orders, dayTypeOf]);
  // #11+#14：跟工單/印標籤共用同一顆 batchListFrom；出貨明細語意排除全 shipped 批
  const shippingBatchDates = useMemo(
    () => batchListFrom(orders, dayTypeOf, { excludeFullyShipped: true }),
    [orders, dayTypeOf]
  );

  // 全域批次存在、但這頁排除了它（全 shipped）→ 顯性提示，不靜默 fallback
  const batchMissing = currentBatch !== null && !shippingBatchDates.includes(currentBatch);
  const selectedBatch = currentBatch !== null && shippingBatchDates.includes(currentBatch)
    ? currentBatch
    : (shippingBatchDates[shippingBatchDates.length - 1] ?? "");

  const batchOrders = useMemo(() => {
    if (!selectedBatch) return [];
    return orders.filter((o) => orderBatchMap.get(o.id) === selectedBatch);
  }, [orders, orderBatchMap, selectedBatch]);

  // Yen 2026-07-06：shipped 出貨後從批次消失 · 只在訂單總覽看得到
  const batchShipList = useMemo(() => {
    return batchOrders.filter((o) => o.status === "confirmed" || o.status === "kol_shipped");
  }, [batchOrders]);

  const isEmpty = shippingBatchDates.length === 0;

  return (
    <div className="h-full flex flex-col min-h-0" style={{ overflowY: "auto" }}>
      {/* 頂端：批次選 chip 排 · Yen 2026-07-04：出貨明細必須可以選批次 */}
      <div className="no-print" style={{ padding: "12px 24px 8px" }}>
        <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 10, marginBottom: 8 }}>
          <div className="flex items-baseline" style={{ gap: 8 }}>
            <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, letterSpacing: ".14em" }}>SHIPPING · BATCH</span>
            <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 14, color: C.ink }}>選批次</span>
          </div>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3 }}>
            共 {shippingBatchDates.length} 個出貨批 · 印標籤功能移至「印標籤」子頁
          </span>
        </div>
        {batchMissing && (
          <div style={{ background: "#2a1010", border: "1px solid #E5352B", padding: "8px 12px", marginBottom: 8, fontFamily: F.mono, fontSize: 12, color: "#E5352B" }}>
            ⚠ 目前選中的批次已全部出貨、不在出貨明細清單中（顯示改回最近批次）
          </div>
        )}
        {isEmpty ? (
          <div style={{ background: C.panel, border: `1px dashed ${C.line}`, padding: "20px 24px", textAlign: "center", fontFamily: F.mono, fontSize: 12, color: C.mut3 }}>
            尚無任何出貨批次
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {shippingBatchDates.map((d) => {
              const isActive = d === selectedBatch;
              const count = orders.filter((o) => orderBatchMap.get(o.id) === d).length;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCurrentBatch(d)}
                  style={{
                    fontFamily: F.mono, fontSize: 12,
                    color: isActive ? "#111" : C.mut2,
                    background: isActive ? C.acc : C.line2,
                    border: `1px solid ${isActive ? C.acc : "#3a3a40"}`,
                    padding: "6px 12px", cursor: "pointer",
                    fontWeight: isActive ? 900 : 400,
                    letterSpacing: ".03em",
                  }}
                >
                  {d} <span style={{ marginLeft: 4, color: isActive ? "#111" : C.mut3, fontFamily: F.mono, fontSize: 11 }}>· {count}單</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 出爐批次明細（訂單詳情 + SKU 統計 + 全部確認出貨 button） */}
      {selectedBatch && !isEmpty && (
        <div style={{ padding: "4px 24px 24px" }}>
          <BatchDetailPanel
            shipISO={selectedBatch}
            shipList={batchShipList}
            menu={menu}
            refreshOrders={refreshOrders}
          />
        </div>
      )}
    </div>
  );
}
