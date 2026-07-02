/**
 * compute-payout.ts — 分潤統計純函式
 *
 * 憲章 #1：禁 hardcode 品項 / 成本。所有數字來自 orders + menu。
 * 憲章 #2：web app 0 LLM，數字純算術。
 * 估算值明確標示（isEstimated flag），UI 必須 loud 顯示。
 */
import type { Menu, Order } from "./models";

// ── 物流成本 fallback（menu 無值才用）──────────────────────
export const LOGISTICS_FALLBACK: Record<string, number> = {
  "賣貨便_超商": 60,
  "宅配": 130,
  "面交": 0,
  "KOL": 60,
};

/** 同 payout-excel.ts 的 logisticsCostFor，不依賴輸出層 */
function logisticsCostFor(o: Order, menu: Menu): { cost: number; isEstimated: boolean } {
  const table = menu.logistics_cost ?? {};
  if (o.channel === "賣貨便") {
    if ("賣貨便_超商" in table) return { cost: table["賣貨便_超商"]!, isEstimated: false };
    return { cost: LOGISTICS_FALLBACK["賣貨便_超商"]!, isEstimated: true };
  }
  if (o.channel === "宅配") {
    if ("宅配" in table) return { cost: table["宅配"]!, isEstimated: false };
    return { cost: LOGISTICS_FALLBACK["宅配"]!, isEstimated: true };
  }
  if (o.channel.startsWith("面交")) {
    const key = "面交";
    if (key in table) return { cost: table[key]!, isEstimated: false };
    return { cost: 0, isEstimated: false };
  }
  if (o.channel === "KOL") {
    if ("KOL" in table) return { cost: table["KOL"]!, isEstimated: false };
    return { cost: LOGISTICS_FALLBACK["KOL"]!, isEstimated: true };
  }
  return { cost: 0, isEstimated: false };
}

/** 品項成本：所有 items 的 product.cost × quantity */
function cogsFor(o: Order, menu: Menu): { cost: number; isEstimated: boolean } {
  let total = 0;
  let hasNull = false;
  for (const item of o.items) {
    if (!item.productSkuId) { hasNull = true; continue; }
    const product = menu.products[item.productSkuId];
    if (!product || product.cost === null) { hasNull = true; continue; }
    total += product.cost * item.quantity;
  }
  return { cost: total, isEstimated: hasNull };
}

/** 包材估算：每筆訂單固定值，目前從 menu.logistics_cost["包材"] 取；無則估 25 */
function packagingFor(_o: Order, menu: Menu): { cost: number; isEstimated: boolean } {
  const table = menu.logistics_cost ?? {};
  if ("包材" in table) return { cost: table["包材"]!, isEstimated: false };
  return { cost: 25, isEstimated: true };
}

// ── Channel 群組規則 ──────────────────────────────────────
/** ChannelId → 顯示通路名 + 品牌色 */
export const CHANNEL_META: Record<string, { name: string; color: string }> = {
  "賣貨便":        { name: "賣貨便",  color: "var(--acc,#F5D400)" },
  "面交_中壢":     { name: "面交",    color: "#43B23C" },
  "面交_台中":     { name: "面交",    color: "#43B23C" },
  "面交_其他":     { name: "面交",    color: "#43B23C" },
  "宅配":          { name: "宅配",    color: "#2AC7E8" },
  "KOL":           { name: "KOL",     color: "#8557C9" },
  "待分類":        { name: "待分類",  color: "#E5352B" },
};

// ── 主要輸出型別 ──────────────────────────────────────────

export type ChannelPayout = {
  channelId: string;
  name: string;
  color: string;
  orderCount: number;
  grossTotal: number;
  cogs: number;
  packaging: number;
  logistics: number;
  netProfit: number;
  /** 有任何成本是估算值 */
  isEstimated: boolean;
};

export type PayoutResult = {
  /** 只含 confirmed / kol_shipped / pending_batch_date */
  orderCount: number;
  grossTotal: number;
  cogs: number;
  packaging: number;
  logistics: number;
  netProfit: number;
  netMargin: number; // 0–1
  byChannel: ChannelPayout[];
  /** 任何成本使用了估算 fallback */
  isEstimated: boolean;
  /** 估算來源描述（UI loud 顯示用） */
  estimatedReasons: string[];
};

/** 只輸出 confirmed / kol_shipped / pending_batch_date 的訂單 */
function eligibleOrders(orders: Order[]): Order[] {
  return orders.filter(
    (o) =>
      o.status === "confirmed" ||
      o.status === "kol_shipped" ||
      o.status === "pending_batch_date"
  );
}

/** 核心純函式：從 orders + menu 算出完整分潤數字 */
export function computePayout(orders: Order[], menu: Menu): PayoutResult {
  const eligible = eligibleOrders(orders);

  // 按 channel 聚合
  const map = new Map<string, {
    orderCount: number;
    grossTotal: number;
    cogs: number;
    packaging: number;
    logistics: number;
    isEstimated: boolean;
  }>();

  const estimatedReasonSet = new Set<string>();

  for (const o of eligible) {
    const key = o.channel;
    if (!map.has(key)) {
      map.set(key, { orderCount: 0, grossTotal: 0, cogs: 0, packaging: 0, logistics: 0, isEstimated: false });
    }
    const acc = map.get(key)!;
    acc.orderCount += 1;
    acc.grossTotal += o.revenue.grossTotal;

    const cogsR = cogsFor(o, menu);
    acc.cogs += cogsR.cost;
    if (cogsR.isEstimated) {
      acc.isEstimated = true;
      estimatedReasonSet.add("部分品項缺 cost，COGS 為估算");
    }

    const pkgR = packagingFor(o, menu);
    acc.packaging += pkgR.cost;
    if (pkgR.isEstimated) {
      acc.isEstimated = true;
      estimatedReasonSet.add("包材成本使用預設 $25／單（menu 無 logistics_cost[包材]）");
    }

    const logR = logisticsCostFor(o, menu);
    acc.logistics += logR.cost;
    if (logR.isEstimated) {
      acc.isEstimated = true;
      if (o.channel === "賣貨便") estimatedReasonSet.add("賣貨便物流使用預設 $60（超商）");
      if (o.channel === "宅配") estimatedReasonSet.add("宅配物流使用預設 $130");
      if (o.channel === "KOL") estimatedReasonSet.add("KOL 物流使用預設 $60");
    }
  }

  // 轉成 byChannel
  const byChannel: ChannelPayout[] = [];
  for (const [channelId, acc] of map.entries()) {
    const meta = CHANNEL_META[channelId] ?? { name: channelId, color: "#8A8A93" };
    const net = acc.grossTotal - acc.cogs - acc.packaging - acc.logistics;
    byChannel.push({
      channelId,
      name: meta.name,
      color: meta.color,
      orderCount: acc.orderCount,
      grossTotal: acc.grossTotal,
      cogs: acc.cogs,
      packaging: acc.packaging,
      logistics: acc.logistics,
      netProfit: net,
      isEstimated: acc.isEstimated,
    });
  }

  // 依訂單數排序（大 → 小）
  byChannel.sort((a, b) => b.orderCount - a.orderCount);

  // 合計
  const totalGross = byChannel.reduce((s, c) => s + c.grossTotal, 0);
  const totalCogs = byChannel.reduce((s, c) => s + c.cogs, 0);
  const totalPkg = byChannel.reduce((s, c) => s + c.packaging, 0);
  const totalLog = byChannel.reduce((s, c) => s + c.logistics, 0);
  const totalNet = totalGross - totalCogs - totalPkg - totalLog;
  const anyEstimated = byChannel.some((c) => c.isEstimated);

  return {
    orderCount: eligible.length,
    grossTotal: totalGross,
    cogs: totalCogs,
    packaging: totalPkg,
    logistics: totalLog,
    netProfit: totalNet,
    netMargin: totalGross > 0 ? totalNet / totalGross : 0,
    byChannel,
    isEstimated: anyEstimated,
    estimatedReasons: [...estimatedReasonSet],
  };
}

/** NT$ 格式化（無小數，千分位逗號） */
export function fmtNT(v: number): string {
  return v.toLocaleString("zh-TW", { maximumFractionDigits: 0 });
}

/** 百分比格式（一位小數）*/
export function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}
