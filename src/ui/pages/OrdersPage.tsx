/**
 * OrdersPage — 全通路訂單台帳
 * 設計稿：出爐指揮台 訂單總覽.dc.html
 * 憲章 #1：品項顯示全經 menu.getDisplayName，禁 hardcode
 * 憲章 #2：金額全來自 orders.revenue.grossTotal，0 LLM
 */
import { useMemo, useState } from "react";
import { PageHeader } from "../brand/PageHeader";
import { ExportBtn } from "../brand/ExportBtn";
import { writeOverviewExcel } from "../../output/overview-excel";
import { getDisplayName } from "../../domain/menu";
import type { Order, OrderStatus } from "../../domain/models";
import { db } from "../../db/schema";
import type { PageProps } from "./types";

type OrderStatusValue = OrderStatus;
import {
  F,
  CHAN_COLOR,
  STATUS_STYLE,
  orderChanGroup,
  channelLabel,
  statusGroup,
  statusLabel,
  parseBatchDate,
  weekdayLabel,
  planStatusBatch,
  buildManualStatusChange,
  type ChanGroup,
  type StatusGroup,
  type BatchCard,
} from "./OrdersPage.helpers";
import { StatusCell, BatchActionBar, FilterChip, SelectAllCheckbox } from "./OrdersPage.BatchActions";
import { RestoreButton, DuplicatePanel, FindDuplicatesButton, useVoidActions } from "./OrdersPage.DuplicatePanel";
import { EditModal, useEditModal } from "./OrdersPage.EditModal";

// ── 篩選 state ─────────────────────────────────────────────
type FilterState = {
  channel: ChanGroup;
  status: StatusGroup;
  batch: string;
  query: string;
};

// ── 主頁面 ────────────────────────────────────────────────
export function OrdersPage({ orders, menu, refreshOrders }: PageProps) {
  // Yen 2026-07-06：訂單總覽預設 filter 未付款 · 一開頁就看到卡在等付款的單
  const [filter, setFilter] = useState<FilterState>({
    channel: "全部", status: "未付款", batch: "全部", query: "",
  });
  // Yen 2026-07-04：訂單狀態預設鎖定 · 點鎖 icon 才能改
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());
  function toggleUnlock(id: string) {
    setUnlockedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function updateStatus(id: string, next: OrderStatusValue) {
    // Yen 2026-07-06：從 shipped 改回非 shipped（誤按修復）· 同時清 batchDate + reset assignment_source
    //   否則訂單會偷偷回到原本已排的日子上、不會出現在待排列表
    const before = orders.find((o) => o.id === id);
    const now = new Date().toISOString();
    const changes = before ? [...before.changes, buildManualStatusChange(before, next, now)] : undefined;
    if (before?.status === "shipped" && next !== "shipped") {
      await db.orders.update(id, { status: next, last_seen_at: now, batchDate: null, system_suggested_date: null, assignment_source: "pending", ...(changes ? { changes } : {}) });
    } else {
      await db.orders.update(id, { status: next, last_seen_at: now, ...(changes ? { changes } : {}) });
    }
    await refreshOrders();
    // 更完成後重新鎖上（防繼續手殘）
    setUnlockedIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
  }

  function toggleFilter<K extends keyof Omit<FilterState, "query">>(key: K, val: FilterState[K]) {
    setFilter((prev) => ({ ...prev, [key]: prev[key] === val ? "全部" : val }));
    setSelectedIds(new Set()); // #10：篩選一變、選取範圍的基準也變了，清掉避免選到看不見的列
  }

  // ── #10 批次改狀態 ──────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchStatus, setBatchStatus] = useState<OrderStatusValue>("shipped");
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // #8：作廢/復原/找重複/單筆編輯（抽到 sibling 檔維持 500 行以內）
  const { dupPanelOpen, setDupPanelOpen, restoreOrder, voidSelectedFromDuplicates } = useVoidActions(orders, refreshOrders, setMsg);
  const { editing, setEditing, save: saveEdit } = useEditModal(refreshOrders, setMsg);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBatchStatus() {
    const ids = [...selectedIds];
    const plan = planStatusBatch(orders, ids, batchStatus);
    if (!plan.ok) {
      // 不該發生（ids 全來自目前渲染的列），但真的發生時 loud 拒絕、不猜
      setMsg({ ok: false, text: `❌ 找不到 ${plan.missingIds.length} 筆訂單，已取消套用（請重新整理再試）` });
      return;
    }
    if (plan.changes.length >= 10) {
      const ok = window.confirm(`確定要把 ${plan.changes.length} 筆訂單改為「${statusLabel(batchStatus)}」？`);
      if (!ok) return;
    }
    setApplying(true);
    try {
      const now = new Date().toISOString();
      for (const c of plan.changes) {
        if (c.clearBatchDate) {
          await db.orders.update(c.id, {
            status: c.after,
            last_seen_at: now,
            batchDate: null,
            system_suggested_date: null,
            assignment_source: "pending",
          });
        } else {
          await db.orders.update(c.id, { status: c.after, last_seen_at: now });
        }
      }
      await refreshOrders();
      const clearedCount = plan.changes.filter((c) => c.clearBatchDate).length;
      setMsg({
        ok: true,
        text: `✓ ${plan.changes.length} 筆已改為 ${statusLabel(batchStatus)}${clearedCount > 0 ? `、其中 ${clearedCount} 筆已清出貨批次` : ""}`,
      });
      setSelectedIds(new Set());
    } finally {
      setApplying(false);
    }
  }

  const { channelCounts, statusCounts, batchCards, filteredOrders, totalRevenue, grandRevenue } =
    useMemo(() => {
      const channelCounts: Record<ChanGroup, number> = {
        全部: orders.length, 賣貨便: 0, 面交: 0, KOL: 0, 宅配: 0, 手打單: 0, 待分類: 0,
      };
      for (const o of orders) channelCounts[orderChanGroup(o)] += 1;

      const statusCounts: Record<StatusGroup, number> = {
        全部: orders.length, 未付款: 0, confirmed: 0, 待處理: 0, 已出貨: 0, 消失: 0, 作廢: 0,
      };
      for (const o of orders) statusCounts[statusGroup(o.status)] += 1;

      const batchMap = new Map<string, BatchCard>();
      for (const o of orders) {
        const bd = o.batchDate ?? "待排";
        if (!batchMap.has(bd)) {
          batchMap.set(bd, { date: bd, weekday: weekdayLabel(bd), orderCount: 0, labelCount: 0, revenue: 0 });
        }
        const card = batchMap.get(bd)!;
        card.orderCount += 1;
        card.labelCount += o.labelCount;
        card.revenue += o.revenue.grossTotal;
      }

      const batchCards: BatchCard[] = Array.from(batchMap.values()).sort((a, b) => {
        const da = parseBatchDate(a.date);
        const db = parseBatchDate(b.date);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return db.getTime() - da.getTime();
      });

      const q = filter.query.trim().toLowerCase();
      const filteredOrders = orders.filter((o) => {
        if (filter.channel !== "全部" && orderChanGroup(o) !== filter.channel) return false;
        if (filter.status !== "全部" && statusGroup(o.status) !== filter.status) return false;
        if (filter.batch !== "全部" && (o.batchDate ?? "待排") !== filter.batch) return false;
        if (q) {
          const idHit = o.id.toLowerCase().includes(q);
          const nameHit = (o.recipient.name ?? "").toLowerCase().includes(q);
          const handleHit = (o.recipient.igOrLine ?? "").toLowerCase().includes(q);
          const itemHit = o.items.some((it) => {
            const display = it.productSkuId
              ? getDisplayName(it.productSkuId, menu).toLowerCase()
              : it.rawName.toLowerCase();
            return display.includes(q);
          });
          if (!idHit && !nameHit && !handleHit && !itemHit) return false;
        }
        return true;
      });

      // 憲章 #2：金額全從 grossTotal
      const totalRevenue = filteredOrders.reduce((s, o) => s + o.revenue.grossTotal, 0);
      const grandRevenue = orders.reduce((s, o) => s + o.revenue.grossTotal, 0);

      return { channelCounts, statusCounts, batchCards, filteredOrders, totalRevenue, grandRevenue };
    }, [orders, menu, filter]);

  // 品項文字（憲章 #1：全經 menu.getDisplayName）
  function itemsText(o: Order): string {
    return o.items.map((it) => {
      const name = it.productSkuId
        ? getDisplayName(it.productSkuId, menu)
        : `❓ ${it.rawName.slice(0, 24)}`;
      return it.quantity > 1 ? `${name} ×${it.quantity}` : name;
    }).join("、");
  }

  const filterParts: string[] = [];
  if (filter.channel !== "全部") filterParts.push(filter.channel);
  if (filter.status !== "全部") filterParts.push(filter.status);
  if (filter.batch !== "全部") filterParts.push(filter.batch);
  if (filter.query.trim()) filterParts.push(`「${filter.query.trim()}」`);
  const hasFilter = filterParts.length > 0;

  return (
    <div className="h-full flex flex-col min-h-0" style={{ fontFamily: F.tc }}>
      {/* PAGE HEADER */}
      <PageHeader
        caption="ORDERS · 全通路訂單台帳"
        title="ORDER LEDGER"
        right={
          <div className="flex items-center" style={{ gap: 10 }}>
            <input
              type="text"
              value={filter.query}
              onChange={(e) => setFilter((prev) => ({ ...prev, query: e.target.value }))}
              placeholder="搜尋 訂單編號 / 收件人 / 品項…"
              style={{
                fontFamily: F.mono, fontSize: 12, color: "#E7E7EA",
                background: "#111114", border: "1px solid #3a3a40",
                padding: "9px 14px", width: 220, outline: "none", borderRadius: 0,
              }}
            />
            <FindDuplicatesButton onClick={() => setDupPanelOpen(true)} />
            <ExportBtn
              label="匯出台帳"
              filename="orders_overview"
              onExport={() => writeOverviewExcel(orders, menu)}
            />
          </div>
        }
      />
      {dupPanelOpen && <DuplicatePanel orders={orders} onVoidSelected={(ids) => void voidSelectedFromDuplicates(ids)} onClose={() => setDupPanelOpen(false)} />}
      {editing && <EditModal order={editing} onSave={(edits) => void saveEdit(editing, edits)} onClose={() => setEditing(null)} />}

      {/* 活躍計數 */}
      <div style={{ padding: "0 24px 8px" }}>
        <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 20, color: "#8A8A93" }}>
          {orders.length} 筆活躍
        </span>
      </div>
      {/* FILTER BARS */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 24px 10px" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", letterSpacing: ".14em", width: 44 }}>通路</span>
          {(["全部", "賣貨便", "面交", "KOL", "宅配", "手打單", "待分類"] as ChanGroup[]).map((g) => (
            <FilterChip
              key={g} label={g} count={channelCounts[g]}
              active={filter.channel === g} activeColor={CHAN_COLOR[g]}
              onClick={() => toggleFilter("channel", g)}
            />
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", letterSpacing: ".14em", width: 44 }}>狀態</span>
          {(["全部", "未付款", "confirmed", "待處理", "已出貨", "消失", "作廢"] as StatusGroup[]).map((g) => (
            <FilterChip
              key={g} label={g} count={statusCounts[g]}
              active={filter.status === g} activeColor={STATUS_STYLE[g].color}
              onClick={() => toggleFilter("status", g)}
            />
          ))}
        </div>
      </div>

      {/* MAIN: TABLE + RIGHT RAIL */}
      <div style={{ display: "grid", gridTemplateColumns: "2.7fr 1fr", gap: 12, padding: "4px 24px 16px", flex: 1, minHeight: 0 }}>

        {/* LEFT: TABLE */}
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ background: "#0F0F12", border: "1px solid #26262C", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {/* 台帳標題列（移入板塊、與右欄板塊上緣對齊） */}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "13px 16px 11px", flexShrink: 0 }}>
              <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: "#F5F4EF" }}>
                訂單台帳{" "}
                <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 11, color: "#6C6C74" }}>
                  顯示 {filteredOrders.length} 筆代表訂單
                </span>
              </span>
              {hasFilter && (
                <button
                  type="button"
                  onClick={() => { setFilter({ channel: "全部", status: "全部", batch: "全部", query: "" }); setSelectedIds(new Set()); }}
                  style={{ fontFamily: F.mono, fontSize: 11, color: "#E5622A", cursor: "pointer", background: "none", border: "none", padding: 0 }}
                >
                  ✕ 清除篩選 · {filterParts.join(" · ")}
                </button>
              )}
            </div>

            {/* #10 批次改狀態 · 浮動 action bar（有選取才出現）*/}
            <BatchActionBar
              selectedCount={selectedIds.size}
              pendingStatus={batchStatus}
              onPendingStatusChange={setBatchStatus}
              onApply={() => void applyBatchStatus()}
              onClear={() => setSelectedIds(new Set())}
              applying={applying}
            />
            {msg && (
              <div style={{ fontFamily: F.mono, fontSize: 11, color: msg.ok ? "#43B23C" : "#E5352B", padding: "6px 16px", flexShrink: 0 }}>
                {msg.text}
              </div>
            )}

            {/* 表頭 */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "28px 1.5fr 0.8fr 1fr 2fr 0.7fr 0.9fr 0.5fr 0.9fr",
              gap: 8, padding: "11px 16px", background: "#141417",
              borderBottom: "1px solid #26262C", flexShrink: 0,
              fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".08em",
              alignItems: "center",
            }}>
              <SelectAllCheckbox
                ids={filteredOrders.map((o) => o.id)}
                selectedIds={selectedIds}
                onChange={setSelectedIds}
              />
              <span>訂單編號</span><span>通路</span><span>收件</span><span>品項</span>
              <span>出貨日</span>
              <span style={{ textAlign: "right" }}>金額</span>
              <span style={{ textAlign: "center" }}>標</span>
              <span style={{ textAlign: "right" }}>狀態</span>
            </div>

            {/* 捲動列區 */}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {/* 空狀態 */}
            {filteredOrders.length === 0 && (
              <div style={{ padding: "48px 24px", textAlign: "center" }}>
                <div style={{ fontFamily: F.mono, fontSize: 13, color: "#6C6C74", letterSpacing: ".1em" }}>
                  {orders.length === 0 ? "尚無任何訂單" : "無符合的訂單"}
                </div>
                {orders.length === 0 ? (
                  <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: "#4a4a52", marginTop: 10 }}>
                    上傳賣貨便 Excel 後訂單將顯示於此
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setFilter({ channel: "全部", status: "全部", batch: "全部", query: "" }); setSelectedIds(new Set()); }}
                    style={{ fontFamily: F.mono, fontSize: 11, color: "#E5622A", cursor: "pointer", background: "none", border: "none", marginTop: 10 }}
                  >
                    ✕ 清除所有篩選
                  </button>
                )}
              </div>
            )}

            {/* 訂單列 */}
            {filteredOrders.map((o, i) => {
              const sg = statusGroup(o.status);
              const ss = STATUS_STYLE[sg];
              const chanColor = CHAN_COLOR[orderChanGroup(o)];
              const amountStr = o.revenue.grossTotal > 0 ? `$${o.revenue.grossTotal.toLocaleString()}` : "—";
              return (
                <div
                  key={o.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "28px 1.5fr 0.8fr 1fr 2fr 0.7fr 0.9fr 0.5fr 0.9fr",
                    gap: 8, padding: "12px 16px", alignItems: "center",
                    borderBottom: i < filteredOrders.length - 1 ? "1px solid #1c1c20" : "none",
                    background: selectedIds.has(o.id) ? "#1c1600" : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(o.id)}
                    onChange={() => toggleSelect(o.id)}
                    style={{ cursor: "pointer" }}
                  />
                  <span style={{ fontFamily: F.mono, fontSize: 11, color: "#C9C9CF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {o.id}
                  </span>
                  <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 11, color: chanColor }}>
                    {channelLabel(o.channel)}
                  </span>
                  <span style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 11, color: "#9A9AA2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {o.recipient.name ?? o.recipient.igOrLine ?? "—"}
                  </span>
                  <span style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 11, color: "#C9C9CF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {itemsText(o)}
                  </span>
                  <span style={{ fontFamily: F.mono, fontSize: 11, color: "#8A8A93" }}>
                    {o.batchDate ?? "待排"}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                    {o.payment_method === "取貨付款" && (
                      <span
                        title="貨到付款 · 金流尚未收（除非 c5 已 flip 成付款完成）"
                        style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 9, color: "#E5622A", border: "1px solid #E5622A", padding: "1px 4px", whiteSpace: "nowrap" }}
                      >
                        💰 貨到付款
                      </span>
                    )}
                    <span style={{ fontFamily: F.mono, fontSize: 11, color: "#E7E7EA", textAlign: "right" }}>
                      {amountStr}
                    </span>
                  </span>
                  <span style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74", textAlign: "center" }}>
                    {o.labelCount > 0 ? String(o.labelCount) : "—"}
                  </span>
                  <span className="flex items-center" style={{ gap: 6, justifyContent: "flex-end" }}>
                    {o.status === "voided" && <RestoreButton onRestore={() => void restoreOrder(o.id)} />}
                    {unlockedIds.has(o.id) && o.status !== "voided" && (
                      <button type="button" onClick={() => setEditing(o)} title="編輯出貨批次/收件人/數量/金額" style={{ fontFamily: F.mono, fontSize: 10, color: "#2AC7E8", background: "transparent", border: "1px solid #2AC7E8", padding: "2px 6px", cursor: "pointer" }}>✎</button>
                    )}
                    <StatusCell order={o} ss={ss} unlocked={unlockedIds.has(o.id)} onToggleLock={() => toggleUnlock(o.id)} onChange={(next) => void updateStatus(o.id, next)} />
                  </span>
                </div>
              );
            })}
            </div>
          </div>
        </div>

        {/* RIGHT RAIL */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, minHeight: 0, overflowY: "auto" }}>

          {/* 出貨總覽：每批一張 */}
          <div style={{ background: "#0F0F12", border: "1px solid #26262C", padding: 16 }}>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: "#F5F4EF", marginBottom: 4 }}>出貨總覽</div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", marginBottom: 12 }}>每批次一張 · 點選過濾台帳</div>

            {batchCards.length === 0 ? (
              <div style={{ fontFamily: F.mono, fontSize: 12, color: "#4a4a52", padding: "16px 0", textAlign: "center" }}>
                尚無批次資料
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {batchCards.map((bc) => {
                  const active = filter.batch === bc.date;
                  return (
                    <button
                      key={bc.date}
                      type="button"
                      onClick={() => toggleFilter("batch", bc.date)}
                      style={{
                        background: active ? "#1c1600" : "#111114",
                        border: `1px solid ${active ? "var(--acc,#F5D400)" : "#26262C"}`,
                        borderLeft: `3px solid ${active ? "var(--acc,#F5D400)" : "#3a3a40"}`,
                        padding: "11px 13px", cursor: "pointer", textAlign: "left",
                        borderRadius: 0, width: "100%",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontFamily: F.anton, fontSize: 17, color: active ? "var(--acc,#F5D400)" : "#E7E7EA" }}>
                          {bc.date}
                        </span>
                        {bc.weekday !== "—" && (
                          <span style={{ fontFamily: F.mono, fontSize: 10, color: "#8A8A93" }}>（{bc.weekday}）</span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 12, marginTop: 6, fontFamily: F.mono, fontSize: 11, color: "#9A9AA2" }}>
                        <span>{bc.orderCount} 單</span>
                        <span>{bc.labelCount} 標</span>
                        <span style={{ color: "#E7E7EA" }}>
                          {bc.revenue > 0 ? `NT$${bc.revenue.toLocaleString()}` : "—"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 金額對帳 — 憲章 #2 */}
          <div style={{ background: "#0F0F12", border: "1px solid #26262C", borderLeft: "3px solid #43B23C", padding: "14px 16px" }}>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#43B23C" }}>金額對帳 · 憲章 #2</div>
            <div style={{ fontFamily: F.mono, fontSize: 11, color: "#8A8A93", marginTop: 5 }}>Σ grossTotal（篩選後）</div>
            <div style={{ fontFamily: F.anton, fontSize: 26, color: "#F5F4EF", marginTop: 4, lineHeight: 1.1 }}>
              NT${totalRevenue.toLocaleString()}
            </div>
            {hasFilter && (
              <div style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", marginTop: 6 }}>
                全部 Σ：NT${grandRevenue.toLocaleString()}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
