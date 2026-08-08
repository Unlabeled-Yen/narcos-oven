/**
 * ShopPayoutPage · 駐店對帳報表 · Yen 2026-07-06 slice 2D
 *
 * 每筆駐店訂單一列 · 顯示日期 / 店家 / 品項 / 總金額 / 運費 / 實收 / 結清狀態
 * 期間 + 店家 filter · 底部 summary（訂單數 / 總金額 / 運費 / 實收 / 未結清 count + 金額）
 * 每筆結清狀態可就地 toggle · 直接 upsert 回 DB
 */
import { useEffect, useMemo, useState } from "react";
import type { PageProps } from "./types";
import type { Order, ShopPartner } from "../../domain/models";
import { listShops } from "../../db/shops";
import { upsertOrder } from "../../db/orders";
import { getDisplayName } from "../../domain/menu";

const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
} as const;

const C = {
  bg: "#0A0A0C",
  panel: "#0F0F12",
  card: "#141417",
  line: "#26262C",
  line2: "#1F1F24",
  ink: "#F5F4EF",
  mut: "#C9C9CF",
  mut2: "#8A8A93",
  mut3: "#6C6C74",
  acc: "var(--acc,#F5D400)",
  green: "#43B23C",
  orange: "#E5622A",
  red: "#E5352B",
} as const;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthAgoISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type PeriodKey = "this-month" | "last-30d" | "all" | "custom";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "this-month", label: "本月" },
  { key: "last-30d", label: "近 30 天" },
  { key: "all", label: "全部" },
  { key: "custom", label: "自訂" },
];

export function ShopPayoutPage({ orders, menu, refreshOrders }: PageProps) {
  const [shops, setShops] = useState<ShopPartner[]>([]);
  const [shopFilter, setShopFilter] = useState<string>("all");
  const [period, setPeriod] = useState<PeriodKey>("this-month");
  const [customFrom, setCustomFrom] = useState(monthAgoISO());
  const [customTo, setCustomTo] = useState(todayISO());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { void (async () => setShops(await listShops(true)))(); }, [orders]);

  const shopMap = useMemo(() => new Map(shops.map((s) => [s.id, s])), [shops]);

  const { fromISO, toISO } = useMemo(() => {
    if (period === "all") return { fromISO: null as string | null, toISO: null as string | null };
    if (period === "custom") return { fromISO: customFrom || null, toISO: customTo || null };
    if (period === "this-month") {
      const d = new Date();
      const y = d.getFullYear(), m = d.getMonth();
      const first = new Date(y, m, 1);
      const last = new Date(y, m + 1, 0);
      const toIso = (dd: Date) => `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}-${String(dd.getDate()).padStart(2, "0")}`;
      return { fromISO: toIso(first), toISO: toIso(last) };
    }
    // last-30d
    return { fromISO: monthAgoISO(), toISO: todayISO() };
  }, [period, customFrom, customTo]);

  const shopOrders = useMemo(() => {
    // #6 2026-08-06：期間篩選一律用「有效出貨日」，駐店通路的有效出貨日
    // 就是 batchDate 本身（到貨日＝出貨日，不用再退回 order_date）。
    // 沒有 batchDate 的駐店單視為「未排」、不落入任何期間——跟工單/出貨
    // 明細頁一致，不再用 order_date 頂替造成兩頁月報表對不上。
    return orders
      .filter((o) => o.channel === "駐店")
      .filter((o) => (shopFilter === "all" ? true : o.shop_partner === shopFilter))
      .filter((o) => {
        if (!fromISO && !toISO) return true;
        const d = o.batchDate;
        if (!d) return false;
        if (fromISO && d < fromISO) return false;
        if (toISO && d > toISO) return false;
        return true;
      })
      .sort((a, b) => {
        const da = a.batchDate ?? "";
        const db = b.batchDate ?? "";
        return db.localeCompare(da);
      });
  }, [orders, shopFilter, fromISO, toISO]);

  // 每家店的小計
  const byShop = useMemo(() => {
    const m = new Map<string, {
      shopId: string; shopName: string;
      count: number; gross: number; freight: number; received: number;
      unsettledCount: number; unsettledAmount: number;
    }>();
    for (const o of shopOrders) {
      const sid = o.shop_partner ?? "unknown";
      const name = shopMap.get(sid)?.display_name ?? sid;
      const gross = o.revenue.grossTotal;
      const freight = o.freight_cost;
      const received = gross - freight;
      const entry = m.get(sid) ?? { shopId: sid, shopName: name, count: 0, gross: 0, freight: 0, received: 0, unsettledCount: 0, unsettledAmount: 0 };
      entry.count += 1;
      entry.gross += gross;
      entry.freight += freight;
      entry.received += received;
      if (!o.settled) { entry.unsettledCount += 1; entry.unsettledAmount += received; }
      m.set(sid, entry);
    }
    return Array.from(m.values()).sort((a, b) => b.received - a.received);
  }, [shopOrders, shopMap]);

  const total = useMemo(() => byShop.reduce((s, r) => ({
    count: s.count + r.count,
    gross: s.gross + r.gross,
    freight: s.freight + r.freight,
    received: s.received + r.received,
    unsettledCount: s.unsettledCount + r.unsettledCount,
    unsettledAmount: s.unsettledAmount + r.unsettledAmount,
  }), { count: 0, gross: 0, freight: 0, received: 0, unsettledCount: 0, unsettledAmount: 0 }), [byShop]);

  async function toggleSettled(order: Order) {
    if (busy) return;
    setBusy(order.id);
    try {
      await upsertOrder({ ...order, settled: !order.settled, last_seen_at: new Date().toISOString() });
      await refreshOrders();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="h-full flex flex-col min-h-0" style={{ overflowY: "auto", background: C.bg }}>
      <div className="px-6 py-4" style={{ maxWidth: 1400, width: "100%", margin: "0 auto" }}>

        {/* Header */}
        <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, letterSpacing: ".16em" }}>SHOP · PAYOUT</div>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 20, color: C.ink }}>駐店對帳</div>
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3 }}>
            實收 = 總金額 − 運費 · 點結清欄 toggle 就地更新
          </div>
        </div>

        {/* Filter bar */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {PERIODS.map((p) => (
              <button key={p.key} type="button" onClick={() => setPeriod(p.key)}
                style={{
                  fontFamily: F.mono, fontSize: 11,
                  color: period === p.key ? "#111" : C.mut,
                  background: period === p.key ? C.acc : "transparent",
                  border: `1px solid ${period === p.key ? C.acc : C.line}`,
                  padding: "5px 12px", cursor: "pointer", fontWeight: period === p.key ? 900 : 400,
                }}
              >{p.label}</button>
            ))}
          </div>
          {period === "custom" && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={inputStyle} />
              <span style={{ color: C.mut3, fontFamily: F.mono }}>→</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={inputStyle} />
            </>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3 }}>店家</span>
            <select value={shopFilter} onChange={(e) => setShopFilter(e.target.value)} style={{ ...inputStyle, width: 200 }}>
              <option value="all">全部</option>
              {shops.map((s) => (<option key={s.id} value={s.id}>{s.display_name}</option>))}
            </select>
          </div>
        </div>

        {/* Summary */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 16 }}>
          <SummaryCard label="訂單數" value={String(total.count)} color={C.ink} />
          <SummaryCard label="總金額" value={`$${total.gross}`} color={C.acc} />
          <SummaryCard label="運費支出" value={`$${total.freight}`} color={C.mut} />
          <SummaryCard label="實收" value={`$${total.received}`} color={C.green} />
          <SummaryCard label="未結清 · 金額" value={`${total.unsettledCount} 筆 · $${total.unsettledAmount}`}
            color={total.unsettledCount > 0 ? C.red : C.mut3} />
        </div>

        {/* By-shop 小計 */}
        {byShop.length > 0 && (
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: "10px 14px", marginBottom: 16 }}>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, letterSpacing: ".12em", marginBottom: 8 }}>
              分店家統計
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 60px 100px 100px 100px 120px", gap: 8, alignItems: "center", padding: "4px 0", fontFamily: F.mono, fontSize: 10, color: C.mut3, borderBottom: `1px solid ${C.line2}` }}>
              <div>店家</div>
              <div style={{ textAlign: "right" }}>單數</div>
              <div style={{ textAlign: "right" }}>總金額</div>
              <div style={{ textAlign: "right" }}>運費</div>
              <div style={{ textAlign: "right" }}>實收</div>
              <div style={{ textAlign: "right" }}>未結清</div>
            </div>
            {byShop.map((row) => (
              <div key={row.shopId} style={{ display: "grid", gridTemplateColumns: "2fr 60px 100px 100px 100px 120px", gap: 8, alignItems: "center", padding: "6px 0", fontFamily: F.mono, fontSize: 11, color: C.ink, borderBottom: `1px solid ${C.line2}` }}>
                <div style={{ fontFamily: F.tc }}>{row.shopName}</div>
                <div style={{ textAlign: "right" }}>{row.count}</div>
                <div style={{ textAlign: "right" }}>${row.gross}</div>
                <div style={{ textAlign: "right", color: C.mut2 }}>${row.freight}</div>
                <div style={{ textAlign: "right", color: C.green }}>${row.received}</div>
                <div style={{ textAlign: "right", color: row.unsettledCount > 0 ? C.red : C.mut3 }}>
                  {row.unsettledCount > 0 ? `${row.unsettledCount} · $${row.unsettledAmount}` : "—"}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Order list */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: "10px 14px" }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, letterSpacing: ".12em", marginBottom: 8 }}>
            訂單明細 · 共 {shopOrders.length} 筆
          </div>

          {shopOrders.length === 0 ? (
            <div style={{ fontFamily: F.mono, fontSize: 12, color: C.mut3, padding: 20, textAlign: "center" }}>
              此範圍內無駐店訂單
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "90px 1.4fr 2fr 80px 80px 80px 90px 30px", gap: 8, padding: "6px 0", fontFamily: F.mono, fontSize: 9, color: C.mut3, borderBottom: `1px solid ${C.line2}`, letterSpacing: ".05em" }}>
                <div>到貨日</div>
                <div>店家</div>
                <div>品項</div>
                <div style={{ textAlign: "right" }}>總金額</div>
                <div style={{ textAlign: "right" }}>運費</div>
                <div style={{ textAlign: "right" }}>實收</div>
                <div style={{ textAlign: "center" }}>結清</div>
                <div></div>
              </div>
              {shopOrders.map((o) => {
                const gross = o.revenue.grossTotal;
                const received = gross - o.freight_cost;
                const shopName = shopMap.get(o.shop_partner ?? "")?.display_name ?? o.shop_partner ?? "—";
                const itemSummary = o.items.map((it) => {
                  const name = it.productSkuId ? getDisplayName(it.productSkuId, menu) : it.rawName;
                  return `${name} ×${it.quantity}`;
                }).join(" · ");
                return (
                  <div key={o.id} style={{ display: "grid", gridTemplateColumns: "90px 1.4fr 2fr 80px 80px 80px 90px 30px", gap: 8, padding: "8px 0", alignItems: "center", fontFamily: F.mono, fontSize: 11, color: C.ink, borderBottom: `1px solid ${C.line2}` }}>
                    <div>{o.batchDate ?? o.order_date ?? "—"}</div>
                    <div style={{ fontFamily: F.tc, fontSize: 12 }}>{shopName}</div>
                    <div style={{ fontFamily: F.tc, fontSize: 11, color: C.mut, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={itemSummary}>
                      {itemSummary}
                    </div>
                    <div style={{ textAlign: "right", fontFamily: F.anton, fontSize: 13 }}>${gross}</div>
                    <div style={{ textAlign: "right", color: C.mut2 }}>${o.freight_cost}</div>
                    <div style={{ textAlign: "right", color: C.green, fontFamily: F.anton, fontSize: 13 }}>${received}</div>
                    <div style={{ textAlign: "center" }}>
                      <button type="button" onClick={() => void toggleSettled(o)} disabled={busy === o.id}
                        style={{
                          fontFamily: F.mono, fontSize: 10,
                          color: o.settled ? "#111" : C.red,
                          background: o.settled ? C.green : "transparent",
                          border: `1px solid ${o.settled ? C.green : C.red}`,
                          padding: "3px 10px", cursor: busy === o.id ? "wait" : "pointer",
                          fontWeight: 900,
                        }}
                      >
                        {o.settled ? "已結" : "未結"}
                      </button>
                    </div>
                    <div style={{ fontFamily: F.mono, fontSize: 8, color: C.mut3 }} title={o.id}>#</div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#0B0B0E", border: `1px solid ${C.line}`, color: C.ink,
  padding: "5px 10px", fontFamily: F.mono, fontSize: 11,
};

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, padding: "10px 14px" }}>
      <div style={{ fontFamily: F.mono, fontSize: 9, color: C.mut3, letterSpacing: ".14em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: F.anton, fontSize: 20, color, lineHeight: 1 }}>{value}</div>
    </div>
  );
}
