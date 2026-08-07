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

// ─── 日期工具 ────────────────────────────────────────────────────────────────
// 一律用「本地午夜」解析。new Date("2026-07-17") 會被當 UTC 午夜，
// 在 UTC 以西的時區 .getDay() 會退一天 → 出貨日算錯。手動拆字串避開。

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function addDays(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

/** "YYYY-MM" 加減月份 */
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y!, m! - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── 期間窗 ──────────────────────────────────────────────────────────────────

/**
 * 儀表板期間。
 *
 * Yen 2026-07-17：原本是 june / 8w / all，但 chip 從來沒接上任何 compute
 * （點了什麼都不會變 —— 靜默失效）。接上時順手把寫死的「六月」改成滾動的
 * 「近 6 月」：六月是開發當下的月份，寫死之後每過一個月就更錯一次。
 */
export type Period = "8w" | "6m" | "all";

/** 日期窗（ISO，含頭尾） */
export type DateWindow = { from: string; to: string };

/**
 * 出貨行事曆。由 caller 從 menu.scheduling + 單日 override 組出來後注入，
 * 讓本模組維持純函式、可測（不碰 localStorage、不碰 menu）。
 */
export type ShipCalendar = {
  /** iso 本身是不是出貨日 */
  isShipDay: (iso: string) => boolean;
  /** 任一日期 → 它所屬的出貨批（例：07/05 週日 → 07/07 週二） */
  shipDayOf: (iso: string) => string;
};

/** 近 8 週 = 8 個出貨日（含 today 所屬的那一批） */
export const RECENT_SHIP_DAYS = 8;

/**
 * 期間 → 日期窗。
 *
 * 8w  以「出貨日」為單位回推，不是硬減 56 天 —— 雇主想的是「最近 8 批」，
 *     而出貨日可由 menu.scheduling / 單日 override 調整，不保證剛好每 7 天一次。
 * 6m  今天往回數 6 個月（含本月）。
 * all 資料自己的範圍（沒有已排程訂單時退回今天當單點窗）。
 */
export function resolvePeriodWindow(
  period: Period,
  orders: Order[],
  todayIso: string,
  cal: ShipCalendar,
): DateWindow {
  if (period === "all") {
    const dates = orders.map((o) => o.batchDate).filter((d): d is string => !!d).sort();
    if (dates.length === 0) return { from: todayIso, to: todayIso };
    return { from: dates[0]!, to: dates[dates.length - 1]! };
  }
  if (period === "6m") {
    const ym = todayIso.slice(0, 7);
    return { from: `${addMonths(ym, -5)}-01`, to: lastDayOfMonth(ym) };
  }
  // 8w：從今天（含）往回蒐集 8 個出貨日
  const days = shipDaysBackFrom(todayIso, RECENT_SHIP_DAYS, cal.isShipDay);
  return { from: days[0] ?? todayIso, to: todayIso };
}

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return toIso(new Date(y!, m!, 0)); // 下個月第 0 天 = 本月最後一天
}

/**
 * 把窗撐成完整月份 —— 給「按月」的圖用。
 *
 * 為什麼需要：8w 的窗是 05/26–07/17，五月只有最後 6 天在內。若直接拿這個窗
 * 算月營收，五月會顯示 0，但標籤寫的是「5月」—— 讀起來就是「五月沒賺錢」，
 * 而事實是五月有單、只是不在窗內。標籤說一件事、數字說另一件事 = 靜默失效。
 * 撐成整月之後每根長條都對得起自己的標籤。
 */
export function monthAlignedWindow(w: DateWindow): DateWindow {
  return { from: `${w.from.slice(0, 7)}-01`, to: lastDayOfMonth(w.to.slice(0, 7)) };
}

/**
 * 從 fromIso（含）往回找 count 個出貨日，回傳由舊到新。
 * 掃描上限 count*14 天：出貨日再稀疏也不該超過兩週一次，超過就是設定壞了、
 * 與其無限迴圈不如吐出找到的那些（呼叫端會畫出比較短的軸、看得出不對勁）。
 */
function shipDaysBackFrom(fromIso: string, count: number, isShipDay: (iso: string) => boolean): string[] {
  const out: string[] = [];
  let cur = fromIso;
  for (let i = 0; i < count * 14 && out.length < count; i++) {
    if (isShipDay(cur)) out.push(cur);
    cur = addDays(cur, -1);
  }
  return out.reverse();
}

function inWindow(iso: string | null | undefined, w: DateWindow): boolean {
  return !!iso && iso >= w.from && iso <= w.to; // ISO 字串可直接比大小
}

/** 期間內、且已排定出貨日的 eligible 訂單 */
function eligibleInWindow(orders: Order[], w: DateWindow): Order[] {
  return orders.filter((o) => isEligible(o) && inWindow(o.batchDate, w));
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

// ─── 出爐量趨勢（按出貨批 · 補滿空格）──────────────────────────────────────

export type BatchTrendEntry = {
  date: string;    // ISO 出貨日
  orders: number;
  revenue: number;
};

/**
 * window 內每一個出貨日的訂單數 —— 沒有訂單的出貨日也給 0、照樣佔一格。
 *
 * 補空格是刻意的：只畫「有資料的那幾根」時，一批 = 一根塞滿整個面板，
 * 看起來像圖壞了；而且看不出中間有幾週是空的。補滿之後那根孤條有位置感，
 * 也誠實顯示「其餘幾批還沒排」。
 *
 * 訂單的 batchDate 不保證是出貨日本身（雇主可排在工作日，例 07/05 週日），
 * 一律經 cal.shipDayOf 歸到所屬批 —— 跟標籤 / 工單的歸批邏輯同一套。
 */
export function computeBatchTrend(
  orders: Order[],
  w: DateWindow,
  cal: ShipCalendar,
): BatchTrendEntry[] {
  const buckets = new Map<string, { orders: number; revenue: number }>();
  // 先鋪滿軸
  let cur = w.from;
  for (let i = 0; i < 400 && cur <= w.to; i++) {
    if (cal.isShipDay(cur)) buckets.set(cur, { orders: 0, revenue: 0 });
    cur = addDays(cur, 1);
  }
  // 再把訂單灌進去
  for (const o of eligibleInWindow(orders, w)) {
    const slot = cal.shipDayOf(o.batchDate!);
    const b = buckets.get(slot);
    if (!b) continue; // 歸批後落在窗外（窗尾附近才可能）· 不硬塞
    b.orders++;
    b.revenue += o.revenue.grossTotal;
  }
  return [...buckets.entries()].sort().map(([date, v]) => ({ date, ...v }));
}

// ─── 月營收趨勢（補滿空月）──────────────────────────────────────────────────

export type MonthTrendEntry = {
  month: string;   // "YYYY-MM"
  orders: number;
  revenue: number;
};

/** window 內每一個月，沒有訂單的月份也給 0（理由同 computeBatchTrend） */
export function computeMonthTrend(orders: Order[], w: DateWindow): MonthTrendEntry[] {
  const byMonth = new Map<string, { orders: number; revenue: number }>();
  let ym = w.from.slice(0, 7);
  const lastYm = w.to.slice(0, 7);
  for (let i = 0; i < 240 && ym <= lastYm; i++) {
    byMonth.set(ym, { orders: 0, revenue: 0 });
    ym = addMonths(ym, 1);
  }
  for (const o of eligibleInWindow(orders, w)) {
    const m = byMonth.get(o.batchDate!.slice(0, 7));
    if (!m) continue;
    m.orders++;
    m.revenue += o.revenue.grossTotal;
  }
  return [...byMonth.entries()].sort().map(([month, v]) => ({ month, ...v }));
}

// ─── TOP 品項（以 SKU 份數計）───────────────────────────────────────────────

export type TopProductEntry = {
  /** productSkuId（null = 未識別，caller 用 getDisplayName 轉顯示名） */
  skuId: string;
  /** 訂單份數（item.quantity 加總）*/
  qty: number;
};

/**
 * Yen 2026-07-17：加上 window。原本完全不過濾時間，UI 卻標「份 · 本月」——
 * 標的是本月、算的是全部，標籤本身就是靜默失效。
 */
export function computeTopProducts(orders: Order[], w: DateWindow): TopProductEntry[] {
  const eligible = eligibleInWindow(orders, w);
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

export function computeChannelShare(orders: Order[], w: DateWindow): ChannelShareEntry[] {
  const eligible = eligibleInWindow(orders, w);
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

export function computeRepeatCustomers(orders: Order[], w: DateWindow): RepeatCustomerStats {
  const eligible = eligibleInWindow(orders, w);
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
 * 資料檢查燈（四項）。內部憲章代號 #1/#2/#9/#10 不對外顯示：
 *
 *   筆數一致  ← #1 總數守恆：所有非 canceled 訂單的 items 都有對到 SKU
 *   金額一致  ← #2 金額對帳：付費通路的訂單都有 grossTotal
 *                （KOL 是免費合作、天生 grossTotal=0，排除在分母外）
 *   無缺漏紀錄 ← #9 消失守恆：disappeared_pending_resolution 計數
 *   無異常異動 ← #10 變動守恆：change_pending_resolution 計數
 *
 * blocking：只有「無缺漏紀錄 / 無異常異動」非綠會擋出爐（見 release-gate.ts）。
 * 「筆數一致 / 金額一致」非綠只是視覺提示、不擋。
 */
// ─── 貨到付款未入帳（#9 2026-08-06）──────────────────────────────────────────

export type CodUnsettledSummary = {
  count: number;
  totalGross: number;
  orderIds: string[];
};

/**
 * 「取貨付款」單可以出貨（見 seller-buy.ts），但金流是否已收要另看
 * snapshot.c5_status 有沒有 flip 成「付款完成」。這裡算的是還沒收到錢的
 * 那批，供儀表板顯示提示卡——不擋任何流程，純資訊。
 */
export function codUnsettledSummary(orders: Order[]): CodUnsettledSummary {
  const unsettled = orders.filter(
    (o) => o.payment_method === "取貨付款" && !o.snapshot.c5_status.includes("付款完成")
  );
  return {
    count: unsettled.length,
    totalGross: unsettled.reduce((s, o) => s + o.revenue.grossTotal, 0),
    orderIds: unsettled.map((o) => o.id),
  };
}

export function computeHealthChecks(orders: Order[]): HealthCheck[] {
  const nonCanceled = orders.filter((o) => o.status !== "canceled");

  // 金額一致：只算「應該有金流」的通路。
  //   KOL 是免費樣品換曝光、天生 grossTotal=0，把它列入分母會永遠報橘燈（就是 2026-07-19 遇到的 bug）。
  //   之後多免費通路（試吃、內部）也加進這個 filter。
  const paidOrders = nonCanceled.filter((o) => o.channel !== "KOL");
  const withAmount = paidOrders.filter((o) => o.revenue.grossTotal > 0).length;
  const paidTotal = paidOrders.length;
  const amountOk = paidTotal === 0 || withAmount === paidTotal;

  // 筆數一致：items 有沒有 productSkuId=null（parser 未識別）
  const brokenItems = nonCanceled.filter((o) =>
    o.items.some((it) => it.productSkuId === null)
  ).length;

  const disappeared = orders.filter(
    (o) => o.status === "disappeared_pending_resolution"
  ).length;

  const changePending = orders.filter(
    (o) => o.status === "change_pending_resolution"
  ).length;

  return [
    {
      label: "筆數一致",
      value: brokenItems === 0 ? "一致" : `${brokenItems} 筆品項未識別`,
      color: brokenItems === 0 ? "#43B23C" : "#E5622A",
    },
    {
      label: "金額一致",
      value: amountOk ? "一致" : `${paidTotal - withAmount} 筆金額為 0`,
      color: amountOk ? "#43B23C" : "#E5622A",
    },
    {
      label: "無缺漏紀錄",
      value: disappeared === 0 ? "無" : `${disappeared} 筆待確認`,
      color: disappeared === 0 ? "#43B23C" : "#E5622A",
    },
    {
      label: "無異常異動",
      value: changePending === 0 ? "無" : `${changePending} 筆待確認`,
      color: changePending === 0 ? "#43B23C" : "#E5622A",
    },
  ];
}
