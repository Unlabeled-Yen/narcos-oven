/**
 * M6.5 排程引擎 v2（純函式、可 Node 測）
 *
 * 依 docs/scheduling-spec-v2.md 實作 RC-1/2/3：
 *   RC-1 wish_priority 分軌（巴斯克 strict / 麵包 flexible + FIFO）
 *   RC-2 前置期 5 天
 *   RC-3 pre-book（strict 訂單先佔位）
 *
 * 憲章：#13 指定日產能預留、#14 最低前置期
 */
import type { Menu, Order } from "./models";
import {
  accumulateAtoms,
  calculateBatchHours,
  estimateOrderHours,
  mergeAtomMaps,
} from "./production-time";

export type ScheduleSuggestionV2 = {
  order_id: string;
  suggested_date: string;
  reason: string;
  wish_priority: "strict" | "flexible" | null;
  customer_wish_date: string | null;
  is_wish_kept: boolean;             // 是否滿足客人 wish
  estimated_hours: number;           // 該訂單獨立時間
  batch_hours_after: number;         // 該日排入後的累積時間
  weekly_budget: number;             // 該日預算
};

export type ScheduleResultV2 = {
  suggestions: ScheduleSuggestionV2[];
  unscheduled: {
    order_id: string;
    reason: string;
    tried_dates: string[];
  }[];
};

/**
 * 主入口
 */
export function suggestScheduleV2(
  orders: Order[],
  menu: Menu,
  today: Date = new Date()
): ScheduleResultV2 {
  const cfg = menu.scheduling ?? {
    lead_time_days: 5,
    regular_shipping_weekday: 2,
    max_retry_weeks: 10,
  };
  const budget =
    menu.weekly_production_budget?.total_hours_max ?? 30;

  // 已排定 (confirmed + batchDate)
  const alreadyScheduled = orders.filter(
    (o) => o.batchDate && (o.status === "confirmed" || o.status === "kol_shipped")
  );

  // 建各批次日的 atom 累積
  const batchAtoms = new Map<string, Map<string, number>>();
  for (const o of alreadyScheduled) {
    const d = o.batchDate!;
    const cur = batchAtoms.get(d) ?? new Map<string, number>();
    batchAtoms.set(d, mergeAtomMaps(cur, accumulateAtoms([o])));
  }

  // Pending 訂單分軌
  const pendingStrict: Order[] = [];
  const pendingFlexible: Order[] = [];
  for (const o of orders) {
    if (o.assignment_source !== "pending") continue;
    if (o.status !== "confirmed" && o.status !== "pending_batch_date") continue;
    // 若 wish_priority=strict 且有 wish_date → 進 strict 桶
    if (o.wish_priority === "strict" && o.customer_wish_date) {
      pendingStrict.push(o);
    } else {
      pendingFlexible.push(o);
    }
  }
  // Flexible FIFO by first_seen_at
  pendingFlexible.sort((a, b) =>
    (a.first_seen_at ?? "").localeCompare(b.first_seen_at ?? "")
  );

  const suggestions: ScheduleSuggestionV2[] = [];
  const unscheduled: ScheduleResultV2["unscheduled"] = [];

  // Phase 1: strict 優先安排（pre-book）
  for (const o of pendingStrict) {
    const orderAtoms = accumulateAtoms([o]);
    const orderHours = estimateOrderHours(o, menu);
    const wishDate = new Date(o.customer_wish_date!);

    // 檢查前置期
    const earliestDate = addDays(today, cfg.lead_time_days);
    let cursor = wishDate;
    let is_wish_kept = true;

    if (cursor < earliestDate) {
      // 太急、順延到下一個週二 ≥ earliestDate
      cursor = nextRegularShippingDate(earliestDate, cfg.regular_shipping_weekday);
      is_wish_kept = false;
    }

    // 嘗試 max_retry_weeks 週
    const tried: string[] = [];
    let placed = false;
    for (let attempt = 0; attempt < cfg.max_retry_weeks; attempt++) {
      const dateStr = fmt(cursor);
      tried.push(dateStr);
      const currentAtoms = batchAtoms.get(dateStr) ?? new Map<string, number>();
      const mergedAtoms = mergeAtomMaps(currentAtoms, orderAtoms);
      const newHours = calculateBatchHours(mergedAtoms, menu);
      if (newHours <= budget) {
        // 放入
        batchAtoms.set(dateStr, mergedAtoms);
        suggestions.push({
          order_id: o.id,
          suggested_date: dateStr,
          reason: attempt === 0 && is_wish_kept
            ? "客人指定日、產能足夠 (strict wish_kept)"
            : attempt === 0
            ? "客人指定日太急、順延到最近可行日"
            : `順延 ${attempt} 週後找到位子`,
          wish_priority: "strict",
          customer_wish_date: o.customer_wish_date,
          is_wish_kept: attempt === 0 && is_wish_kept,
          estimated_hours: orderHours,
          batch_hours_after: newHours,
          weekly_budget: budget,
        });
        placed = true;
        break;
      }
      cursor = addDays(cursor, 7);
      is_wish_kept = false;
    }
    if (!placed) {
      unscheduled.push({
        order_id: o.id,
        reason: "巴斯克 strict 連續 10 週都超載（憲章 #12）",
        tried_dates: tried,
      });
    }
  }

  // Phase 2: flexible FIFO
  const earliestDate = addDays(today, cfg.lead_time_days);
  const startTuesday = nextRegularShippingDate(earliestDate, cfg.regular_shipping_weekday);
  for (const o of pendingFlexible) {
    const orderAtoms = accumulateAtoms([o]);
    const orderHours = estimateOrderHours(o, menu);
    let cursor = new Date(startTuesday);
    const tried: string[] = [];
    let placed = false;
    for (let attempt = 0; attempt < cfg.max_retry_weeks; attempt++) {
      const dateStr = fmt(cursor);
      tried.push(dateStr);
      const currentAtoms = batchAtoms.get(dateStr) ?? new Map<string, number>();
      const mergedAtoms = mergeAtomMaps(currentAtoms, orderAtoms);
      const newHours = calculateBatchHours(mergedAtoms, menu);
      if (newHours <= budget) {
        batchAtoms.set(dateStr, mergedAtoms);
        suggestions.push({
          order_id: o.id,
          suggested_date: dateStr,
          reason: attempt === 0 ? "下次常態批 (flexible FIFO)" : `順延 ${attempt} 週`,
          wish_priority: o.wish_priority,
          customer_wish_date: o.customer_wish_date,
          is_wish_kept: o.customer_wish_date === dateStr,
          estimated_hours: orderHours,
          batch_hours_after: newHours,
          weekly_budget: budget,
        });
        placed = true;
        break;
      }
      cursor = addDays(cursor, 7);
    }
    if (!placed) {
      unscheduled.push({
        order_id: o.id,
        reason: "flexible FIFO 連續 10 週都超載（憲章 #12）",
        tried_dates: tried,
      });
    }
  }

  return { suggestions, unscheduled };
}

// ---- helpers ----

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** 給 from、找 ≥ from 的第一個指定週幾（0=Sun, 2=Tue...）。若 from 就是該週幾就用 from。 */
export function nextRegularShippingDate(from: Date, weekday: number): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const diff = (weekday - dow + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * 套用建議到 orders（產生新 orders 陣列）
 */
export function applyV2Suggestions(
  orders: Order[],
  suggestions: ScheduleSuggestionV2[],
  accepted: Set<string>
): Order[] {
  const sMap = new Map(suggestions.map((s) => [s.order_id, s]));
  return orders.map((o) => {
    if (!accepted.has(o.id)) return o;
    const s = sMap.get(o.id);
    if (!s) return o;
    return {
      ...o,
      batchDate: s.suggested_date,
      system_suggested_date: s.suggested_date,
      assignment_source: s.is_wish_kept ? "customer_wish_kept" : "auto_from_rule",
      estimated_production_hours: s.estimated_hours,
    };
  });
}
