/**
 * import-sanity.ts · 匯入前預檢 · 偵測「這輪 xlsx 疑似為舊備份」
 *
 * Yen 2026-07-04：讓系統主動找「時效性倒退」的訊號、匯入前擋
 *   - 付款狀態回退（不可逆事件反轉）
 *   - 下單日最大值回退（舊備份最大 order_date < DB 最大）
 *   - 消失比例過高（大批訂單同時消失、疑似檔源不同）
 *
 * 純函式、無 IO、可 Node 測試
 */
import type { Order } from "./models";

export type SanityCode =
  | "PAYMENT_REVERSAL"
  | "ORDER_DATE_REGRESSION"
  | "MASSIVE_DISAPPEARANCE";

export type Severity = "notice" | "warn" | "critical";

export type SanityWarning = {
  code: SanityCode;
  severity: Severity;
  title: string;
  detail: string;
  affectedIds?: string[]; // 相關 order ids · UI 可展開看
};

export type SanityReport = {
  severity: Severity | "ok";
  warnings: SanityWarning[];
  stats: {
    newCount: number;
    dbActiveCount: number;
    disappearCount: number;
    disappearRatio: number; // 0..1
    maxOrderDateNew: string | null;
    maxOrderDateDb: string | null;
  };
};

/**
 * 匯入前預檢
 * @param newOrders parser 剛跑出的訂單（此輪）
 * @param dbActive  DB 該 channel 現存 active 訂單
 */
export function checkImportSanity(newOrders: Order[], dbActive: Order[]): SanityReport {
  const warnings: SanityWarning[] = [];
  const dbMap = new Map(dbActive.map((o) => [o.id, o]));
  const newMap = new Map(newOrders.map((o) => [o.id, o]));

  // ── A · 付款狀態回退 ─────────────────────────────
  const paymentReversalIds: string[] = [];
  for (const [id, incoming] of newMap) {
    const existing = dbMap.get(id);
    if (!existing) continue;
    const oldPaid = existing.snapshot.c5_status.includes("付款完成");
    const newPaid = incoming.snapshot.c5_status.includes("付款完成");
    if (oldPaid && !newPaid) paymentReversalIds.push(id);
  }
  if (paymentReversalIds.length > 0) {
    warnings.push({
      code: "PAYMENT_REVERSAL",
      severity: "critical",
      title: `${paymentReversalIds.length} 筆訂單付款狀態回退`,
      detail:
        "DB 記錄「付款完成」的訂單、這輪 xlsx 卻標「未付款」。付款是不可逆事件、幾乎肯定這輪 xlsx 是舊備份混入。建議取消匯入。",
      affectedIds: paymentReversalIds,
    });
  }

  // ── B · 下單日最大值回退 ─────────────────────────
  const maxOrderDateNew = maxOrderDate(newOrders);
  const maxOrderDateDb = maxOrderDate(dbActive);
  if (maxOrderDateNew && maxOrderDateDb && maxOrderDateNew < maxOrderDateDb) {
    const daysBack = daysBetween(maxOrderDateNew, maxOrderDateDb);
    warnings.push({
      code: "ORDER_DATE_REGRESSION",
      severity: daysBack > 30 ? "critical" : daysBack > 7 ? "warn" : "notice",
      title: `這輪 xlsx 最新下單日比 DB 舊 ${daysBack} 天`,
      detail: `DB 最新下單日：${maxOrderDateDb}｜這輪 xlsx 最新下單日：${maxOrderDateNew}。若你剛下載的檔應該包含最新訂單、這代表檔源可能拿錯了。`,
    });
  }

  // ── C · 消失比例過高 ─────────────────────────────
  let disappearCount = 0;
  for (const id of dbMap.keys()) {
    if (!newMap.has(id)) disappearCount++;
  }
  const disappearRatio = dbActive.length === 0 ? 0 : disappearCount / dbActive.length;
  if (disappearRatio > 0.5 && dbActive.length >= 10) {
    warnings.push({
      code: "MASSIVE_DISAPPEARANCE",
      severity: disappearRatio > 0.8 ? "critical" : "warn",
      title: `${(disappearRatio * 100).toFixed(0)}% 訂單同時消失（${disappearCount} / ${dbActive.length}）`,
      detail:
        "自然的訂單消失是「已出貨」等因素、通常 < 20%。這麼高的比例代表檔源可能不同（例如換了期別、匯出範圍縮短、或匯入了舊備份）。",
    });
  }

  const worst: Severity | "ok" = warnings.reduce<Severity | "ok">((w, cur) => {
    const rank = (s: Severity | "ok") =>
      s === "ok" ? 0 : s === "notice" ? 1 : s === "warn" ? 2 : 3;
    return rank(cur.severity) > rank(w) ? cur.severity : w;
  }, "ok");

  return {
    severity: worst,
    warnings,
    stats: {
      newCount: newOrders.length,
      dbActiveCount: dbActive.length,
      disappearCount,
      disappearRatio,
      maxOrderDateNew,
      maxOrderDateDb,
    },
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
