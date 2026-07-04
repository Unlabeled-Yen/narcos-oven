/**
 * import-sanity.ts · 匯入前預檢 · Per Source 各自計算
 *
 * Yen 2026-07-04：三通路 xlsx 一起匯是實務常態、要低摩擦
 *   → 賣貨便 / 面交/宅配 / KOL 三個 source 各自跑 sanity、不跨源混算
 *   → 若某通路這輪沒帶檔（newInSource 空）· skip 該源檢查（雇主故意沒匯）
 *   → 若某通路 DB 是空的（第一次匯）· skip
 *
 * 純函式、無 IO
 */
import type { Order } from "./models";

export type SourceKind = "seller-buy" | "in-person" | "kol";

export const SOURCE_NAME: Record<SourceKind, string> = {
  "seller-buy": "賣貨便",
  "in-person": "面交/宅配",
  kol: "KOL",
};

function sourceOf(channel: string): SourceKind | "other" {
  if (channel === "賣貨便") return "seller-buy";
  if (channel === "KOL") return "kol";
  if (channel.startsWith("面交") || channel === "宅配" || channel === "待分類") return "in-person";
  return "other";
}

export type SanityCode =
  | "PAYMENT_REVERSAL"
  | "ORDER_DATE_REGRESSION"
  | "MASSIVE_DISAPPEARANCE";

export type Severity = "notice" | "warn" | "critical";

export type SanityWarning = {
  code: SanityCode;
  severity: Severity;
  source: SourceKind;
  title: string;
  detail: string;
  affectedIds?: string[];
};

export type SourceStats = {
  source: SourceKind;
  newCount: number;
  dbCount: number;
  disappearCount: number;
  disappearRatio: number;
  maxOrderDateNew: string | null;
  maxOrderDateDb: string | null;
  paymentReversedCount: number;
};

export type SanityReport = {
  severity: Severity | "ok";
  warnings: SanityWarning[];
  perSource: SourceStats[];
  // aggregate for legacy UI callers
  stats: {
    newCount: number;
    dbActiveCount: number;
    disappearCount: number;
    disappearRatio: number;
    maxOrderDateNew: string | null;
    maxOrderDateDb: string | null;
  };
};

/** Per source 拆算 · 低摩擦：多通路混匯不會互相干擾 */
export function checkImportSanity(newOrders: Order[], dbActive: Order[]): SanityReport {
  const newBy = groupBySource(newOrders);
  const dbBy = groupBySource(dbActive);
  const sources: SourceKind[] = ["seller-buy", "in-person", "kol"];

  const warnings: SanityWarning[] = [];
  const perSource: SourceStats[] = [];

  for (const source of sources) {
    const newInSrc = newBy.get(source) ?? [];
    const dbInSrc = dbBy.get(source) ?? [];

    // Skip 條件（低摩擦重點）：
    //   若這輪這通路沒帶檔 · 雇主故意不匯 · 什麼都別警告
    //   若 DB 這通路是空的（第一次匯）· 沒對照基準 · 也 skip
    if (newInSrc.length === 0 || dbInSrc.length === 0) {
      perSource.push(zeroStats(source, newInSrc, dbInSrc));
      continue;
    }

    const stats = checkOneSource(source, newInSrc, dbInSrc, warnings);
    perSource.push(stats);
  }

  const worst = warnings.reduce<Severity | "ok">((w, cur) => {
    const rank = (s: Severity | "ok") =>
      s === "ok" ? 0 : s === "notice" ? 1 : s === "warn" ? 2 : 3;
    return rank(cur.severity) > rank(w) ? cur.severity : w;
  }, "ok");

  return {
    severity: worst,
    warnings,
    perSource,
    stats: aggregateStats(perSource, newOrders, dbActive),
  };
}

function checkOneSource(
  source: SourceKind,
  newInSrc: Order[],
  dbInSrc: Order[],
  outWarnings: SanityWarning[]
): SourceStats {
  const dbMap = new Map(dbInSrc.map((o) => [o.id, o]));
  const newMap = new Map(newInSrc.map((o) => [o.id, o]));
  const src = SOURCE_NAME[source];

  // A · 付款狀態回退
  const paymentReversalIds: string[] = [];
  for (const [id, incoming] of newMap) {
    const existing = dbMap.get(id);
    if (!existing) continue;
    const oldPaid = existing.snapshot.c5_status.includes("付款完成");
    const newPaid = incoming.snapshot.c5_status.includes("付款完成");
    if (oldPaid && !newPaid) paymentReversalIds.push(id);
  }
  if (paymentReversalIds.length > 0) {
    outWarnings.push({
      code: "PAYMENT_REVERSAL",
      severity: "critical",
      source,
      title: `[${src}] ${paymentReversalIds.length} 筆訂單付款狀態回退`,
      detail:
        "DB 記錄「付款完成」、這輪 xlsx 卻標「未付款」。付款是不可逆事件、幾乎肯定這輪檔源是舊備份。建議取消匯入。",
      affectedIds: paymentReversalIds,
    });
  }

  // B · 下單日回退
  const maxOrderDateNew = maxOrderDate(newInSrc);
  const maxOrderDateDb = maxOrderDate(dbInSrc);
  if (maxOrderDateNew && maxOrderDateDb && maxOrderDateNew < maxOrderDateDb) {
    const daysBack = daysBetween(maxOrderDateNew, maxOrderDateDb);
    outWarnings.push({
      code: "ORDER_DATE_REGRESSION",
      severity: daysBack > 30 ? "critical" : daysBack > 7 ? "warn" : "notice",
      source,
      title: `[${src}] 這輪最新下單日比 DB 舊 ${daysBack} 天`,
      detail: `DB 最新下單日：${maxOrderDateDb}｜這輪 xlsx 最新下單日：${maxOrderDateNew}。若你剛下載的檔應該包含最新訂單、這代表檔源可能拿錯了。`,
    });
  }

  // C · 消失比例過高
  let disappearCount = 0;
  for (const id of dbMap.keys()) {
    if (!newMap.has(id)) disappearCount++;
  }
  const disappearRatio = disappearCount / dbInSrc.length;
  if (disappearRatio > 0.5 && dbInSrc.length >= 10) {
    outWarnings.push({
      code: "MASSIVE_DISAPPEARANCE",
      severity: disappearRatio > 0.8 ? "critical" : "warn",
      source,
      title: `[${src}] ${(disappearRatio * 100).toFixed(0)}% 訂單同時消失（${disappearCount} / ${dbInSrc.length}）`,
      detail:
        "自然消失通常 < 20%。這麼高的比例代表檔源可能不同（換了期別、匯出範圍縮短、或匯入了舊備份）。",
    });
  }

  return {
    source,
    newCount: newInSrc.length,
    dbCount: dbInSrc.length,
    disappearCount,
    disappearRatio,
    maxOrderDateNew,
    maxOrderDateDb,
    paymentReversedCount: paymentReversalIds.length,
  };
}

function zeroStats(source: SourceKind, newInSrc: Order[], dbInSrc: Order[]): SourceStats {
  return {
    source,
    newCount: newInSrc.length,
    dbCount: dbInSrc.length,
    disappearCount: 0,
    disappearRatio: 0,
    maxOrderDateNew: maxOrderDate(newInSrc),
    maxOrderDateDb: maxOrderDate(dbInSrc),
    paymentReversedCount: 0,
  };
}

function groupBySource(orders: Order[]): Map<SourceKind, Order[]> {
  const m = new Map<SourceKind, Order[]>();
  for (const o of orders) {
    const s = sourceOf(o.channel);
    if (s === "other") continue;
    const arr = m.get(s) ?? [];
    arr.push(o);
    m.set(s, arr);
  }
  return m;
}

function aggregateStats(
  perSource: SourceStats[],
  newOrders: Order[],
  dbActive: Order[]
): SanityReport["stats"] {
  const disappearCount = perSource.reduce((s, r) => s + r.disappearCount, 0);
  return {
    newCount: newOrders.length,
    dbActiveCount: dbActive.length,
    disappearCount,
    disappearRatio: dbActive.length === 0 ? 0 : disappearCount / dbActive.length,
    maxOrderDateNew: maxOrderDate(newOrders),
    maxOrderDateDb: maxOrderDate(dbActive),
  };
}

function maxOrderDate(orders: Order[]): string | null {
  let max: string | null = null;
  for (const o of orders) {
    const d = o.order_date;
    if (!d) continue;
    if (!/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
    if (max === null || d > max) max = d;
  }
  return max;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.round(Math.abs(db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
}
