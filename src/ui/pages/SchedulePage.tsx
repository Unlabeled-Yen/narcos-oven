/**
 * SchedulePage — 排程週檢視 + 拖拉排單（P4, Opus 親做）
 *
 * 憲章落實：
 *   #11 排程雇主拍板守恆：拖入某出貨日 = 寫 assignment_source="boss_scheduled"，人拍板才進主軌。
 *   #12 產能超載守恆：拖入使當日工時 > 週預算 → 紅色 loud 警示 + 需二次確認才持久化（絕不靜默排入）。
 *   #14 最低前置期：拖到 < lead_time_days（預設 5 天）→ 警示。
 * 主軌 0 LLM。所有數字由 domain（production-time.ts）即時算。
 */
import { useEffect, useMemo, useState } from "react";
import type { Menu, Order } from "../../domain/models";
import { getDisplayName } from "../../domain/menu";
import { accumulateAtoms } from "../../domain/production-time";
import { upsertOrder, clearAll } from "../../db/orders";
import { isDayLocked, setDayLocked } from "../../db/week-locks";
import type { PageProps } from "./types";

const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
};
const WD = ["日", "一", "二", "三", "四", "五", "六"];

// ── 日期 helpers ─────────────────────────────────────────
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function mdOf(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${m}/${d}`;
}
/**
 * 防禦性顯示日期字串（處理非 ISO 舊資料，避免 UI 出現 undefined/undefined）
 * 接受：YYYY-MM-DD / YYYY/MM/DD / MM/DD / Date serial / 其他 → 用 fallback。
 */
function formatDateShort(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  const s = String(raw);
  // ISO YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}/${iso[3]}`;
  // YYYY/MM/DD
  const slash = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slash) return `${slash[2].padStart(2, "0")}/${slash[3].padStart(2, "0")}`;
  // MM/DD or M/D
  const md = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md) return `${md[1].padStart(2, "0")}/${md[2].padStart(2, "0")}`;
  // 其他格式 → 原樣顯示（不騙用戶）
  return s;
}
function mondayOf(ref: Date, weekOffset: number): Date {
  const d = new Date(ref);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=Sun
  const diff = (dow + 6) % 7; // 到週一的距離
  d.setDate(d.getDate() - diff + weekOffset * 7);
  return d;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// 需排程的訂單（待排）：主軌 confirmed / pending_batch_date 且尚未由雇主拍板日期
function isPendingSchedule(o: Order): boolean {
  const schedulable = o.status === "confirmed" || o.status === "pending_batch_date";
  return schedulable && (o.assignment_source === "pending" || o.batchDate === null);
}

export function SchedulePage({ orders, menu, refreshOrders }: PageProps) {
  const [viewMode, setViewMode] = useState<"week" | "month">("week");
  const [diagOpen, setDiagOpen] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);

  // Yen 2026-07-04：dragId 有值時 · window 全域 dragover preventDefault
  //   讓瀏覽器認為所有位置都 accept drop · 拿掉「殘影飛回原位」動畫
  //   訂單拖曳（非檔案）才啟用 · 不影響拖檔上傳
  useEffect(() => {
    if (!dragId) return;
    const onWinDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", onWinDragOver);
    return () => window.removeEventListener("dragover", onWinDragOver);
  }, [dragId]);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  // Yen 2026-07-03：整週鎖 · locked → 卡片唯讀、禁拖、日欄 header 禁切換
  const [lockTick, setLockTick] = useState(0); // 強制重讀 localStorage
  const cycleLock = () => setLockTick((n) => n + 1);

  const today = useMemo(() => new Date(), []);

  const monday = useMemo(() => mondayOf(today, weekOffset), [today, weekOffset]);
  const week = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(monday, i)),
    [monday]
  );
  const weekISO = week.map(toISO);
  // Yen 2026-07-04：改為單日鎖 · dayLocked(iso) 每個 shipping day 各自鎖
  //   lockTick 強制重讀 localStorage
  const dayLocked = (iso: string) => {
    void lockTick;
    return isDayLocked(iso);
  };
  function toggleDayLock(iso: string) {
    setDayLocked(iso, !isDayLocked(iso));
    cycleLock();
  }
  // 給拖曳 handler 用：任何 shipping day 有鎖就視為 locked
  const anyShipDayLocked = () => weekISO.some((iso) => dayLocked(iso));

  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  // 各日已排訂單（含跨週查詢：允許 anchor 往前掃到上週工作日）
  // Yen 2026-07-06：shipped 從排程消失 · 只在訂單總覽看得到
  const assignedByDay = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const iso of weekISO) m.set(iso, []); // 本週 preload 空陣列 · 給週檢視 render 用
    for (const o of orders) {
      if (o.batchDate && o.assignment_source !== "pending" && o.status !== "shipped") {
        if (!m.has(o.batchDate)) m.set(o.batchDate, []);
        m.get(o.batchDate)!.push(o);
      }
    }
    return m;
  }, [orders, weekISO.join(",")]);

  const pending = useMemo(() => orders.filter(isPendingSchedule), [orders]);

  // 診斷：待排（排程頁）vs 待處理桶 差集 · 訂單分佈 · confirmed 去向
  const diag = useMemo(() => {
    const bucket = orders.filter((o) =>
      o.status.startsWith("pending_") ||
      o.status === "change_pending_resolution" ||
      o.status === "disappeared_pending_resolution"
    );
    const wait = orders.filter((o) =>
      (o.status === "confirmed" || o.status === "pending_batch_date") &&
      (o.assignment_source === "pending" || o.batchDate === null)
    );
    const bSet = new Set(bucket.map((o) => o.id));
    const wSet = new Set(wait.map((o) => o.id));

    // 訂單分佈總覽（互斥分類、Σ = 全部訂單）
    const shipped = orders.filter((o) => o.status === "shipped" || o.status === "kol_shipped");
    const canceled = orders.filter((o) => o.status === "canceled");
    const confirmedAll = orders.filter((o) => o.status === "confirmed");
    const confirmedScheduled = confirmedAll.filter(
      (o) => o.batchDate !== null && o.assignment_source !== "pending"
    );
    const confirmedUnscheduled = confirmedAll.filter(
      (o) => o.batchDate === null || o.assignment_source === "pending"
    );
    // confirmed 已排入的按 batchDate 分佈（給 Yen 找他的 confirmed 訂單去了哪些日子）
    const confirmedByDate = new Map<string, Order[]>();
    for (const o of confirmedScheduled) {
      const d = o.batchDate!;
      const arr = confirmedByDate.get(d) ?? [];
      arr.push(o);
      confirmedByDate.set(d, arr);
    }
    const confirmedDateRows = [...confirmedByDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, list]) => ({ date, count: list.length }));

    // status × assignment_source 交叉分佈（快速看整體卡在哪裡）
    const crossTable = new Map<string, number>();
    for (const o of orders) {
      const key = `${o.status}|${o.assignment_source ?? "null"}|${o.batchDate ? "有date" : "無date"}`;
      crossTable.set(key, (crossTable.get(key) ?? 0) + 1);
    }
    const crossRows = [...crossTable.entries()]
      .map(([key, n]) => {
        const [status, source, hasDate] = key.split("|");
        return { status: status!, source: source!, hasDate: hasDate!, n };
      })
      .sort((a, b) => b.n - a.n);

    // 靜默失效偵測：batchDate 非 ISO YYYY-MM-DD 的訂單（例如 "下次週二"）
    const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
    const dirtyBatchDate = orders.filter(
      (o) => o.batchDate !== null && !ISO_RE.test(o.batchDate)
    );

    // orphanWithWish + 一鍵自動排 已於 2026-07-03 拿掉
    //   Yen 決策：不再要「指定日自動排」· 全部由雇主手動拖入拍板
    const orphanWithWish: typeof orders = [];

    // 新政策清理：既存 pending_batch_date 訂單（只因為 MISSING_BATCH_DATE 卡在待處理桶）
    // → 直接轉 confirmed + 清 MISSING_BATCH_DATE reason，進待排列表等雇主拖入
    const legacyMissingDate = orders.filter(
      (o) =>
        o.status === "pending_batch_date" &&
        o.pendingReasons.some((r) => r.code === "MISSING_BATCH_DATE")
    );

    // customer_wish_date 原始值格式分佈（幫 Yen 排查非 ISO 髒資料造成的 undefined 顯示）
    const wishFormatCount = new Map<string, number>();
    const nonIsoWishSamples: { id: string; raw: string }[] = [];
    for (const o of orders) {
      if (!o.customer_wish_date) continue;
      const s = String(o.customer_wish_date);
      let format = "其他";
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) format = "YYYY-MM-DD (ISO)";
      else if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) format = "YYYY/MM/DD";
      else if (/^\d{1,2}\/\d{1,2}$/.test(s)) format = "MM/DD";
      else if (/^\d+$/.test(s)) format = "純數字（Excel serial?）";
      wishFormatCount.set(format, (wishFormatCount.get(format) ?? 0) + 1);
      if (format !== "YYYY-MM-DD (ISO)" && nonIsoWishSamples.length < 6) {
        nonIsoWishSamples.push({ id: o.id, raw: s });
      }
    }
    const wishFormatRows = [...wishFormatCount.entries()].map(([format, n]) => ({ format, n }));

    return {
      total: orders.length,
      waitCount: wait.length,
      bucketCount: bucket.length,
      inWaitOnly: wait.filter((o) => !bSet.has(o.id)),
      inBucketOnly: bucket.filter((o) => !wSet.has(o.id)),
      // 分佈
      shippedCount: shipped.length,
      canceledCount: canceled.length,
      confirmedTotalCount: confirmedAll.length,
      confirmedScheduledCount: confirmedScheduled.length,
      confirmedUnscheduledCount: confirmedUnscheduled.length,
      confirmedDateRows,
      crossRows,
      dirtyBatchDate,
      orphanWithWish,
      legacyMissingDate,
      wishFormatRows,
      nonIsoWishSamples,
    };
  }, [orders]);

  // 一鍵修復：把 batchDate 非 ISO 的訂單退回待排
  const [fixing, setFixing] = useState(false);
  async function fixDirtyBatchDate() {
    if (fixing || diag.dirtyBatchDate.length === 0) return;
    if (!confirm(`確定退回 ${diag.dirtyBatchDate.length} 單（batchDate 非 ISO）到待排？`)) return;
    setFixing(true);
    try {
      for (const o of diag.dirtyBatchDate) {
        await upsertOrder({
          ...o,
          batchDate: null,
          assignment_source: "pending",
          estimated_production_hours: null,
        });
      }
      await refreshOrders();
    } finally {
      setFixing(false);
    }
  }

  // 一鍵清理：既存 MISSING_BATCH_DATE 資料 → confirmed（新政策：無日期直接進待排）
  const [cleaningLegacy, setCleaningLegacy] = useState(false);
  async function cleanLegacyMissingDate() {
    if (cleaningLegacy || diag.legacyMissingDate.length === 0) return;
    if (!confirm(`確定清理 ${diag.legacyMissingDate.length} 單（既存 MISSING_BATCH_DATE reason）？\n新政策：無指定日不再需要處理、直接在待排列表按順序等排。\n這些單將轉 confirmed、reason 清除、進待排。`)) return;
    setCleaningLegacy(true);
    try {
      for (const o of diag.legacyMissingDate) {
        const filteredReasons = o.pendingReasons.filter((r) => r.code !== "MISSING_BATCH_DATE");
        await upsertOrder({
          ...o,
          pendingReasons: filteredReasons,
          status: filteredReasons.length === 0 ? "confirmed" : o.status,
        });
      }
      await refreshOrders();
    } finally {
      setCleaningLegacy(false);
    }
  }

  // 清空所有訂單資料（重新測試用 · inline 二次確認、不依賴 browser dialog）
  const [wiping, setWiping] = useState(false);
  const [wipeMode, setWipeMode] = useState<"idle" | "arm" | "done">("idle");
  const [wipeInput, setWipeInput] = useState("");
  async function executeWipe() {
    if (wiping) return;
    if (wipeInput.trim() !== "清空") return; // guard
    setWiping(true);
    try {
      await clearAll();
      await refreshOrders();
      setWipeMode("done");
      setWipeInput("");
      // 3 秒後自動 reset
      setTimeout(() => setWipeMode("idle"), 3000);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[wipeAllData]", err);
      alert(`✗ 清空失敗：${(err as Error).message}`);
    } finally {
      setWiping(false);
    }
  }

  // 「一鍵自動排孤兒 wish_date」handler 已於 2026-07-03 拿掉（Yen 決策不再自動排指定日）

  // 待排訂單分頁 + 搜尋（供雇主插單搜尋）
  const [pendingTab, setPendingTab] = useState<"all" | "賣貨便" | "KOL" | "面交" | "指定日">("all");
  const [pendingQuery, setPendingQuery] = useState("");
  const pendingFiltered = useMemo(() => {
    const q = pendingQuery.trim().toLowerCase();
    const list = pending.filter((o) => {
      if (pendingTab === "賣貨便" && o.channel !== "賣貨便") return false;
      if (pendingTab === "KOL" && o.channel !== "KOL") return false;
      if (pendingTab === "面交" && !o.channel.startsWith("面交")) return false;
      if (pendingTab === "指定日" && !o.customer_wish_date) return false;
      if (!q) return true;
      // 搜尋：訂單編號、收件人、IG、品項顯示名、指定日
      const hay = [
        o.id,
        o.recipient.name ?? "",
        o.recipient.igOrLine ?? "",
        o.customer_wish_date ?? "",
        ...o.items.map((it) => it.productSkuId ? getDisplayName(it.productSkuId, menu) : it.rawName),
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
    // 排序：所有分頁一律「按下單日期升冪」（先入先排）
    // order_date 若 null（KOL 或舊資料）用 first_seen_at 當 fallback
    return [...list].sort((a, b) => {
      const ao = a.order_date ?? a.first_seen_at ?? "";
      const bo = b.order_date ?? b.first_seen_at ?? "";
      const cmp = ao.localeCompare(bo);
      if (cmp !== 0) return cmp;
      return a.id.localeCompare(b.id);
    });
  }, [pending, pendingTab, pendingQuery, menu]);
  const pendingCounts = useMemo(() => ({
    all: pending.length,
    賣貨便: pending.filter((o) => o.channel === "賣貨便").length,
    KOL: pending.filter((o) => o.channel === "KOL").length,
    面交: pending.filter((o) => o.channel.startsWith("面交")).length,
    指定日: pending.filter((o) => !!o.customer_wish_date).length,
  }), [pending]);

  // 全部有日期的訂單（月曆計數用）· Yen 2026-07-06：shipped 排除
  const ordersByDate = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of orders) {
      if (o.batchDate && o.assignment_source !== "pending" && o.status !== "shipped") {
        (m.get(o.batchDate) ?? m.set(o.batchDate, []).get(o.batchDate)!).push(o);
      }
    }
    return m;
  }, [orders]);

  // 月曆：含當月的完整週列（週一起始）
  const monthInfo = useMemo(() => {
    const base = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    const y = base.getFullYear();
    const mo = base.getMonth();
    const firstMon = mondayOf(new Date(y, mo, 1), 0);
    const weeks: Date[][] = [];
    let cur = new Date(firstMon);
    for (let w = 0; w < 6; w++) {
      const row = Array.from({ length: 7 }, (_, i) => addDays(cur, i));
      weeks.push(row);
      cur = addDays(cur, 7);
      // 若整週都超過當月且已排過當月最後一天、可提早停
      if (row[0]!.getMonth() > mo && row[0]!.getFullYear() >= y) break;
    }
    return { year: y, month: mo, weeks };
  }, [today, monthOffset]);

  // dayAtomBreakdown 已於 2026-07-04 拿掉（雇主流程不需要按日 breakdown）

  // 拖放持久化（憲章 #11 拍板）
  async function commitAssign(id: string, toISO: string | null) {
    const o = orderById.get(id);
    if (!o) return;
    const updated: Order =
      toISO === null
        ? { ...o, batchDate: null, system_suggested_date: null, assignment_source: "pending" }
        : {
            ...o,
            batchDate: toISO,
            assignment_source: "boss_scheduled", // 憲章 #11：雇主拍板
          };
    await upsertOrder(updated);
    await refreshOrders();
  }

  function attemptDrop(id: string, toISOorPending: string) {
    setOverDay(null);
    const o = orderById.get(id);
    if (!o) return;
    if (toISOorPending === "pending") {
      void commitAssign(id, null);
      return;
    }
    const toISO = toISOorPending;
    if (o.batchDate === toISO) return;
    // Yen 決策：拿掉排程確認置入通知（原憲章 #12/#14 二次確認 modal）
    // 若後續要恢復警示、可用 warn banner（不 block）方式取代
    void commitAssign(id, toISO);
  }

  // 主出貨日（本週的週二，getDay===2）
  // 排程規則（具體日期層級）· Yen 新政策：每一天彈性獨立、點日 X 只影響 X
  // 不再用「星期幾規則」讓所有同名星期幾自動套用同類型
  // 存 localStorage：{ "2026-07-03": "ship" | "work" | "rest", ... }
  // 沒 override 的日期 → 回退 menu.scheduling 的星期幾預設（menu.yaml 可設模板）
  //                   → 兩者都無 → 預設「工作」
  type DayType = "ship" | "work" | "rest";
  const [dayOverrides, setDayOverrides] = useState<Record<string, DayType>>(() => {
    try { return JSON.parse(localStorage.getItem("narcos-day-overrides") ?? "{}"); }
    catch { return {}; }
  });
  // 舊 star-based override：靜默清、避免混淆（本輪政策改變）
  useEffect(() => {
    try { localStorage.removeItem("narcos-schedule-rule"); }
    catch { /* noop */ }
  }, []);

  const menuShippingWeekdays = new Set(menu.scheduling?.shipping_weekdays ?? [2]);
  const menuWorkingWeekdays = new Set(menu.scheduling?.working_weekdays ?? [0,1,2,3,4,5,6]);
  function dayTypeOf(iso: string): DayType {
    if (iso in dayOverrides) return dayOverrides[iso]!;
    const wd = new Date(iso).getDay();
    if (menuShippingWeekdays.has(wd)) return "ship";
    if (menuWorkingWeekdays.has(wd)) return "work";
    return "rest";
  }

  // 點日欄 header 三態循環 · 只 override 那一天
  function cycleDayType(iso: string) {
    const cur = dayTypeOf(iso);
    const next: DayType = cur === "rest" ? "work" : cur === "work" ? "ship" : "rest";
    const nextOverrides = { ...dayOverrides, [iso]: next };
    setDayOverrides(nextOverrides);
    try { localStorage.setItem("narcos-day-overrides", JSON.stringify(nextOverrides)); }
    catch { /* quota、無害 */ }
  }
  // resetRuleOverride / hasOverrides 已於 2026-07-04 拿掉（Yen 決策 · 沒有清 N 筆 button）

  // 當週批次 range = 本週最後 shipping 為 anchor · 往前掃到上一個 shipping break
  //   工作日納入 · 出貨日納入（本週有多個 shipping 時前面也算）· 休息日跳過但繼續掃
  //   Range 可跨到上週（含上週工作日六日直到上週出貨日）
  //   例：本週 shipping=[06/30] · anchor=06/30
  //       06/29(rest·跳) 06/28(work·加) 06/27(work·加) 06/26(rest·跳) 06/25(work·加) 06/24(work·加) 06/23(ship·break)
  //       Range = [06/24, 06/25, 06/27, 06/28, 06/30]
  // 本週所有 shipping days · UI grid 主要 render 這些 cell
  const shippingDaysThisWeek = useMemo(
    () => weekISO.filter((iso) => dayTypeOf(iso) === "ship"),
    [weekISO.join(","), dayOverrides, menu.scheduling?.shipping_weekdays]
  );

  const currentBatchRangeISO = useMemo(() => {
    const shipsInWeek = shippingDaysThisWeek;
    if (shipsInWeek.length === 0) return [];
    const anchor = shipsInWeek[shipsInWeek.length - 1]!;
    const range: string[] = [anchor];
    let sawWork = false;
    const d = new Date(anchor);
    for (let i = 1; i < 30; i++) {
      d.setDate(d.getDate() - 1);
      const iso = toISO(d);
      const t = dayTypeOf(iso);
      if (t === "ship") {
        // 見過 work 之後才遇 ship = 前一批 anchor · break
        // 沒見過 work（連續 ship 段）= 這批的 ship day · 納入
        if (sawWork) break;
        range.unshift(iso);
        continue;
      }
      if (t === "work") {
        range.unshift(iso);
        sawWork = true;
        continue;
      }
      // rest：跳過但繼續往前掃
    }
    return range;
  }, [weekISO.join(","), dayOverrides, menu.scheduling?.shipping_weekdays, menu.scheduling?.working_weekdays]);
  const currentBatchOrders = useMemo(() => {
    if (currentBatchRangeISO.length === 0) return [];
    const rangeSet = new Set(currentBatchRangeISO);
    return orders.filter(
      (o) => o.batchDate && o.assignment_source !== "pending" && o.status !== "shipped" && rangeSet.has(o.batchDate)
    );
  }, [orders, currentBatchRangeISO]);
  const currentBatchOrderCount = currentBatchOrders.length;
  const currentBatchBreakdown = useMemo(() => {
    if (currentBatchOrders.length === 0) return [];
    return [...accumulateAtoms(currentBatchOrders).entries()]
      .filter(([, q]) => q > 0)
      .map(([atom, qty]) => ({ atom, qty }))
      .sort((a, b) => b.qty - a.qty);
  }, [currentBatchOrders]);
  const currentBatchTotal = currentBatchBreakdown.reduce((s, r) => s + r.qty, 0);
  const currentBatchAnchor = currentBatchRangeISO[currentBatchRangeISO.length - 1] ?? null;

  // 內嵌工具列（月/週切換 + range + 上週本週下週 + 診斷）· 週用挪入 grid header · 拿掉頂端獨立工具列讓 grid 拉高
  const toolbarNav = (
    <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
      <div className="flex" style={{ gap: 2 }}>
        <button type="button" onClick={() => setViewMode("month")} style={viewMode === "month" ? btnActive : btn}>月</button>
        <button type="button" onClick={() => setViewMode("week")} style={viewMode === "week" ? btnActive : btn}>週</button>
      </div>
      {viewMode === "week" ? (
        <>
          <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 14, color: "#8A8A93" }}>
            {mdOf(weekISO[0])}–{mdOf(weekISO[6])}
          </span>
          <div className="flex" style={{ gap: 2 }}>
            <button type="button" onClick={() => setWeekOffset((w) => w - 1)} style={btn}>‹ 上週</button>
            <button type="button" onClick={() => setWeekOffset(0)} style={weekOffset === 0 ? btnActive : btn}>本週</button>
            <button type="button" onClick={() => setWeekOffset((w) => w + 1)} style={btn}>下週 ›</button>
          </div>
        </>
      ) : (
        <>
          <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 14, color: "#8A8A93" }}>
            {monthInfo.year} / {String(monthInfo.month + 1).padStart(2, "0")}
          </span>
          <div className="flex" style={{ gap: 2 }}>
            <button type="button" onClick={() => setMonthOffset((m) => m - 1)} style={btn}>‹ 上月</button>
            <button type="button" onClick={() => setMonthOffset(0)} style={monthOffset === 0 ? btnActive : btn}>本月</button>
            <button type="button" onClick={() => setMonthOffset((m) => m + 1)} style={btn}>下月 ›</button>
          </div>
        </>
      )}
      <button
        type="button"
        onClick={() => setDiagOpen(true)}
        title="診斷 待排 vs 待處理桶"
        style={{ fontFamily: F.mono, fontSize: 10, color: "#8A8A93", background: "transparent", border: "1px solid #3a3a40", padding: "4px 8px", cursor: "pointer", letterSpacing: ".1em" }}
      >
        🩺 診斷
      </button>
    </div>
  );

  return (
    <div
      className="h-full flex flex-col min-h-0"
      /* 舊 root onDragOver/onDrop 拿掉 · 已由每張卡片 onDragEnd (dropEffect="none") 全域覆蓋 · 含 nav 位置 */
    >
      {/* 頂端獨立工具列已拿掉（Yen 2026-07-03）· 內容挪入 week-grid / month header 條 · 排程板塊拉高 */}
      {warn && (
        <div className="mx-6 mt-2 px-4 py-3 flex items-center justify-between" style={{ background: "#2a1010", border: "1px solid #E5352B" }}>
          <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#E5352B" }}>⚠ {warn}</span>
          <button type="button" onClick={() => setWarn(null)} style={{ fontFamily: F.mono, fontSize: 11, color: "#8A8A93", cursor: "pointer" }}>✕</button>
        </div>
      )}

      {/* 內容區：月/週檢視 */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {viewMode === "month" ? (
        <div className="px-6 py-2" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ background: "#0F0F12", border: "1px solid #26262C", padding: 16, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div className="flex justify-between items-center flex-wrap" style={{ marginBottom: 10, gap: 8, flexShrink: 0 }}>
              {toolbarNav}
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <MonthCalendar
                weeks={monthInfo.weeks}
                month={monthInfo.month}
                today={today}
                ordersByDate={ordersByDate}
                menu={menu}
                onPickDay={(d) => { setViewMode("week"); setWeekOffset(weekOffsetForDate(d, today)); }}
              />
            </div>
          </div>
        </div>
      ) : (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="px-6 py-2" style={{ display: "grid", gridTemplateColumns: "2.7fr 1fr", gridTemplateRows: "minmax(0, 1fr)", gap: 12, flex: 1, minHeight: 0 }}>
        {/* WEEK GRID */}
        <div style={{ background: "#0F0F12", border: "1px solid #26262C", padding: 16, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {/* Grid header 條：只保留 toolbarNav · Yen 2026-07-04 拿掉「清 N 自訂」+「鎖定本週」
              · 鎖定改為 per shipping day · 加在每個出貨批 cell 頂端 */}
          <div className="flex justify-between items-center flex-wrap" style={{ marginBottom: 10, gap: 8, flexShrink: 0 }}>
            {toolbarNav}
          </div>

          {/* Yen 2026-07-04 決策：拿掉工作日日欄、只留出貨日 cell + 本週匯集桶
              上方 7 天 chip row 讓雇主快速設出貨日 · 主 grid 只 render shipping days */}
          <div className="flex flex-wrap" style={{ gap: 4, marginBottom: 8, flexShrink: 0 }}>
            {week.map((d) => {
              const iso = toISO(d);
              const t = dayTypeOf(iso);
              const isShip = t === "ship";
              const locked = isShip && dayLocked(iso);
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={locked ? undefined : () => cycleDayType(iso)}
                  disabled={locked}
                  title={locked ? "🔒 此出貨日已鎖定 · 先解鎖" : "點擊：休息 → 工作 → 出貨"}
                  style={{
                    fontFamily: F.mono, fontSize: 10, letterSpacing: ".05em",
                    padding: "5px 10px",
                    color: isShip ? "#111" : "#8A8A93",
                    background: isShip ? "var(--acc,#F5D400)" : "transparent",
                    border: `1px solid ${isShip ? "var(--acc,#F5D400)" : "#3a3a40"}`,
                    cursor: locked ? "not-allowed" : "pointer",
                    fontWeight: isShip ? 900 : 400,
                  }}
                >
                  {WD[d.getDay()]} {d.getDate()}{isShip ? " · 出貨" : ""}{locked ? " · 🔒" : ""}
                </button>
              );
            })}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(shippingDaysThisWeek.length, 1)},1fr)`, gap: 8, flex: 1, minHeight: 0 }}>
            {shippingDaysThisWeek.length === 0 ? (
              <div style={{ background: "#0F0F12", border: "1px dashed #26262C", padding: 24, textAlign: "center", fontFamily: F.mono, fontSize: 12, color: "#6C6C74", display: "flex", alignItems: "center", justifyContent: "center" }}>
                本週無出貨日 · 點上方 7 天 chip 標一天為「出貨」開始匯集訂單
              </div>
            ) : shippingDaysThisWeek.map((iso) => {
              const d = new Date(iso);
              const list = assignedByDay.get(iso) ?? [];
              const isOver = overDay === iso;
              const locked = dayLocked(iso);
              return (
                <div
                  key={iso}
                  style={{
                    background: "#1c1600",
                    border: "2px solid var(--acc,#F5D400)",
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    boxShadow: "0 0 0 3px rgba(245,212,0,.12)",
                  }}
                >
                  <div style={{ padding: "8px 12px", background: "var(--acc,#F5D400)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: "#111" }}>
                      {mdOf(iso)} · {WD[d.getDay()]} · 出貨批
                    </span>
                    <div className="flex items-center" style={{ gap: 8 }}>
                      <span className="flex items-baseline" style={{ gap: 4 }}>
                        <span style={{ fontFamily: F.anton, fontSize: 18, color: "#111" }}>{list.length}</span>
                        <span style={{ fontFamily: F.mono, fontSize: 10, color: "#111" }}>單</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleDayLock(iso)}
                        title={locked ? `解鎖 ${mdOf(iso)}` : `鎖定 ${mdOf(iso)} · 排定後防手殘`}
                        style={{
                          fontFamily: F.mono, fontSize: 11,
                          color: locked ? "#F5D400" : "#111",
                          background: locked ? "#111" : "transparent",
                          border: `1.5px solid #111`,
                          padding: "2px 8px", cursor: "pointer", lineHeight: 1,
                        }}
                      >
                        {locked ? "🔒" : "🔓"}
                      </button>
                    </div>
                  </div>

                  <div
                    data-day={locked ? undefined : iso}
                    onDragOver={locked ? undefined : (e) => { e.preventDefault(); setOverDay(iso); }}
                    onDragLeave={locked ? undefined : () => setOverDay((x) => (x === iso ? null : x))}
                    onDrop={locked ? undefined : (e) => { e.preventDefault(); if (dragId) attemptDrop(dragId, iso); }}
                    style={{
                      flex: 1,
                      minHeight: 0,
                      overflowY: "auto",
                      margin: 8,
                      border: `1.5px dashed #4a3f00`,
                      padding: 6,
                      display: "flex",
                      flexDirection: "column",
                      gap: 5,
                      background: isOver ? "rgba(245,212,0,0.08)" : undefined,
                    }}
                  >
                    {list.map((o) => {
                      const items = o.items.map((it) => {
                        const name = it.productSkuId
                          ? (menu.products[it.productSkuId]?.display_name ?? it.rawName)
                          : it.rawName;
                        return it.quantity > 1 ? `${name}×${it.quantity}` : name;
                      });
                      const chLabel = o.channel.replace(/^面交_/, "面交·");
                      return (
                        <div
                          key={o.id}
                          draggable={!locked}
                          onDragStart={locked ? undefined : () => setDragId(o.id)}
                          onDragEnd={locked ? undefined : (e) => {
                            const target = document.elementFromPoint(e.clientX, e.clientY);
                            const inZone = target?.closest?.("[data-day]");
                            if (!inZone) void commitAssign(o.id, null);
                            setDragId(null);
                            setOverDay(null);
                          }}
                          title={locked ? `🔒 ${mdOf(iso)} 已鎖 · ${o.id}` : o.id}
                          style={{
                            cursor: locked ? "not-allowed" : "grab",
                            background: "#241c00",
                            border: "1px solid #4a3f00",
                            borderLeft: "3px solid var(--acc,#F5D400)",
                            padding: "6px 8px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 3,
                            opacity: dragId === o.id ? 0.35 : 1,
                          }}
                        >
                          {/* 頂行：訂單編號（截短）· 收件人 · 標籤數 */}
                          <div className="flex items-baseline justify-between" style={{ gap: 6 }}>
                            <div className="flex items-baseline" style={{ gap: 6, minWidth: 0 }}>
                              <span style={{ fontFamily: F.mono, fontSize: 9, color: "#7a6600", letterSpacing: ".02em" }}>
                                {o.id.length > 10 ? o.id.slice(-8) : o.id}
                              </span>
                              {o.recipient.name && (
                                <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 11, color: "#F5F4EF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {o.recipient.name}
                                </span>
                              )}
                            </div>
                            <span className="flex items-baseline" style={{ gap: 2, flexShrink: 0 }}>
                              <span style={{ fontFamily: F.anton, fontSize: 13, color: "var(--acc,#F5D400)", lineHeight: 1 }}>{o.labelCount}</span>
                              <span style={{ fontFamily: F.mono, fontSize: 8, color: "#7a6600" }}>張</span>
                            </span>
                          </div>
                          {/* 品項（全列 · 用 · 分隔） */}
                          <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 10, color: "#E7E7EA", lineHeight: 1.3 }}>
                            {items.join(" · ")}
                          </div>
                          {/* 底行：通路 · 金額 */}
                          <div className="flex items-baseline justify-between" style={{ gap: 6 }}>
                            <span style={{ fontFamily: F.mono, fontSize: 9, color: "#8a7500" }}>{chLabel}</span>
                            {o.revenue.grossTotal > 0 && (
                              <span style={{ fontFamily: F.mono, fontSize: 9, color: "#8a7500" }}>${o.revenue.grossTotal}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {list.length === 0 && (
                      <div style={{ margin: "auto", textAlign: "center", fontFamily: F.mono, fontSize: 10, color: locked ? "#3a3a40" : "#7a6600" }}>
                        {locked ? "🔒 已鎖" : "＋ 拖曳排入本批"}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend 簡化 · 拿掉工作日/休息日（Yen 2026-07-04：不再顯示） */}
          <div className="flex flex-wrap" style={{ gap: 14, marginTop: 10, fontFamily: F.mono, fontSize: 10, color: "#7A7A82", flexShrink: 0 }}>
            <Legend c="var(--acc,#F5D400)" t="出貨日 · 拖入即歸此批" />
          </div>
        </div>

        {/* RIGHT RAIL */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, minHeight: 0 }}>
          {/* 當週統計 · 上週工作日六日 + 這週工作日 + 這週出貨日 的合計（依批次歸屬 range） */}
          {currentBatchAnchor && (
            <div style={{ background: "#0F0F12", border: "1px solid #26262C", borderLeft: "3px solid var(--acc,#F5D400)", padding: "12px 14px", flexShrink: 0 }}>
              <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 8, marginBottom: 8 }}>
                <div className="flex items-baseline" style={{ gap: 6 }}>
                  <span style={{ fontFamily: F.mono, fontSize: 10, color: "var(--acc,#F5D400)", letterSpacing: ".14em" }}>當週</span>
                  <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#F5F4EF" }}>
                    {(() => { const [, m, d] = currentBatchAnchor.split("-"); return `${Number(m)}/${Number(d)}`; })()}批次
                  </span>
                </div>
                <div className="flex items-baseline" style={{ gap: 12 }}>
                  <span className="flex items-baseline" style={{ gap: 3 }}>
                    <span style={{ fontFamily: F.anton, fontSize: 20, color: "#F5F4EF", lineHeight: 0.85 }}>{currentBatchOrderCount}</span>
                    <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 10, color: "#8A8A93" }}>單</span>
                  </span>
                  <span className="flex items-baseline" style={{ gap: 3 }}>
                    <span style={{ fontFamily: F.anton, fontSize: 22, color: "var(--acc,#F5D400)", lineHeight: 0.85 }}>{currentBatchTotal}</span>
                    <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 10, color: "#8A8A93" }}>顆</span>
                  </span>
                </div>
              </div>
              {currentBatchBreakdown.length === 0 ? (
                <div style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", padding: "4px 0" }}>本週 range 內無訂單</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {currentBatchBreakdown.map((r) => (
                    <div key={r.atom} className="flex items-baseline justify-between" style={{ padding: "4px 8px", background: "#141417" }}>
                      <span style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 11, color: "#C9C9CF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{getDisplayName(r.atom, menu)}</span>
                      <span style={{ fontFamily: F.anton, fontSize: 14, color: "#F5F4EF", marginLeft: 8 }}>{r.qty}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div
            data-day="pending"
            onDragOver={(e) => { e.preventDefault(); setOverDay("pending"); }}
            onDragLeave={() => setOverDay((x) => (x === "pending" ? null : x))}
            onDrop={(e) => { e.preventDefault(); if (dragId) attemptDrop(dragId, "pending"); }}
            style={{ background: overDay === "pending" ? "#141008" : "#0F0F12", border: "1px solid #26262C", padding: 16, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
          >
            <div className="flex justify-between items-baseline" style={{ marginBottom: 10 }}>
              <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: "#F5F4EF" }}>待排訂單</span>
              <span style={{ fontFamily: F.anton, fontSize: 22, color: pending.length ? "#E5622A" : "#43B23C" }}>{pending.length}</span>
            </div>

            {/* 分頁：全部 / 賣貨便 / KOL / 面交 / 指定日 */}
            <div className="flex flex-wrap" style={{ gap: 2, marginBottom: 8 }}>
              {([
                { k: "all" as const, label: "全部", n: pendingCounts.all },
                { k: "賣貨便" as const, label: "賣貨便", n: pendingCounts.賣貨便 },
                { k: "KOL" as const, label: "KOL", n: pendingCounts.KOL },
                { k: "面交" as const, label: "面交", n: pendingCounts.面交 },
                { k: "指定日" as const, label: "指定日", n: pendingCounts.指定日 },
              ]).map((t) => {
                const active = pendingTab === t.k;
                return (
                  <button
                    key={t.k}
                    type="button"
                    onClick={() => setPendingTab(t.k)}
                    style={{
                      fontFamily: F.tc, fontWeight: 900, fontSize: 11,
                      color: active ? "#111" : "#9A9AA2",
                      background: active ? "var(--acc,#F5D400)" : "#161619",
                      padding: "5px 10px", border: "none", cursor: active ? "default" : "pointer",
                    }}
                  >
                    {t.label} <span style={{ fontFamily: F.mono, fontSize: 10, opacity: 0.75 }}>{t.n}</span>
                  </button>
                );
              })}
            </div>

            {/* 搜尋：雇主插單用（訂單編號 / 收件人 / IG / 品項） */}
            <input
              type="text"
              value={pendingQuery}
              onChange={(e) => setPendingQuery(e.target.value)}
              placeholder="🔍 搜尋 姓名 / 訂單編號 / IG / 品項 / 日期…"
              style={{
                fontFamily: F.mono, fontSize: 11, color: "#E7E7EA",
                background: "#111114", border: "1px solid #3a3a40",
                padding: "7px 10px", width: "100%", outline: "none", borderRadius: 0,
                marginBottom: 10, boxSizing: "border-box",
              }}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: 9, flex: 1, minHeight: 0, overflowY: "auto" }}>
              {pendingFiltered.length === 0 && (
                <div style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74", padding: "16px 0", textAlign: "center" }}>
                  {pendingQuery
                    ? "無符合搜尋的待排單"
                    : pendingTab === "all"
                      ? "✓ 全部已排入"
                      : pendingTab === "指定日"
                        ? "無指定日期的待排單"
                        : "此通路無待排單"}
                </div>
              )}
              {pendingFiltered.map((o) => (
                <div
                  key={o.id}
                  draggable={!anyShipDayLocked()}
                  onDragStart={anyShipDayLocked() ? undefined : () => setDragId(o.id)}
                  onDragEnd={anyShipDayLocked() ? undefined : () => { setDragId(null); setOverDay(null); }}
                  title={anyShipDayLocked() ? "🔒 有出貨日已鎖 · 先解鎖再排入" : undefined}
                  style={{ cursor: anyShipDayLocked() ? "not-allowed" : "grab", background: "#111114", border: "1px solid #26262C", padding: "10px 11px", opacity: dragId === o.id ? 0.35 : 1 }}
                >
                  <div className="flex justify-between items-center" style={{ gap: 6 }}>
                    <span style={{ fontFamily: F.mono, fontSize: 11, color: "#C9C9CF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.id}</span>
                    <span style={{ fontFamily: F.mono, fontSize: 13, color: "#4a4a52", flexShrink: 0 }}>⠿</span>
                  </div>
                  {/* 下單日期（給雇主看排序、匯入日 fallback） */}
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: "#6C6C74", marginTop: 2, letterSpacing: ".05em" }}>
                    {o.order_date
                      ? `下單 ${formatDateShort(o.order_date)}`
                      : `匯入 ${formatDateShort(o.first_seen_at)}`}
                  </div>
                  {/* 訂單人名字 · 亦供搜尋（搜尋 hay 早已含 recipient.name / igOrLine） */}
                  <div style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#F5F4EF", marginTop: 3 }}>
                    {o.recipient.name ?? o.recipient.igOrLine ?? "—"}
                    {o.recipient.name && o.recipient.igOrLine ? (
                      <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#7A7A82", marginLeft: 6 }}>
                        {o.recipient.igOrLine}
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 11, color: "#8A8A93", margin: "4px 0 6px" }}>
                    {orderItemLabel(o, menu)}
                  </div>
                  {/* 分類標示：有指定日 / 無指定日（新政策：只標示、不需處理） */}
                  <div style={{ marginBottom: 8 }}>
                    {o.customer_wish_date ? (
                      <span style={{ fontFamily: F.mono, fontSize: 10, color: "#43B23C", background: "#0c140c", padding: "2px 7px", border: "1px solid #43B23C" }}>
                        📌 指定 {formatDateShort(o.customer_wish_date)}
                      </span>
                    ) : (
                      <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", background: "#161619", padding: "2px 7px", border: "1px solid #3a3a40" }}>
                        ○ 無指定 · 等排入
                      </span>
                    )}
                  </div>
                  <div className="flex items-center" style={{ gap: 8 }}>
                    {/* Yen 2026-07-03：拿掉「建議 MM/DD」自動 chip · 待排單只保留客人指定日提示 */}
                    {o.wish_priority === "strict" && (
                      <span style={{ fontFamily: F.mono, fontSize: 9, color: "#E5352B", border: "1px solid #E5352B", padding: "2px 6px" }}>STRICT</span>
                    )}
                  </div>
                </div>
              ))}
              {pending.length === 0 && (
                <div style={{ textAlign: "center", padding: "18px 8px", fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#43B23C" }}>
                  ✓ 全部已排入<br />
                  <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#6C6C74" }}>可產出 Excel / 標籤</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      </div>
      )}
      </div>

      {/* 診斷 modal：待排 vs 待處理桶 差集列表 */}
      {diagOpen && (
        <div
          onClick={() => setDiagOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 20px", overflowY: "auto" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#0F0F12", border: "1px solid #26262C", maxWidth: 900, width: "100%", maxHeight: "90vh", overflowY: "auto", padding: 24 }}
          >
            <div className="flex justify-between items-baseline" style={{ marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".14em" }}>DIAGNOSTICS</div>
                <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 20, color: "#F5F4EF", marginTop: 4 }}>待排 vs 待處理桶 · 差集</div>
              </div>
              <button type="button" onClick={() => setDiagOpen(false)} style={{ fontFamily: F.mono, fontSize: 13, color: "#8A8A93", background: "transparent", border: "none", cursor: "pointer" }}>✕</button>
            </div>

            {/* 訂單分佈總覽（互斥、Σ = 全部訂單） */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#F5F4EF", marginBottom: 10 }}>
                訂單分佈總覽
                <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#7A7A82", marginLeft: 8 }}>
                  總 {diag.total} = 已出貨 + confirmed(已排+未排) + 待處理桶 + 已取消
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8 }}>
                <div style={{ background: "#111114", padding: 10, borderLeft: "3px solid #43B23C" }}>
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>已出貨</div>
                  <div style={{ fontFamily: F.anton, fontSize: 22, color: "#F5F4EF" }}>{diag.shippedCount}</div>
                </div>
                <div style={{ background: "#111114", padding: 10, borderLeft: "3px solid #F5D400" }}>
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>confirmed 已排</div>
                  <div style={{ fontFamily: F.anton, fontSize: 22, color: "#F5F4EF" }}>{diag.confirmedScheduledCount}</div>
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: "#43B23C", marginTop: 2 }}>拍板 · 週/月曆</div>
                </div>
                <div style={{ background: "#111114", padding: 10, borderLeft: "3px solid #E5622A" }}>
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>confirmed 未排</div>
                  <div style={{ fontFamily: F.anton, fontSize: 22, color: "#F5F4EF" }}>{diag.confirmedUnscheduledCount}</div>
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: "#E5622A", marginTop: 2 }}>在待排列表</div>
                </div>
                <div style={{ background: "#111114", padding: 10, borderLeft: "3px solid #8557C9" }}>
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>待處理桶</div>
                  <div style={{ fontFamily: F.anton, fontSize: 22, color: "#F5F4EF" }}>{diag.bucketCount}</div>
                </div>
                <div style={{ background: "#111114", padding: 10, borderLeft: "3px solid #6C6C74" }}>
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>已取消</div>
                  <div style={{ fontFamily: F.anton, fontSize: 22, color: "#F5F4EF" }}>{diag.canceledCount}</div>
                </div>
              </div>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", marginTop: 8 }}>
                Σ 檢查：{diag.shippedCount + diag.confirmedScheduledCount + diag.confirmedUnscheduledCount + diag.bucketCount + diag.canceledCount} / {diag.total}
                {(diag.shippedCount + diag.confirmedScheduledCount + diag.confirmedUnscheduledCount + diag.bucketCount + diag.canceledCount) === diag.total
                  ? <span style={{ color: "#43B23C" }}> ✓ 一致</span>
                  : <span style={{ color: "#E5352B" }}> ✗ 有訂單狀態不在分類內</span>}
              </div>
            </div>

            {/* confirmed 已排 · 按 batchDate 分佈 */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#F5D400", marginBottom: 8 }}>
                confirmed 已排 · 按出貨日分佈（{diag.confirmedScheduledCount} 單）
                <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#7A7A82", marginLeft: 8 }}>
                  = 這些單去了哪些日子（在排程週/月曆的日欄裡）
                </span>
              </div>
              {diag.confirmedDateRows.length === 0 && <div style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74" }}>—</div>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 6 }}>
                {diag.confirmedDateRows.map((row) => (
                  <div key={row.date} style={{ background: "#111114", padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontFamily: F.mono, fontSize: 11, color: "#C9C9CF" }}>{row.date}</span>
                    <span style={{ fontFamily: F.anton, fontSize: 18, color: "#F5D400" }}>{row.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* status × assignment_source × batchDate 交叉分佈（每列 = 一種組合） */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#F5F4EF", marginBottom: 8 }}>
                訂單交叉分佈 · status × assignment_source × 有無 batchDate
                <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#7A7A82", marginLeft: 8 }}>
                  = 每一單卡在哪個組合、靜默失效就會現形
                </span>
              </div>
              <div style={{ background: "#111114", padding: "6px 12px", display: "grid", gridTemplateColumns: "2fr 1.4fr 0.8fr 0.6fr", gap: 8, fontFamily: F.mono, fontSize: 10, color: "#7A7A82", letterSpacing: ".1em", borderBottom: "1px solid #26262C" }}>
                <span>status</span>
                <span>assignment_source</span>
                <span>batchDate</span>
                <span style={{ textAlign: "right" }}>n</span>
              </div>
              {diag.crossRows.length === 0 && (
                <div style={{ background: "#111114", padding: "10px 12px", fontFamily: F.mono, fontSize: 11, color: "#6C6C74" }}>—</div>
              )}
              {diag.crossRows.map((row, i) => {
                // 高亮潛在異常組合
                const isConfirmedScheduledPending = row.status === "confirmed" && row.source === "pending" && row.hasDate === "有date";
                const highlight = isConfirmedScheduledPending ? "#E5622A" : "#C9C9CF";
                return (
                  <div key={i} style={{ background: "#111114", padding: "8px 12px", display: "grid", gridTemplateColumns: "2fr 1.4fr 0.8fr 0.6fr", gap: 8, fontFamily: F.mono, fontSize: 11, color: highlight, borderBottom: "1px solid #1a1a1e" }}>
                    <span>{row.status}</span>
                    <span>{row.source}</span>
                    <span style={{ color: row.hasDate === "有date" ? "#43B23C" : "#E5622A" }}>{row.hasDate}</span>
                    <span style={{ textAlign: "right", fontFamily: F.anton, fontSize: 14, color: "#F5F4EF" }}>{row.n}</span>
                  </div>
                );
              })}
            </div>

            {/* customer_wish_date 原始值格式分佈（找 undefined/undefined 顯示的根因） */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#F5F4EF", marginBottom: 8 }}>
                customer_wish_date 格式分佈
                <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#7A7A82", marginLeft: 8 }}>
                  = 排查 UI「指定 undefined/undefined」的根因、非 ISO 格式現形
                </span>
              </div>
              {diag.wishFormatRows.length === 0 && (
                <div style={{ background: "#111114", padding: "10px 12px", fontFamily: F.mono, fontSize: 11, color: "#6C6C74" }}>—</div>
              )}
              {diag.wishFormatRows.map((row, i) => {
                const isBad = !row.format.includes("ISO");
                return (
                  <div key={i} style={{ background: "#111114", padding: "8px 12px", display: "grid", gridTemplateColumns: "2fr 0.6fr", gap: 8, fontFamily: F.mono, fontSize: 11, color: isBad ? "#E5622A" : "#43B23C", borderBottom: "1px solid #1a1a1e" }}>
                    <span>{row.format}</span>
                    <span style={{ textAlign: "right", fontFamily: F.anton, fontSize: 14, color: "#F5F4EF" }}>{row.n}</span>
                  </div>
                );
              })}
              {diag.nonIsoWishSamples.length > 0 && (
                <div style={{ marginTop: 8, background: "#2a1a10", padding: "8px 12px", borderLeft: "3px solid #E5622A" }}>
                  <div style={{ fontFamily: F.mono, fontSize: 10, color: "#E5622A", marginBottom: 6 }}>非 ISO 訂單樣本（前 6 筆）</div>
                  {diag.nonIsoWishSamples.map((s) => (
                    <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 2fr", gap: 8, fontFamily: F.mono, fontSize: 10, color: "#C9C9CF", padding: "2px 0" }}>
                      <span>{s.id}</span>
                      <span style={{ color: "#E5622A" }}>wish = "{s.raw}"</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 靜默失效：batchDate 非 ISO 的訂單 */}
            {diag.dirtyBatchDate.length > 0 && (
              <div style={{ marginBottom: 20, background: "#2a1010", padding: "14px 16px", borderLeft: "3px solid #E5352B" }}>
                <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 10, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#E5352B" }}>
                      ⚠ 靜默失效 · batchDate 非 ISO 格式（{diag.dirtyBatchDate.length} 單）
                    </div>
                    <div style={{ fontFamily: F.mono, fontSize: 10, color: "#C9C9CF", marginTop: 4 }}>
                      這些單的 batchDate 是「下次週二」等文字、月曆/週檢視認不出來 → 靜默消失
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={fixDirtyBatchDate}
                    disabled={fixing}
                    style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: "#111", background: "#F5D400", border: "none", padding: "7px 14px", cursor: fixing ? "wait" : "pointer" }}
                  >
                    {fixing ? "修復中…" : `一鍵退回 ${diag.dirtyBatchDate.length} 單到待排`}
                  </button>
                </div>
                {diag.dirtyBatchDate.slice(0, 10).map((o) => (
                  <div key={o.id} style={{ padding: "6px 0", display: "grid", gridTemplateColumns: "1.4fr 1fr 1.4fr", gap: 8, fontFamily: F.mono, fontSize: 10, color: "#C9C9CF" }}>
                    <span>{o.id}</span>
                    <span style={{ color: "#E5622A" }}>batchDate = "{o.batchDate}"</span>
                    <span>{o.recipient?.name ?? "—"} · {o.channel}</span>
                  </div>
                ))}
                {diag.dirtyBatchDate.length > 10 && (
                  <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", marginTop: 6 }}>… 還有 {diag.dirtyBatchDate.length - 10} 單</div>
                )}
              </div>
            )}

            {/* Legacy MISSING_BATCH_DATE 清理（新政策：無指定日直接進待排、不需 resolve） */}
            {diag.legacyMissingDate.length > 0 && (
              <div style={{ marginBottom: 20, background: "#0f1a26", padding: "14px 16px", borderLeft: "3px solid #2AC7E8" }}>
                <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 10, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#2AC7E8" }}>
                      🔧 Legacy · 舊政策 MISSING_BATCH_DATE 資料（{diag.legacyMissingDate.length} 單）
                    </div>
                    <div style={{ fontFamily: F.mono, fontSize: 10, color: "#C9C9CF", marginTop: 4 }}>
                      新政策：無指定日 = 分類標示、不再需要處理 · 這些單應該直接進待排排隊
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={cleanLegacyMissingDate}
                    disabled={cleaningLegacy}
                    style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: "#111", background: "#2AC7E8", border: "none", padding: "7px 14px", cursor: cleaningLegacy ? "wait" : "pointer" }}
                  >
                    {cleaningLegacy ? "清理中…" : `一鍵清理 ${diag.legacyMissingDate.length} 單 → 進待排`}
                  </button>
                </div>
                {diag.legacyMissingDate.slice(0, 5).map((o) => (
                  <div key={o.id} style={{ padding: "6px 0", display: "grid", gridTemplateColumns: "1.4fr 1fr 1.4fr", gap: 8, fontFamily: F.mono, fontSize: 10, color: "#C9C9CF" }}>
                    <span>{o.id}</span>
                    <span style={{ color: "#8A8A93" }}>{o.pendingReasons.map((r) => r.code).join(", ")}</span>
                    <span>{o.recipient?.name ?? "—"} · {o.channel}</span>
                  </div>
                ))}
                {diag.legacyMissingDate.length > 5 && (
                  <div style={{ fontFamily: F.mono, fontSize: 10, color: "#7A7A82", marginTop: 6 }}>… 還有 {diag.legacyMissingDate.length - 5} 單</div>
                )}
              </div>
            )}

            {/* 孤兒 wish_date 自動排區塊已拿掉（Yen 2026-07-03 決策：不再自動排指定日、全手動拖入） */}

            {/* 當前 UI filter 狀態（排除 tab/query 藏單造成的錯覺） */}
            <div style={{ marginBottom: 20, background: "#161619", padding: "12px 14px", borderLeft: "3px solid #F5D400" }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: "#F5F4EF", marginBottom: 6 }}>
                當前排程頁待排列表 UI 狀態
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, fontFamily: F.mono, fontSize: 10, color: "#C9C9CF" }}>
                <div>
                  <div style={{ color: "#7A7A82", fontSize: 9, marginBottom: 2 }}>pending 總數</div>
                  <div style={{ fontFamily: F.anton, fontSize: 20, color: "#F5F4EF" }}>{pending.length}</div>
                </div>
                <div>
                  <div style={{ color: "#7A7A82", fontSize: 9, marginBottom: 2 }}>UI 顯示（filtered）</div>
                  <div style={{ fontFamily: F.anton, fontSize: 20, color: pendingFiltered.length !== pending.length ? "#E5622A" : "#F5F4EF" }}>{pendingFiltered.length}</div>
                </div>
                <div>
                  <div style={{ color: "#7A7A82", fontSize: 9, marginBottom: 2 }}>當前 tab</div>
                  <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 14, color: pendingTab !== "all" ? "#E5622A" : "#C9C9CF" }}>{pendingTab}</div>
                </div>
                <div>
                  <div style={{ color: "#7A7A82", fontSize: 9, marginBottom: 2 }}>搜尋字串</div>
                  <div style={{ fontFamily: F.mono, fontSize: 12, color: pendingQuery ? "#E5622A" : "#6C6C74" }}>{pendingQuery ? `"${pendingQuery}"` : "（空）"}</div>
                </div>
              </div>
              {pendingFiltered.length !== pending.length && (
                <div style={{ marginTop: 8, fontFamily: F.mono, fontSize: 10, color: "#E5622A" }}>
                  ⚠ 當前 tab／搜尋隱藏了 {pending.length - pendingFiltered.length} 單 · 切「全部」+ 清搜尋看完整清單
                </div>
              )}
            </div>

            {/* 差集統計（原本的四卡片） */}
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#F5F4EF", marginBottom: 10 }}>差集分析</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
              <div style={{ background: "#111114", padding: 12, borderLeft: "3px solid #E5622A" }}>
                <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>排程待排</div>
                <div style={{ fontFamily: F.anton, fontSize: 28, color: "#F5F4EF" }}>{diag.waitCount}</div>
              </div>
              <div style={{ background: "#111114", padding: 12, borderLeft: "3px solid #8557C9" }}>
                <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>待處理桶</div>
                <div style={{ fontFamily: F.anton, fontSize: 28, color: "#F5F4EF" }}>{diag.bucketCount}</div>
              </div>
              <div style={{ background: "#111114", padding: 12, borderLeft: "3px solid #F5D400" }}>
                <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>只在排程</div>
                <div style={{ fontFamily: F.anton, fontSize: 28, color: diag.inWaitOnly.length > 0 ? "#F5D400" : "#43B23C" }}>{diag.inWaitOnly.length}</div>
              </div>
              <div style={{ background: "#111114", padding: 12, borderLeft: "3px solid #F5D400" }}>
                <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7A7A82" }}>只在待處理</div>
                <div style={{ fontFamily: F.anton, fontSize: 28, color: diag.inBucketOnly.length > 0 ? "#F5D400" : "#43B23C" }}>{diag.inBucketOnly.length}</div>
              </div>
            </div>

            {/* 只在排程待排的 */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#E5622A", marginBottom: 8 }}>
                只在「排程待排」的訂單（{diag.inWaitOnly.length}）
                <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#7A7A82", marginLeft: 8 }}>= confirmed 未拍板 · 你 resolve 過但沒拖到日欄</span>
              </div>
              {diag.inWaitOnly.length === 0 && <div style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74" }}>—</div>}
              {diag.inWaitOnly.map((o) => (
                <div key={o.id} style={{ background: "#111114", padding: "10px 12px", marginBottom: 4, display: "grid", gridTemplateColumns: "1.4fr 0.9fr 0.9fr 0.8fr 1.5fr", gap: 8, fontFamily: F.mono, fontSize: 11, color: "#C9C9CF" }}>
                  <span>{o.id}</span>
                  <span style={{ color: "#8A8A93" }}>{o.status}</span>
                  <span style={{ color: "#8A8A93" }}>{o.assignment_source ?? "—"}</span>
                  <span style={{ color: o.batchDate ? "#43B23C" : "#E5622A" }}>{o.batchDate ?? "無日期"}</span>
                  <span style={{ color: "#F5F4EF", fontFamily: F.tc }}>{o.recipient?.name ?? o.recipient?.igOrLine ?? "—"} · {o.channel}</span>
                </div>
              ))}
            </div>

            {/* 只在待處理桶的 */}
            <div>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#8557C9", marginBottom: 8 }}>
                只在「待處理桶」的訂單（{diag.inBucketOnly.length}）
                <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 10, color: "#7A7A82", marginLeft: 8 }}>= status 是 pending_channel / pending_product / pending_amount / disappeared 等</span>
              </div>
              {diag.inBucketOnly.length === 0 && <div style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74" }}>—</div>}
              {diag.inBucketOnly.map((o) => (
                <div key={o.id} style={{ background: "#111114", padding: "10px 12px", marginBottom: 4, display: "grid", gridTemplateColumns: "1.4fr 1.4fr 1fr 1.8fr", gap: 8, fontFamily: F.mono, fontSize: 11, color: "#C9C9CF" }}>
                  <span>{o.id}</span>
                  <span style={{ color: "#8A8A93" }}>{o.status}</span>
                  <span style={{ color: "#8A8A93" }}>{o.assignment_source ?? "—"}</span>
                  <span style={{ color: "#F5F4EF", fontFamily: F.tc }}>{(o.pendingReasons ?? []).map((r) => r.code).join(", ") || "—"}</span>
                </div>
              ))}
            </div>

            {/* Danger zone · inline 二次確認、不依賴 browser dialog */}
            <div style={{ marginTop: 32, padding: "14px 16px", background: "#2a1010", border: "2px dashed #E5352B" }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#E5352B", marginBottom: 4 }}>
                ⚠ DANGER ZONE
              </div>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: "#C9C9CF", marginBottom: 10 }}>
                下方會清空所有訂單資料、只用於重新測試匯入流程 · 無法復原。
              </div>

              {wipeMode === "idle" && (
                <button
                  type="button"
                  onClick={() => { setWipeMode("arm"); setWipeInput(""); }}
                  style={{
                    fontFamily: F.tc, fontWeight: 900, fontSize: 12,
                    color: "#F5F4EF", background: "#E5352B",
                    border: "none", padding: "9px 16px", cursor: "pointer",
                  }}
                >
                  🗑 清空所有訂單（{orders.length}）· 重新測試用
                </button>
              )}

              {wipeMode === "arm" && (
                <div>
                  <div style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#F5F4EF", marginBottom: 8 }}>
                    最後確認：輸入「<span style={{ color: "#E5352B", fontWeight: 900 }}>清空</span>」二字後按執行、將刪除 {orders.length} 單。
                  </div>
                  <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
                    <input
                      type="text"
                      value={wipeInput}
                      onChange={(e) => setWipeInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && wipeInput.trim() === "清空") { void executeWipe(); } }}
                      autoFocus
                      placeholder="輸入 清空"
                      style={{
                        fontFamily: F.mono, fontSize: 13, color: "#F5F4EF",
                        background: "#111114", border: "1px solid #E5352B",
                        padding: "8px 12px", width: 160, outline: "none", borderRadius: 0,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void executeWipe()}
                      disabled={wiping || wipeInput.trim() !== "清空"}
                      style={{
                        fontFamily: F.tc, fontWeight: 900, fontSize: 12,
                        color: wipeInput.trim() === "清空" ? "#F5F4EF" : "#7A7A82",
                        background: wipeInput.trim() === "清空" ? "#E5352B" : "#3a3a40",
                        border: "none", padding: "9px 16px",
                        cursor: wiping ? "wait" : wipeInput.trim() === "清空" ? "pointer" : "not-allowed",
                      }}
                    >
                      {wiping ? "清空中…" : "🗑 執行清空"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setWipeMode("idle"); setWipeInput(""); }}
                      disabled={wiping}
                      style={{
                        fontFamily: F.tc, fontWeight: 700, fontSize: 12,
                        color: "#C9C9CF", background: "transparent",
                        border: "1px solid #3a3a40", padding: "9px 16px", cursor: "pointer",
                      }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              {wipeMode === "done" && (
                <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#43B23C", padding: "8px 0" }}>
                  ✓ 已清空 · 現在可關閉此 modal、拖檔上傳測試
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 給某日期算出它落在 today 的第幾週偏移（月曆點日 → 週檢視）
function weekOffsetForDate(d: Date, today: Date): number {
  const m0 = mondayOf(today, 0).getTime();
  const md = mondayOf(d, 0).getTime();
  return Math.round((md - m0) / (7 * 86400000));
}

// 訂單顯示標籤：第一個 item 的 SKU 顯示名（禁 raw hardcode、經 menu）
function orderItemLabel(o: Order, menu: Menu): string {
  const first = o.items[0];
  if (!first) return o.id;
  const name = first.productSkuId ? getDisplayName(first.productSkuId, menu) : first.rawName;
  return o.items.length > 1 ? `${name} +${o.items.length - 1}` : name;
}

// 月曆視圖：整月排程一眼（每日已排單數 + 顆數），點某日 → 跳該週檢視
function MonthCalendar({
  weeks, month, today, ordersByDate, menu, onPickDay,
}: {
  weeks: Date[][];
  month: number;
  today: Date;
  ordersByDate: Map<string, Order[]>;
  menu: Menu;
  onPickDay: (d: Date) => void;
}) {
  const todayISO = toISO(today);
  return (
    <div className="px-6 py-2" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* 星期頭 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, flexShrink: 0, marginBottom: 6 }}>
        {["一", "二", "三", "四", "五", "六", "日"].map((w, i) => (
          <div key={w} style={{ fontFamily: F.mono, fontSize: 11, color: i === 1 ? "var(--acc,#F5D400)" : "#7A7A82", textAlign: "center", letterSpacing: ".1em" }}>
            {w}{i === 1 ? " · 出貨" : ""}
          </div>
        ))}
      </div>
      {/* 週列 */}
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: `repeat(${weeks.length},1fr)`, gap: 6 }}>
        {weeks.map((row, ri) => (
          <div key={ri} style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, minHeight: 0 }}>
            {row.map((d) => {
              const iso = toISO(d);
              const inMonth = d.getMonth() === month;
              const isShip = d.getDay() === 2;
              const isToday = iso === todayISO;
              const list = ordersByDate.get(iso) ?? [];
              const atoms = list.length ? [...accumulateAtoms(list).values()].reduce((s, n) => s + n, 0) : 0;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => onPickDay(d)}
                  style={{
                    background: isShip && inMonth ? "#1c1600" : "#111114",
                    border: isToday ? "2px solid var(--acc,#F5D400)" : isShip ? "1px solid #4a3f00" : "1px solid #26262C",
                    opacity: inMonth ? 1 : 0.35,
                    padding: "8px 9px",
                    cursor: "pointer",
                    textAlign: "left",
                    borderRadius: 0,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                    overflow: "hidden",
                  }}
                >
                  <div className="flex items-baseline justify-between" style={{ flexShrink: 0 }}>
                    <span style={{ fontFamily: F.mono, fontSize: 9, color: isShip ? "var(--acc,#F5D400)" : "#6C6C74" }}>{isShip ? "出貨" : ""}</span>
                    <span style={{ fontFamily: F.anton, fontSize: 18, color: inMonth ? "#E7E7EA" : "#6C6C74" }}>{d.getDate()}</span>
                  </div>
                  {list.length > 0 && (
                    <div style={{ marginTop: "auto", flexShrink: 0 }}>
                      <div style={{ height: 4, background: "var(--acc,#F5D400)", marginBottom: 4, width: `${Math.min(100, list.length * 20)}%` }} />
                      <div style={{ fontFamily: F.mono, fontSize: 10, color: "#C9C9CF" }}>{list.length} 單 · {atoms} 顆</div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", marginTop: 8, flexShrink: 0 }}>
        點任一日 → 跳該週檢視拖拉排單 · 週二為出貨日 · 黃框＝今天 · {menu.scheduling?.regular_shipping_weekday === 2 ? "常態週二出貨" : ""}
      </div>
    </div>
  );
}

function Legend({ c, t, dashed }: { c: string; t: string; dashed?: boolean }) {
  return (
    <span className="flex items-center" style={{ gap: 6 }}>
      <span style={{ width: 9, height: 9, background: dashed ? "transparent" : c, border: dashed ? `1px dashed ${c}` : undefined }} />
      {t}
    </span>
  );
}

const btn: React.CSSProperties = { fontFamily: F.mono, fontSize: 13, color: "#8A8A93", background: "#161619", padding: "7px 12px", cursor: "pointer" };
const btnActive: React.CSSProperties = { ...btn, color: "#0B0B0C", background: "var(--acc,#F5D400)", fontWeight: 700 };
