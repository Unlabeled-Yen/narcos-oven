/**
 * LabelsPage · 出貨明細（Yen 2026-07-04 拆分後：只顯示 BatchDetailPanel + 頂端批次選）
 *
 * 印標籤功能已挪到 PrintLabelsPage · sub-nav 分兩個 tab
 * 這頁：出貨對貨用 · SKU 統計 + 訂單詳情 + 全部確認出貨 button
 */
import { useState, useMemo, useEffect } from "react";
import { BatchDetailPanel } from "./BatchDetail";
import type { PageProps } from "./types";
import { F, C } from "./LabelsPage.helpers";
import { loadDayOverrides, makeDayTypeOf, shippingDayFor } from "../../domain/day-type";

export function LabelsPage({ orders, menu, refreshOrders }: PageProps) {
  const dayTypeOf = useMemo(() => makeDayTypeOf(menu, loadDayOverrides()), [menu]);
  const orderBatchMap = useMemo(() => {
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
  useEffect(() => {
    if (shippingBatchDates.length === 0) return;
    if (!shippingBatchDates.includes(selectedBatch)) {
      setSelectedBatch(shippingBatchDates[shippingBatchDates.length - 1]!);
    }
  }, [shippingBatchDates.join(",")]);

  const batchOrders = useMemo(() => {
    if (!selectedBatch) return [];
    return orders.filter((o) => orderBatchMap.get(o.id) === selectedBatch);
  }, [orders, orderBatchMap, selectedBatch]);

  const batchShipList = useMemo(() => {
    return batchOrders.filter((o) => o.status === "confirmed" || o.status === "kol_shipped" || o.status === "shipped");
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
                  onClick={() => setSelectedBatch(d)}
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
