/**
 * Stage 8 + 9：排程建議引擎 + 產能檢核
 * 對應 docs/spec.md §11.2 + 憲章 #11 #12
 *
 * 演算法（Yen D-6 D-7）：
 *   1. 對每筆 assignment_source='pending' 訂單、找候選日期（下次週二起）
 *   2. 檢查該日累積 atoms 是否會超載
 *   3. 若超載 → 遞進到下週二（最多 10 週、超過就 give up）
 *   4. 產出 suggestions[] 給雇主 review
 *
 * 純函式、可 Node 測。
 */
import type { Menu, Order } from "./models";

export type ScheduleSuggestion = {
  order_id: string;
  suggested_date: string;         // YYYY-MM-DD
  reason: string;                  // 給 UI 顯示
  is_capacity_ok: boolean;         // 該日產能是否 ok
  capacity_overloads: {            // 若 !ok、哪些 atom 超載
    atomId: string;
    would_add: number;
    already_scheduled: number;
    capacity: number;
  }[];
};

export type ScheduleResult = {
  suggestions: ScheduleSuggestion[];
  unscheduled: {                   // 找不到可行日的（連續 10 週都超載）
    order_id: string;
    tried_dates: string[];
  }[];
};

/**
 * 主入口：對所有 assignment_source='pending' 的 confirmed 訂單提排程建議。
 *
 * @param orders 全部訂單（已排 confirmed 的會計入產能累積）
 * @param menu   含 production_capacity
 * @param today  基準日、預設 new Date()（測試時可指定）
 */
export function suggestSchedule(
  orders: Order[],
  menu: Menu,
  today: Date = new Date()
): ScheduleResult {
  const capacity = menu.production_capacity?.daily_max_by_atom ?? {};
  const weekly = menu.production_capacity?.weekly_pattern;

  // 已排定的 (batchDate, atomId) 累積 → 給產能檢核用
  // 只算 confirmed + kol_shipped 且已有 batchDate 的
  const scheduledByDateAtom = new Map<string, Map<string, number>>();
  for (const o of orders) {
    if (!o.batchDate) continue;
    if (o.status !== "confirmed" && o.status !== "kol_shipped") continue;
    const d = o.batchDate;
    if (!scheduledByDateAtom.has(d)) scheduledByDateAtom.set(d, new Map());
    const atomMap = scheduledByDateAtom.get(d)!;
    for (const it of o.items) {
      for (const a of it.atoms) {
        atomMap.set(a.atomId, (atomMap.get(a.atomId) ?? 0) + a.count);
      }
    }
  }

  // Pending 訂單 = 需要排的
  const pending = orders.filter(
    (o) =>
      o.assignment_source === "pending" &&
      (o.status === "confirmed" ||
        o.status === "pending_batch_date" ||
        o.status === "pending_conflict_date")
  );

  const suggestions: ScheduleSuggestion[] = [];
  const unscheduled: ScheduleResult["unscheduled"] = [];

  for (const o of pending) {
    // 該訂單各 atom 累積量
    const orderAtoms = new Map<string, number>();
    for (const it of o.items) {
      for (const a of it.atoms) {
        orderAtoms.set(a.atomId, (orderAtoms.get(a.atomId) ?? 0) + a.count);
      }
    }

    // 從下次週二開始試、遞進 10 週
    let cursor = nextTuesday(today);
    let placed = false;
    const tried: string[] = [];
    for (let week = 0; week < 10; week++) {
      const dateStr = fmt(cursor);
      tried.push(dateStr);
      const scheduled = scheduledByDateAtom.get(dateStr) ?? new Map();
      const overloads: ScheduleSuggestion["capacity_overloads"] = [];
      const weekdayMul = weekly ? weekly[weekdayKey(cursor)] ?? 1 : 1;
      for (const [atomId, would] of orderAtoms) {
        const capA = (capacity[atomId] ?? Infinity) * weekdayMul;
        const already = scheduled.get(atomId) ?? 0;
        if (already + would > capA) {
          overloads.push({
            atomId,
            would_add: would,
            already_scheduled: already,
            capacity: capA,
          });
        }
      }
      if (overloads.length === 0) {
        // 排入！先在累積表模擬更新（讓下一筆知道這筆佔了）
        if (!scheduledByDateAtom.has(dateStr))
          scheduledByDateAtom.set(dateStr, new Map());
        const atomMap = scheduledByDateAtom.get(dateStr)!;
        for (const [atomId, n] of orderAtoms) {
          atomMap.set(atomId, (atomMap.get(atomId) ?? 0) + n);
        }
        suggestions.push({
          order_id: o.id,
          suggested_date: dateStr,
          reason: week === 0
            ? "下次週二 (D-6 預設規則)"
            : `下次週二超載、順延到 ${week + 1} 週後`,
          is_capacity_ok: true,
          capacity_overloads: [],
        });
        placed = true;
        break;
      }
      // 換下一週
      cursor = addDays(cursor, 7);
    }
    if (!placed) {
      unscheduled.push({ order_id: o.id, tried_dates: tried });
    }
  }

  return { suggestions, unscheduled };
}

// ---- helpers ----

export function nextTuesday(from: Date): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=Sun, 1=Mon, 2=Tue
  const daysUntilTue = (2 - dow + 7) % 7;
  // 若今天就是週二、算下週二（不然雇主當天 pending 立刻排今天太急）
  const add = daysUntilTue === 0 ? 7 : daysUntilTue;
  d.setDate(d.getDate() + add);
  return d;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekdayKey(d: Date): keyof NonNullable<Menu["production_capacity"]>["weekly_pattern"] {
  const keys = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
  return keys[d.getDay()] as keyof NonNullable<Menu["production_capacity"]>["weekly_pattern"];
}

/**
 * 應用排程建議：把 suggestions[] 寫回 orders（產生新 orders 陣列）。
 * @param orders 原本 orders
 * @param resolutions 雇主拍板：{ order_id: 'accept' | 'reject' | 'override_to_YYYY-MM-DD' }
 */
export function applySuggestions(
  orders: Order[],
  suggestions: ScheduleSuggestion[],
  resolutions: Record<string, "accept" | "reject" | string>
): Order[] {
  const suggestMap = new Map(suggestions.map((s) => [s.order_id, s]));
  return orders.map((o) => {
    const decision = resolutions[o.id];
    if (!decision) return o;
    const s = suggestMap.get(o.id);
    if (decision === "reject") return o;
    if (decision === "accept" && s) {
      return {
        ...o,
        batchDate: s.suggested_date,
        system_suggested_date: s.suggested_date,
        assignment_source: "auto_from_rule",
      };
    }
    // override: decision 是 date string
    if (/^\d{4}-\d{2}-\d{2}$/.test(decision)) {
      return {
        ...o,
        batchDate: decision,
        assignment_source: "boss_override",
      };
    }
    return o;
  });
}
