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
  | "MASSIVE_DISAPPEARANCE"
  | "ZERO_WISH_DATE";

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
  /** 這通路目前資料總筆數（不限日期）*/
  dbCount: number;
  /** 目前資料中「落在本輪 xlsx 涵蓋日期範圍內」的筆數 —— 這才是「消失比例」的分母 */
  dbInRangeCount: number;
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
        "目前記錄「付款完成」、這輪 xlsx 卻標「未付款」。付款是不可逆事件、幾乎肯定這輪檔源是舊備份。建議取消匯入。",
      affectedIds: paymentReversalIds,
    });
  }

  // 「範圍內比對」是核心防護（Yen 2026-07-19）：
  //   之前 disappearCount = 「所有目前資料 - 這輪 xlsx」，假設「每次匯入 = 該通路完整快照」。
  //   實務上雇主分批拖同通路不同時段的檔（例如先拖近期 1.xlsx、再補歷史 2.xlsx）是常態，
  //   舊邏輯會把「歷史檔沒包含近期訂單」誤判成「近期訂單消失」→ CRITICAL 誤報。
  //   → 只比對「這輪 xlsx 涵蓋日期範圍內」的目前訂單。範圍外的目前資料不算「消失」。
  const [rangeMin, rangeMax] = orderDateRange(newInSrc);
  const dbInRange = rangeMin && rangeMax
    ? dbInSrc.filter((o) => o.order_date && o.order_date >= rangeMin && o.order_date <= rangeMax)
    : [];

  // B · 消失比例過高
  let disappearCount = 0;
  for (const o of dbInRange) {
    if (!newMap.has(o.id)) disappearCount++;
  }
  const disappearRatio = dbInRange.length === 0 ? 0 : disappearCount / dbInRange.length;
  if (disappearRatio > 0.5 && dbInRange.length >= 10) {
    outWarnings.push({
      code: "MASSIVE_DISAPPEARANCE",
      severity: disappearRatio > 0.8 ? "critical" : "warn",
      source,
      title: `[${src}] ${(disappearRatio * 100).toFixed(0)}% 訂單同時消失（${disappearCount} / ${dbInRange.length}）`,
      detail:
        "自然消失通常 < 20%。這麼高的比例代表檔源可能不同（換了期別、匯出範圍縮短、或匯入了舊備份）。（比對範圍：這輪 xlsx 涵蓋的下單日內。）",
    });
  }

  // C · 下單日回退
  //   只在「範圍內有真的消失」時才視為問題。分批補歷史（disappearCount=0）不誤報。
  const maxOrderDateNew = maxOrderDate(newInSrc);
  const maxOrderDateDb = maxOrderDate(dbInSrc);
  if (
    maxOrderDateNew && maxOrderDateDb && maxOrderDateNew < maxOrderDateDb &&
    disappearCount > 0
  ) {
    const daysBack = daysBetween(maxOrderDateNew, maxOrderDateDb);
    outWarnings.push({
      code: "ORDER_DATE_REGRESSION",
      severity: daysBack > 30 ? "critical" : daysBack > 7 ? "warn" : "notice",
      source,
      title: `[${src}] 這輪最新下單日比目前資料舊 ${daysBack} 天`,
      detail: `目前最新下單日：${maxOrderDateDb}｜這輪 xlsx 最新下單日：${maxOrderDateNew}。若你剛下載的檔應該包含最新訂單、這代表檔源可能拿錯了。`,
    });
  }

  // D · 這批完全沒有任何指定出貨日（#12 2026-08-06）
  //   指定日目前唯一來源是 xlsx c12 文字裡的「指定出貨日 M/D」marker——有些
  //   賣貨便匯出格式不帶這行、系統會靜默當成「這批全都沒指定」。這不一定是
  //   真的沒人指定，只是這份 xlsx 沒帶到；只有賣貨便通路有這個 marker 概念。
  if (source === "seller-buy" && newInSrc.some((o) => o.customer_wish_date == null)) {
    const zeroWishDate = newInSrc.every((o) => o.customer_wish_date == null);
    if (zeroWishDate) {
      outWarnings.push({
        code: "ZERO_WISH_DATE",
        severity: "notice",
        source,
        title: `[${src}] 本批 ${newInSrc.length} 筆訂單未偵測到任何指定出貨日`,
        detail:
          "若這批確實有客人指定出貨日、但這份 xlsx 沒帶到，請補拖賣貨便網頁存檔（.htm）——指定日有時只出現在網頁版、xlsx 匯出會漏掉。",
      });
    }
  }

  return {
    source,
    newCount: newInSrc.length,
    dbCount: dbInSrc.length,
    dbInRangeCount: dbInRange.length,
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
    dbInRangeCount: 0,
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

/** [min, max] 下單日 · 只取 ISO 前綴合法的 · 空陣列或全無日期回 [null, null] */
function orderDateRange(orders: Order[]): [string | null, string | null] {
  let min: string | null = null;
  let max: string | null = null;
  for (const o of orders) {
    const d = o.order_date;
    if (!d) continue;
    if (!/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
    if (min === null || d < min) min = d;
    if (max === null || d > max) max = d;
  }
  return [min, max];
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.round(Math.abs(db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
}
