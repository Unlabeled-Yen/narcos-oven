/**
 * 儀表板：跨批統計 + TOP 榜 + 客戶回頭率
 * 用 SVG 手繪、不依賴 chart lib
 */
import { useMemo } from "react";
import type { Order } from "../domain/models";

export function DashboardPanel({ orders }: { orders: Order[] }) {
  const eligible = useMemo(
    () => orders.filter((o) => o.status === "confirmed" || o.status === "shipped" || o.status === "kol_shipped"),
    [orders]
  );

  const monthTrend = useMemo(() => computeMonthTrend(eligible), [eligible]);
  const topKols = useMemo(() => computeTopKols(eligible), [eligible]);
  const topProducts = useMemo(() => computeTopProducts(eligible), [eligible]);
  const channelShare = useMemo(() => computeChannelShare(eligible), [eligible]);
  const repeatCustomers = useMemo(() => computeRepeatCustomers(eligible), [eligible]);

  if (eligible.length === 0) {
    return (
      <section className="mb-6 p-4 bg-gray-50 rounded text-sm text-gray-500">
        📊 儀表板暫無資料（需要 confirmed 訂單）
      </section>
    );
  }

  return (
    <section className="mb-6">
      <h2 className="text-xl font-bold mb-3">📊 儀表板</h2>

      {/* 月營收趨勢 */}
      <div className="mb-4 bg-white border rounded p-3">
        <h3 className="text-sm font-bold mb-2">📈 月營收趨勢</h3>
        {monthTrend.length > 0 ? (
          <MonthTrendChart data={monthTrend} />
        ) : (
          <p className="text-xs text-gray-500">尚無跨月資料</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {/* TOP KOL */}
        <div className="bg-white border rounded p-3">
          <h3 className="text-sm font-bold mb-2">⭐ TOP 5 KOL（依合作次數）</h3>
          {topKols.length > 0 ? (
            <RankingList items={topKols} unit="次" />
          ) : (
            <p className="text-xs text-gray-500">尚無 KOL 資料</p>
          )}
        </div>

        {/* TOP 品項 */}
        <div className="bg-white border rounded p-3">
          <h3 className="text-sm font-bold mb-2">🏆 TOP 10 品項</h3>
          <RankingList items={topProducts} unit="份" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 通路占比 */}
        <div className="bg-white border rounded p-3">
          <h3 className="text-sm font-bold mb-2">🥧 通路訂單占比</h3>
          <ChannelBarChart data={channelShare} />
        </div>

        {/* 客戶回頭率 */}
        <div className="bg-white border rounded p-3">
          <h3 className="text-sm font-bold mb-2">🔁 客戶回頭率</h3>
          <RepeatCustomerStats data={repeatCustomers} />
        </div>
      </div>
    </section>
  );
}

// ---- 計算 helper ----

function computeMonthTrend(orders: Order[]) {
  const byMonth = new Map<string, { orders: number; revenue: number }>();
  for (const o of orders) {
    if (!o.batchDate) continue;
    const month = o.batchDate.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { orders: 0, revenue: 0 });
    const m = byMonth.get(month)!;
    m.orders++;
    m.revenue += o.revenue.grossTotal;
  }
  return [...byMonth.entries()]
    .sort()
    .map(([month, m]) => ({ month, ...m }));
}

function computeTopKols(orders: Order[]): { label: string; value: number }[] {
  const kolOrders = orders.filter((o) => o.channel === "KOL");
  const byIg = new Map<string, number>();
  for (const o of kolOrders) {
    const key = o.recipient.igOrLine ?? o.recipient.name ?? "unknown";
    byIg.set(key, (byIg.get(key) ?? 0) + 1);
  }
  return [...byIg.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value]) => ({ label, value }));
}

function computeTopProducts(orders: Order[]): { label: string; value: number }[] {
  const byAtom = new Map<string, number>();
  for (const o of orders) {
    for (const it of o.items) {
      for (const a of it.atoms) {
        byAtom.set(a.atomId, (byAtom.get(a.atomId) ?? 0) + a.count);
      }
    }
  }
  return [...byAtom.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, value]) => ({ label, value }));
}

function computeChannelShare(orders: Order[]) {
  const byCh = new Map<string, number>();
  for (const o of orders) {
    const norm = o.channel === "賣貨便"
      ? "賣貨便"
      : o.channel.startsWith("面交")
      ? "面交"
      : o.channel === "宅配"
      ? "宅配"
      : o.channel === "KOL"
      ? "KOL"
      : "其他";
    byCh.set(norm, (byCh.get(norm) ?? 0) + 1);
  }
  const total = orders.length;
  return [...byCh.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, pct: (value / total) * 100 }));
}

function computeRepeatCustomers(orders: Order[]) {
  const byCustomer = new Map<string, number>();
  for (const o of orders) {
    const key = o.recipient.igOrLine ?? o.recipient.name ?? null;
    if (!key) continue;
    byCustomer.set(key, (byCustomer.get(key) ?? 0) + 1);
  }
  const total = byCustomer.size;
  const repeat = [...byCustomer.values()].filter((n) => n > 1).length;
  const topRepeats = [...byCustomer.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  return { totalUnique: total, repeatCount: repeat, topRepeats };
}

// ---- SVG charts ----

function MonthTrendChart({ data }: { data: { month: string; orders: number; revenue: number }[] }) {
  const width = 500;
  const height = 160;
  const padL = 50, padR = 20, padT = 10, padB = 30;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const maxRev = Math.max(...data.map((d) => d.revenue), 1);
  const step = data.length > 1 ? chartW / (data.length - 1) : 0;

  const points = data.map((d, i) => ({
    x: padL + i * step,
    y: padT + chartH - (d.revenue / maxRev) * chartH,
    ...d,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      <line x1={padL} y1={padT + chartH} x2={width - padR} y2={padT + chartH} stroke="#ccc" />
      <line x1={padL} y1={padT} x2={padL} y2={padT + chartH} stroke="#ccc" />
      <text x={padL - 10} y={padT + 5} textAnchor="end" fontSize="10" fill="#666">
        ${maxRev.toFixed(0)}
      </text>
      <text x={padL - 10} y={padT + chartH + 5} textAnchor="end" fontSize="10" fill="#666">
        0
      </text>
      <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="2" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4" fill="#3b82f6" />
          <text x={p.x} y={height - 15} textAnchor="middle" fontSize="10" fill="#333">
            {p.month}
          </text>
          <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="9" fill="#3b82f6">
            ${p.revenue.toFixed(0)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function RankingList({ items, unit }: { items: { label: string; value: number }[]; unit: string }) {
  if (items.length === 0) return <p className="text-xs text-gray-500">尚無資料</p>;
  const max = Math.max(...items.map((i) => i.value));
  return (
    <div className="space-y-1 text-xs">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-6 text-gray-400">#{i + 1}</span>
          <div className="flex-1">
            <div className="text-gray-700 mb-0.5 truncate">{it.label}</div>
            <div className="bg-blue-100 h-4 rounded relative">
              <div
                className="bg-blue-500 h-4 rounded"
                style={{ width: `${(it.value / max) * 100}%` }}
              />
              <span className="absolute inset-0 px-1 text-xs text-white font-semibold flex items-center">
                {it.value} {unit}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ChannelBarChart({ data }: { data: { label: string; value: number; pct: number }[] }) {
  if (data.length === 0) return <p className="text-xs text-gray-500">尚無資料</p>;
  const colors: Record<string, string> = {
    賣貨便: "bg-blue-500",
    面交: "bg-emerald-500",
    宅配: "bg-purple-500",
    KOL: "bg-amber-500",
    其他: "bg-gray-500",
  };
  return (
    <div className="space-y-2 text-xs">
      <div className="flex h-6 rounded overflow-hidden">
        {data.map((d) => (
          <div
            key={d.label}
            className={colors[d.label] ?? "bg-gray-500"}
            style={{ width: `${d.pct}%` }}
            title={`${d.label} ${d.value} (${d.pct.toFixed(1)}%)`}
          />
        ))}
      </div>
      <div className="space-y-0.5">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded ${colors[d.label] ?? "bg-gray-500"}`} />
            <span className="flex-1">{d.label}</span>
            <span className="text-gray-500">
              {d.value} ({d.pct.toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RepeatCustomerStats({
  data,
}: {
  data: { totalUnique: number; repeatCount: number; topRepeats: [string, number][] };
}) {
  const pct = data.totalUnique > 0 ? (data.repeatCount / data.totalUnique) * 100 : 0;
  return (
    <div className="space-y-2 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-gray-50 rounded p-2">
          <div className="text-gray-500">獨立客戶</div>
          <div className="text-lg font-bold">{data.totalUnique}</div>
        </div>
        <div className="bg-green-50 rounded p-2">
          <div className="text-gray-500">回頭客</div>
          <div className="text-lg font-bold">
            {data.repeatCount} <span className="text-sm text-gray-500">({pct.toFixed(1)}%)</span>
          </div>
        </div>
      </div>
      {data.topRepeats.length > 0 && (
        <div>
          <div className="text-gray-500 mb-1">TOP 5 回頭客：</div>
          <div className="space-y-0.5">
            {data.topRepeats.map(([name, count]) => (
              <div key={name} className="flex justify-between">
                <span className="truncate">{name}</span>
                <span className="text-gray-500">{count} 單</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
