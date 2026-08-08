/**
 * compute-stats.ts — 出爐統計純計算層
 *
 * 從 orders + menu 計算品項(atom) × 批次(batchDate) × 通路 的樞紐矩陣。
 * 不依賴任何 Excel 輸出、不含任何 DOM/React 相依。
 * 與 stats-excel.ts 平行存在，不修改後者。
 */
import type { Menu, Order } from "./models";
import type { DayType } from "./day-type";
import { effectiveShipDate } from "./effective-ship-date";

// ── 通路型別 ─────────────────────────────────────────────────
export type Channel = "賣貨便" | "面交" | "宅配" | "KOL" | "其他";

export const CHANNEL_ORDER: Channel[] = ["賣貨便", "面交", "宅配", "KOL", "其他"];

export const CHANNEL_COLOR: Record<Channel, string> = {
  賣貨便: "#F5D400",
  面交: "#43B23C",
  宅配: "#2AC7E8",
  KOL: "#8557C9",
  其他: "#E5352B",
};

export function normalizeChannel(raw: string): Channel {
  if (raw === "賣貨便") return "賣貨便";
  if (raw.startsWith("面交")) return "面交";
  if (raw === "宅配") return "宅配";
  if (raw === "KOL") return "KOL";
  return "其他";
}

// ── 篩選（同 output/utils 的 ordersForOutput 邏輯，但純函式複製，不 import）─
function isOutputOrder(o: Order): boolean {
  return (
    o.status === "confirmed" ||
    o.status === "kol_shipped" ||
    o.status === "pending_batch_date"
  );
}

/** #6 2026-08-06：批次欄一律用有效出貨日，不是原始 batchDate（同 pendingBatchLabel）*/
function batchLabel(o: Order, dayTypeOf: (iso: string) => DayType): string {
  return effectiveShipDate(o, dayTypeOf) ?? "待老闆排";
}

// ── 核心型別 ──────────────────────────────────────────────────

/** 每個 atom 在每個批次＆通路的顆數 */
export type AtomBatchCounts = {
  /** key: `${batchDate}||${channel}` → count */
  cells: Map<string, number>;
  /** 跨批次+通路的合計 */
  total: number;
};

/** 通路佔比列（帶色條用） */
export type ChannelShare = {
  channel: Channel;
  count: number;
  pct: number; // 0-100
};

/** 批次欄定義 */
export type BatchColumn = {
  batchDate: string;
  /** 該批出現的通路（保持 CHANNEL_ORDER 排序） */
  channels: Channel[];
};

/** compute 結果 */
export type StatsMatrix = {
  /** 排序後的批次欄（batchDate asc，"待老闆排" 放最後） */
  batchColumns: BatchColumn[];

  /**
   * 每個有資料的 atomId 的統計列。
   * 只列 total > 0 的。
   */
  atomRows: Array<{
    atomId: string;
    /** 由 menu.atoms[atomId].unit 取得 */
    unit: string;
    counts: AtomBatchCounts;
  }>;

  /**
   * 每個批次(batchDate)的跨 atom 總顆數
   * key: batchDate → {byChannel: Map<Channel,number>, total: number}
   */
  batchTotals: Map<string, { byChannel: Map<Channel, number>; total: number }>;

  /** 全部訂單加總（用於雙軌驗證卡） */
  grandTotal: number;

  /**
   * 最新批次（batchDate 最大的那欄，pending → undefined）
   * 用於熱區 highlight
   */
  latestBatchDate: string | undefined;

  /**
   * 通路交叉（最新批次的通路佔比）
   * 若無最新批次則為空。
   */
  latestChannelShares: ChannelShare[];
};

// ── 主函式 ───────────────────────────────────────────────────

export function computeStatsMatrix(
  orders: Order[],
  menu: Menu,
  dayTypeOf: (iso: string) => DayType
): StatsMatrix {
  const outputOrders = orders.filter(isOutputOrder);

  // 1. 收集 batchDate → Set<Channel>
  const dateChannels = new Map<string, Set<Channel>>();
  for (const o of outputOrders) {
    const d = batchLabel(o, dayTypeOf);
    const ch = normalizeChannel(o.channel);
    if (!dateChannels.has(d)) dateChannels.set(d, new Set());
    dateChannels.get(d)!.add(ch);
  }

  // 2. batchColumns 排序：ISO 日期 asc，「待老闆排」放最後
  const allDates = [...dateChannels.keys()].sort((a, b) => {
    if (a === "待老闆排") return 1;
    if (b === "待老闆排") return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const batchColumns: BatchColumn[] = allDates.map((d) => ({
    batchDate: d,
    channels: CHANNEL_ORDER.filter((ch) => dateChannels.get(d)?.has(ch)),
  }));

  // 3. 計算 (atom, batchDate, channel) 計數
  const counts = new Map<string, number>(); // key: atomId||batchDate||channel
  for (const o of outputOrders) {
    const d = batchLabel(o, dayTypeOf);
    const ch = normalizeChannel(o.channel);
    for (const it of o.items) {
      for (const a of it.atoms) {
        const key = `${a.atomId}||${d}||${ch}`;
        counts.set(key, (counts.get(key) ?? 0) + a.count);
      }
    }
  }

  // 4. atomRows（依 menu.atoms 順序，filter total > 0）
  const atomIds = Object.keys(menu.atoms);
  const atomRows: StatsMatrix["atomRows"] = [];

  for (const atomId of atomIds) {
    const cells = new Map<string, number>();
    let total = 0;

    for (const col of batchColumns) {
      for (const ch of col.channels) {
        const n = counts.get(`${atomId}||${col.batchDate}||${ch}`) ?? 0;
        if (n > 0) {
          cells.set(`${col.batchDate}||${ch}`, n);
          total += n;
        }
      }
    }

    if (total > 0) {
      atomRows.push({
        atomId,
        unit: menu.atoms[atomId]?.unit ?? "顆",
        counts: { cells, total },
      });
    }
  }

  // 5. batchTotals
  const batchTotals = new Map<string, { byChannel: Map<Channel, number>; total: number }>();
  for (const col of batchColumns) {
    const byChannel = new Map<Channel, number>();
    let bTotal = 0;
    for (const ch of col.channels) {
      let chSum = 0;
      for (const row of atomRows) {
        chSum += row.counts.cells.get(`${col.batchDate}||${ch}`) ?? 0;
      }
      if (chSum > 0) byChannel.set(ch, chSum);
      bTotal += chSum;
    }
    batchTotals.set(col.batchDate, { byChannel, total: bTotal });
  }

  // 6. grandTotal
  const grandTotal = atomRows.reduce((s, r) => s + r.counts.total, 0);

  // 7. latestBatchDate（排除「待老闆排」）
  const realDates = allDates.filter((d) => d !== "待老闆排");
  const latestBatchDate = realDates.at(-1);

  // 8. latestChannelShares
  let latestChannelShares: ChannelShare[] = [];
  if (latestBatchDate) {
    const bt = batchTotals.get(latestBatchDate);
    if (bt && bt.total > 0) {
      latestChannelShares = CHANNEL_ORDER.filter((ch) =>
        bt.byChannel.has(ch)
      ).map((ch) => ({
        channel: ch,
        count: bt.byChannel.get(ch)!,
        pct: Math.round((bt.byChannel.get(ch)! / bt.total) * 100),
      }));
    }
  }

  return {
    batchColumns,
    atomRows,
    batchTotals,
    grandTotal,
    latestBatchDate,
    latestChannelShares,
  };
}
