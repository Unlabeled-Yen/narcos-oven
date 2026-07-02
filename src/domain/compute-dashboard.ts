/**
 * 儀表板純計算函式（domain 層，無副作用）
 * 從 DashboardPanel.tsx 提升 + 補 KPI 需要的計算。
 *
 * 憲章：
 *   #1 禁 hardcode 品項字串（所有品項名須由 menu 查出）
 *   #2 主軌 0 LLM，數字全由 orders 算出
 */
import type { Order, ChannelId } from "./models";

// ─── 符合「可出爐」門檻的訂單定義 ──────────────────────────────────────────
export const ELIGIBLE_STATUSES = new Set([
  "confirmed",
  "shipped",
  "kol_shipped",
] as const);

export type EligibleStatus = "confirmed" | "shipped" | "kol_shipped";

function isEligible(o: Order): boolean {
  return ELIGIBLE_STATUSES.has(o.status as EligibleStatus);
}

// ─── KPI：各狀態計數 ─────────────────────────────────────────────────────────

export type KpiCounts = {
  /** confirmed 狀態數 */
  confirmed: number;
  /** pending_* 狀態之和（不含 disappeared / canceled） */
  pending: number;
  /** disappeared_pending_resolution 計數 */
  disappeared: number;
  /** 全部非 canceled 的活躍訂單 */
  active: number;
  /** 本月 GMV（confirmed / shipped / kol_shipped，grossTotal 加總） */
  currentMonthGmv: number;
};

export function computeKpiCounts(orders: Order[]): KpiCounts {
  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  let confirmed = 0;
  let pending = 0;
  let disappeared = 0;
  let active = 0;
  let currentMonthGmv = 0;

  for (const o of orders) {
    if (o.status === "canceled") continue;
    active++;

    if (o.status === "confirmed") {
      confirmed++;
    } else if (o.status === "disappeared_pending_resolution") {
      disappeared++;
    } else if (
      o.status.startsWith("pending_") ||
      o.status === "change_pending_resolution"
    ) {
      pending++;
    }

    if (isEligible(o) && o.batchDate && o.batchDate.startsWith(currentYM)) {
      currentMonthGmv += o.revenue.grossTotal;
    }
  }

  return { confirmed, pending, disappeared, active, currentMonthGmv };
}

// ─── KPI：本批出爐（次一個未來 batchDate 批次中肉桂捲 atom 總數）───────────

export type BatchKpi = {
  /** 出爐日（YYYY-MM-DD），取不到時為 null */
  batchDate: string | null;
  /** 肉桂捲（cinnamonRoll atom）顆數 */
  cinnamonCount: number;
  /** 其他 atom 摘要：{ atomId -> 顆數 } */
  otherAtoms: Record<string, number>;
};

/**
 * 找 confirmed 訂單中「最近一個 >= 今天的 batchDate」那批，
 * 回傳肉桂捲類 atom 總量。
 *
 * 「肉桂捲」主打 atom 判斷：atomId === "肉桂捲"（menu.yaml 用中文 key）。
 * 取不到未來批次時 fallback 為最近一批（最大 batchDate）。
 */
export function computeBatchKpi(orders: Order[]): BatchKpi {
  const todayStr = new Date().toISOString().slice(0, 10);

  const confirmedWithDate = orders.filter(
    (o) => o.status === "confirmed" && o.batchDate != null
  );

  if (confirmedWithDate.length === 0) {
    return { batchDate: null, cinnamonCount: 0, otherAtoms: {} };
  }

  // 找所有不重複 batchDate，優先選 >= 今天最小值，否則取最大值
  const allDates = [
    ...new Set(confirmedWithDate.map((o) => o.batchDate as string)),
  ].sort();

  const futureDates = allDates.filter((d) => d >= todayStr);
  const targetDate = futureDates.length > 0 ? futureDates[0]! : allDates[allDates.length - 1]!;

  const batchOrders = confirmedWithDate.filter((o) => o.batchDate === targetDate);

  let cinnamonCount = 0;
  const otherAtoms: Record<string, number> = {};

  for (const o of batchOrders) {
    for (const item of o.items) {
      for (const a of item.atoms) {
        // menu.yaml 的 atom key 是中文；「肉桂捲」為主打 atom，
        // 蘋果肉桂捲 / 焦糖蘋果肉桂麵包 屬其他 atom（落入 otherAtoms 摘要）。
        if (a.atomId === "肉桂捲") {
          cinnamonCount += a.count * item.quantity;
        } else {
          otherAtoms[a.atomId] = (otherAtoms[a.atomId] ?? 0) + a.count * item.quantity;
        }
      }
    }
  }

  return { batchDate: targetDate, cinnamonCount, otherAtoms };
}

// ─── 月營收趨勢 ──────────────────────────────────────────────────────────────

export type MonthTrendEntry = {
  month: string;   // "YYYY-MM"
  orders: number;
  revenue: number;
};

export function computeMonthTrend(orders: Order[]): MonthTrendEntry[] {
  const eligible = orders.filter(isEligible);
  const byMonth = new Map<string, { orders: number; revenue: number }>();
  for (const o of eligible) {
    if (!o.batchDate) continue;
    const month = o.batchDate.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { orders: 0, revenue: 0 });
    const m = byMonth.get(month)!;
    m.orders++;
    m.revenue += o.revenue.grossTotal;
  }
  return [...byMonth.entries()].sort().map(([month, m]) => ({ month, ...m }));
}

// ─── TOP 品項（以 SKU 份數計）───────────────────────────────────────────────

export type TopProductEntry = {
  /** productSkuId（null = 未識別，caller 用 getDisplayName 轉顯示名） */
  skuId: string;
  /** 訂單份數（item.quantity 加總）*/
  qty: number;
};

export function computeTopProducts(orders: Order[]): TopProductEntry[] {
  const eligible = orders.filter(isEligible);
  const bySkuQty = new Map<string, number>();

  for (const o of eligible) {
    for (const item of o.items) {
      if (!item.productSkuId) continue;
      bySkuQty.set(
        item.productSkuId,
        (bySkuQty.get(item.productSkuId) ?? 0) + item.quantity
      );
    }
  }

  return [...bySkuQty.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([skuId, qty]) => ({ skuId, qty }));
}

// ─── 通路占比 ────────────────────────────────────────────────────────────────

export type ChannelBucket =
  | "賣貨便"
  | "KOL"
  | "面交"
  | "宅配"
  | "待分類";

export type ChannelShareEntry = {
  label: ChannelBucket;
  count: number;
  pct: number;
  color: string;
};

const CHANNEL_COLOR: Record<ChannelBucket, string> = {
  賣貨便: "#F5D400",
  KOL: "#8557C9",
  面交: "#43B23C",
  宅配: "#2AC7E8",
  待分類: "#E5352B",
};

function normalizeChannel(ch: ChannelId): ChannelBucket {
  if (ch === "賣貨便") return "賣貨便";
  if (ch === "KOL") return "KOL";
  if (ch.startsWith("面交")) return "面交";
  if (ch === "宅配") return "宅配";
  return "待分類";
}

export function computeChannelShare(orders: Order[]): ChannelShareEntry[] {
  const eligible = orders.filter(isEligible);
  if (eligible.length === 0) return [];

  const byCh = new Map<ChannelBucket, number>();
  for (const o of eligible) {
    const bucket = normalizeChannel(o.channel);
    byCh.set(bucket, (byCh.get(bucket) ?? 0) + 1);
  }

  const total = eligible.length;
  return ([...byCh.entries()] as [ChannelBucket, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({
      label,
      count,
      pct: (count / total) * 100,
      color: CHANNEL_COLOR[label],
    }));
}

// ─── 回頭率 ──────────────────────────────────────────────────────────────────

export type RepeatCustomerStats = {
  totalUnique: number;
  repeatCount: number;
  repeatPct: number;
  topRepeats: Array<{ key: string; count: number }>;
};

export function computeRepeatCustomers(orders: Order[]): RepeatCustomerStats {
  const eligible = orders.filter(isEligible);
  const byCustomer = new Map<string, number>();

  for (const o of eligible) {
    const key = o.recipient.igOrLine ?? o.recipient.name ?? null;
    if (!key) continue;
    byCustomer.set(key, (byCustomer.get(key) ?? 0) + 1);
  }

  const totalUnique = byCustomer.size;
  const repeatCount = [...byCustomer.values()].filter((n) => n > 1).length;
  const repeatPct = totalUnique > 0 ? (repeatCount / totalUnique) * 100 : 0;
  const topRepeats = [...byCustomer.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => ({ key, count }));

  return { totalUnique, repeatCount, repeatPct, topRepeats };
}

// ─── 原子出爐總量（本月 eligible 訂單） ────────────────────────────────────

export type AtomTotalEntry = {
  atomId: string;
  total: number;
};

export function computeAtomTotals(orders: Order[]): AtomTotalEntry[] {
  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const eligible = orders.filter(
    (o) => isEligible(o) && o.batchDate?.startsWith(currentYM)
  );

  const byAtom = new Map<string, number>();
  for (const o of eligible) {
    for (const item of o.items) {
      for (const a of item.atoms) {
        byAtom.set(a.atomId, (byAtom.get(a.atomId) ?? 0) + a.count * item.quantity);
      }
    }
  }

  return [...byAtom.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([atomId, total]) => ({ atomId, total }));
}

// ─── 資料健康燈 ──────────────────────────────────────────────────────────────

export type HealthCheck = {
  label: string;
  value: string;
  color: "#43B23C" | "#E5622A";
};

/**
 * 憲章防護燈。
 * #1 總數守恆：所有非 canceled 訂單 items 都有 atoms。
 * #9 消失守恆：disappeared_pending_resolution 計數。
 * #10 變動守恆：change_pending_resolution 計數。
 * 金額對帳：已有 revenue.grossTotal 的訂單比例。
 */
export function computeHealthChecks(orders: Order[]): HealthCheck[] {
  const nonCanceled = orders.filter((o) => o.status !== "canceled");

  // 金額對帳：grossTotal !== 0 視為有金額
  const withAmount = nonCanceled.filter((o) => o.revenue.grossTotal > 0).length;
  const total = nonCanceled.length;
  const amountOk = total === 0 || withAmount === total;

  // 總數守恆：所有 items 有 productSkuId（null 算 broken）
  const brokenItems = nonCanceled.some((o) =>
    o.items.some((it) => it.productSkuId === null)
  );

  const disappeared = orders.filter(
    (o) => o.status === "disappeared_pending_resolution"
  ).length;

  const changePending = orders.filter(
    (o) => o.status === "change_pending_resolution"
  ).length;

  return [
    {
      label: "金額對帳 #2",
      value: amountOk ? `${withAmount}/${total} ✓` : `${withAmount}/${total} ！`,
      color: amountOk ? "#43B23C" : "#E5622A",
    },
    {
      label: "總數守恆 #1",
      value: brokenItems ? "有未知品項" : "一致",
      color: brokenItems ? "#E5622A" : "#43B23C",
    },
    {
      label: "消失守恆 #9",
      value: disappeared === 0 ? "0 待拍板" : `${disappeared} 待拍板`,
      color: disappeared === 0 ? "#43B23C" : "#E5622A",
    },
    {
      label: "變動守恆 #10",
      value: changePending === 0 ? "0 待確認" : `${changePending} 待確認`,
      color: changePending === 0 ? "#43B23C" : "#E5622A",
    },
  ];
}
