/**
 * DashboardPage — NARCOS.sugar 深色倉儲控制台
 * 憲章 #1: 禁 hardcode 品項字串（一律 getDisplayName）
 * 憲章 #2: 主軌 0 LLM，數字全由 props.orders 即時算
 *
 * Shell 負責 CommandBar / WarningTape / GrainOverlay。
 * 本頁 render：PageHeader + body。
 *
 * Yen 2026-07-16 · 版面改為「鎖一個視窗、不滾輪」：
 *   釘住   KPI 六宮格 + 資料健康度狀態條
 *   牌組   ‹ › 左右翻頁，P1 趨勢 / P2 結構（鍵盤 ← → 可翻）
 * 健康度刻意不進牌組 —— 它是產出閘門（憲章 #9/#10），
 * 是門不是分析面板，翻到第二頁去就等於沒在守。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, PeriodChips } from "../brand/PageHeader";
import { ExportBtn } from "../brand/ExportBtn";
import { writePeriodSummaryExcel } from "../../output/period-summary-excel";
import { BackupControls } from "../brand/BackupControls";
import { getDisplayName } from "../../domain/menu";
import {
  computeKpiCounts,
  computeBatchKpi,
  computeBatchTrend,
  computeMonthTrend,
  computeTopProducts,
  computeChannelShare,
  computeRepeatCustomers,
  computeHealthChecks,
  resolvePeriodWindow,
  monthAlignedWindow,
  type HealthCheck,
  type Period,
  type ShipCalendar,
} from "../../domain/compute-dashboard";
import { loadDayOverrides, makeDayTypeOf, shippingDayFor } from "../../domain/day-type";
import { checkReleaseGate, type GateStatus } from "../../domain/release-gate";
import type { PageProps } from "./types";

const F = { anton: "'Anton',sans-serif", tc: "'Noto Sans TC',sans-serif", mono: "'Space Mono',monospace" } as const;
// Yen 2026-07-17：原本是「六月」寫死 —— 開發當下是六月，之後每過一個月就更錯。
// 接上 compute 時一併改成滾動的「近 6 月」。
const PERIODS: { key: Period; label: string }[] = [
  { key: "8w", label: "近 8 週" },
  { key: "6m", label: "近 6 月" },
  { key: "all", label: "全部" },
];
const DECK = [{ key: "trend", label: "趨勢" }, { key: "mix", label: "結構" }] as const;
const EMBER = "#E5622A";
/** 長條最大寬。不封頂的話 flex:1 會讓「只有一批」那根撐滿整個面板。 */
const MAX_BAR_W = 56;
/**
 * 出爐量趨勢改用「月」為單位的格數門檻。
 * 面板寬約 490px（雙欄）· 扣掉 gap 後超過 12 格，每根就剩不到 25px、
 * 日期標籤（05/26）會糊成一片 —— 近 6 月是 26 個週二，實測完全不可讀。
 * 軸的單位要跟縮放層級走：看 8 週就看批，看半年就看月。
 */
const MAX_BATCH_BARS = 12;

// ── Small shared components ───────────────────────────────────────────────────

function PanelBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "#0F0F12", border: "1px solid #26262C", padding: 20,
      display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden",
    }}>
      {children}
    </div>
  );
}

function PanelHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16, flex: "none" }}>
      <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: "#F5F4EF" }}>
        {title} {sub && <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 11, color: "#6C6C74" }}>{sub}</span>}
      </span>
      {right}
    </div>
  );
}

function Kpi({ label, accent, labelColor, foot, footColor, children }: {
  label: string; accent?: string; labelColor?: string; foot?: string; footColor?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ background: "#111114", border: "1px solid #26262C", borderLeft: accent ? `3px solid ${accent}` : "1px solid #26262C", padding: 14 }}>
      <div style={{ fontFamily: F.mono, fontSize: 10, color: labelColor ?? "#7A7A82", letterSpacing: ".12em" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", marginTop: 6 }}>{children}</div>
      {foot && <div style={{ fontFamily: F.mono, fontSize: 10, color: footColor ?? "#6C6C74", marginTop: 6 }}>{foot}</div>}
    </div>
  );
}

function BigNum({ v, color = "#F5F4EF", size = 38 }: { v: string | number; color?: string; size?: number }) {
  return <span style={{ fontFamily: F.anton, fontSize: size, color, lineHeight: 0.85 }}>{v}</span>;
}

/**
 * 長條圖的一根。高度用 % 而非固定 px —— 牌組高度隨視窗變，
 * 固定 px 會在矮螢幕爆出去、逼出滾輪（正是本次要根治的）。
 */
function Bar({ label, v, pct, color, isHot, hatch, empty }: {
  label: string; v: string; pct: number; color: string; isHot?: boolean; hatch?: boolean; empty?: boolean;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0, maxWidth: MAX_BAR_W, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <span style={{
        fontFamily: F.mono, fontSize: isHot ? 13 : 12, flex: "none",
        color: empty ? "#3E3E46" : isHot ? color : "#8A8A93",
        fontWeight: isHot ? 700 : 400,
      }}>{v}</span>
      <div style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", alignItems: "flex-end" }}>
        {empty ? (
          // 空格：一條貼底的虛線，讓「這批 0 單」看得出是一格，而不是不存在
          <div style={{ width: "100%", height: 1, borderTop: "1px dashed #2E2E34" }} />
        ) : (
          <div style={{ width: "100%", height: `${Math.max(pct, 0.6)}%`, background: color, position: "relative" }}>
            {hatch && <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(45deg,#2E2E34 0 6px,#161619 6px 12px)" }} />}
          </div>
        )}
      </div>
      <span style={{
        fontFamily: F.mono, fontSize: 11, flex: "none", whiteSpace: "nowrap",
        color: empty ? "#3E3E46" : isHot ? color : "#6C6C74",
      }}>{label}</span>
    </div>
  );
}

/** 靠左排：時間軸從左往右長，月份累積時位置固定、不會整組飄移 */
function BarField({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", justifyContent: "flex-start", gap: 14, flex: 1, minHeight: 0 }}>
      {children}
    </div>
  );
}

function EmptyRow() {
  return <div style={{ fontFamily: F.mono, fontSize: 12, color: "#6C6C74" }}>暫無資料</div>;
}

/**
 * 資料檢查狀態條 —— 產出閘門的常駐燈號。永遠釘在 KPI 底下、翻頁翻不掉。
 *
 * 選項二布局（Yen 2026-07-19）：
 *   全綠時：一行安靜；四顆綠燈 + 右邊小字「可產出」
 *   有 blocker（gate.can_release=false）時：條往下長高、列出白話原因，
 *     附「→ 前往處理」跳到待處理桶
 *   有橘燈但不 blocker（例如金額一致=否）時：四顆維持顯示、但不長警語
 *     —— 訊號跟行為對齊，說擋才擋、否則不亂喊
 */
function HealthStrip({ checks, gate }: { checks: HealthCheck[]; gate: GateStatus }) {
  const blocked = !gate.can_release;
  return (
    <div style={{
      flex: "none", display: "flex", flexDirection: "column",
      background: "#0F0F12",
      borderTop: "1px solid #26262C", borderBottom: "1px solid #26262C",
    }}>
      {/* 上排：四顆檢查燈（永遠顯示）*/}
      <div style={{
        display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap",
        padding: "8px 24px",
      }}>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", letterSpacing: ".12em" }}>資料檢查</span>
        {checks.map((h) => (
          <span key={h.label} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: h.color, flexShrink: 0, display: "inline-block" }} />
            <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#C9C9CF" }}>{h.label}</span>
            <span style={{ fontFamily: F.mono, fontSize: 11, color: h.color }}>{h.value}</span>
          </span>
        ))}
        {!blocked && (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: F.tc, fontSize: 11, color: "#43B23C" }}>
            ✓ 可產出
          </span>
        )}
      </div>

      {/* 下排：閘門展開（只有真的擋出爐時才長出來，且能點過去處理）*/}
      {blocked && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 6,
          padding: "10px 24px 12px",
          background: "#181114", borderTop: `1px solid ${EMBER}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: EMBER, letterSpacing: ".05em" }}>
              ⚠ 尚未通過檢查 · 暫不可產出
            </span>
            <span style={{ fontFamily: F.tc, fontSize: 11, color: "#8A8A93" }}>
              （處理完後「產出 Excel／PDF」自動解鎖）
            </span>
          </div>
          {gate.blockers.map((msg) => (
            <a
              key={msg}
              href="#/pending"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontFamily: F.tc, fontSize: 12, color: "#F5F4EF",
                textDecoration: "none",
              }}
              onMouseOver={(e) => (e.currentTarget.style.color = EMBER)}
              onMouseOut={(e) => (e.currentTarget.style.color = "#F5F4EF")}
            >
              <span style={{ color: EMBER }}>•</span>
              <span>{msg}</span>
              <span style={{ fontFamily: F.mono, fontSize: 11, color: "#8A8A93", marginLeft: 4 }}>
                → 前往處理
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 牌組頁標。Yen 2026-07-16：改成滑的為主，這裡只剩狀態、沒有說明。
 *
 * 圓點刻意留著（沒有再退成 0）：它不是「說明」是「狀態」——
 * 沒有它就沒有任何東西透露「還有第二頁」，也沒有滑鼠使用者的退路
 * （一般滑鼠沒有水平滾動，滑不動）。點仍可點，是那條退路。
 */
function Pager({ active, onChange }: { active: number; onChange: (i: number) => void }) {
  return (
    <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 24px 14px" }}>
      {DECK.map((p, i) => {
        const on = i === active;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(i)}
            aria-label={`第 ${i + 1} 頁 · ${p.label}`}
            aria-current={on ? "true" : undefined}
            title={p.label}
            style={{
              background: "transparent", border: "none",
              padding: "6px 4px", cursor: "pointer", lineHeight: 0,
            }}
          >
            <span style={{
              display: "inline-block", height: 6, borderRadius: 3,
              width: on ? 22 : 6,
              background: on ? "var(--acc,#F5D400)" : "#3E3E46",
            }} />
          </button>
        );
      })}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function DashboardPage({ orders, menu, refreshOrders }: PageProps) {
  const [period, setPeriod] = useState<Period>("8w");
  const [page, setPage] = useState(0);

  // 出貨行事曆：menu.scheduling 的星期幾預設 + SchedulePage 存的單日 override。
  // 跟排程/工單/標籤用的是同一套判定 —— 儀表板不自己另外定義「哪天出爐」。
  const todayIso = new Date().toISOString().slice(0, 10);
  const cal: ShipCalendar = useMemo(() => {
    const dayTypeOf = makeDayTypeOf(menu, loadDayOverrides());
    return {
      isShipDay: (iso) => dayTypeOf(iso) === "ship",
      shipDayOf: (iso) => shippingDayFor(iso, dayTypeOf),
    };
  }, [menu]);

  const win = useMemo(
    () => resolvePeriodWindow(period, orders, todayIso, cal),
    [period, orders, todayIso, cal],
  );

  const kpi = useMemo(() => computeKpiCounts(orders), [orders]);
  const batchKpi = useMemo(() => computeBatchKpi(orders), [orders]);
  const batchTrend = useMemo(() => computeBatchTrend(orders, win, cal), [orders, win, cal]);
  // 月圖用撐成整月的窗：8w 的窗切在月中間，直接用會讓邊緣月份謊報 0
  const monthTrend = useMemo(() => computeMonthTrend(orders, monthAlignedWindow(win)), [win, orders]);
  const topProducts = useMemo(() => computeTopProducts(orders, win), [orders, win]);
  const channelShare = useMemo(() => computeChannelShare(orders, win), [orders, win]);
  const repeatStats = useMemo(() => computeRepeatCustomers(orders, win), [orders, win]);
  const healthChecks = useMemo(() => computeHealthChecks(orders), [orders]);
  const releaseGate = useMemo(() => checkReleaseGate(orders), [orders]);

  // 鍵盤翻頁。沿用專案既有的鍵盤流文化（待處理桶用 J/K、排程用 ‹ ›）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "ArrowLeft") setPage((p) => Math.max(0, p - 1));
      else if (e.key === "ArrowRight") setPage((p) => Math.min(DECK.length - 1, p + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * 觸控板兩指左右滑翻頁。
   *
   * 難點是「一次手勢 = 一頁」：macOS 慣性滑動在手指離開後還會噴約 1 秒的
   * wheel 事件，用固定 cooldown 不是翻過頭就是要等太久。作法是翻完就上鎖、
   * 只有在事件流「安靜 180ms」後才解鎖 —— 慣性尾巴會一直把計時器往後推，
   * 所以整條尾巴都被鎖住，手真的停下來才會放行。
   *
   * 只吃水平為主的手勢（|deltaX| > |deltaY|），垂直捲動完全不受影響。
   *
   * deps 一定要有 hasOrders：訂單是非同步載入的，首次 render 走的是
   * 「暫無資料」分支、牌組不存在 → deckRef.current 是 null。deps 若給 []，
   * 訂單載進來後 effect 不會重跑，監聽就永遠掛不上（滑動整個失效）。
   */
  const hasOrders = orders.length > 0;
  const swipeLock = useRef(false);
  const swipeIdle = useRef<number | undefined>(undefined);
  const deckRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = deckRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // 垂直手勢 · 放行
      if (Math.abs(e.deltaX) < 8) return;                   // 微小抖動 · 忽略
      e.preventDefault();
      window.clearTimeout(swipeIdle.current);
      swipeIdle.current = window.setTimeout(() => { swipeLock.current = false; }, 180);
      if (swipeLock.current) return;
      swipeLock.current = true;
      const dir = e.deltaX > 0 ? 1 : -1;
      setPage((p) => Math.min(DECK.length - 1, Math.max(0, p + dir)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(swipeIdle.current);
    };
  }, [hasOrders]);

  const batchDateDisplay = batchKpi.batchDate ? batchKpi.batchDate.slice(5).replace("-", "/") : "—";
  const topMax = topProducts[0]?.qty ?? 1;
  const maxRevenue = Math.max(...monthTrend.map((m) => m.revenue), 1);
  const maxBatchOrders = Math.max(...batchTrend.map((b) => b.orders), 1);
  // 高亮「最後一批有單的」而非軸上最後一格 —— 補滿之後最後一格常常是未來的空批
  const hotBatch = [...batchTrend].reverse().find((b) => b.orders > 0)?.date ?? null;
  const hotMonth = [...monthTrend].reverse().find((m) => m.revenue > 0)?.month ?? null;
  const currentYM = todayIso.slice(0, 7);
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "";

  // 出爐量的軸：格數塞得下就看批，塞不下退成月。用格數而非期間當門檻 ——
  // 「全部」在資料還少時（10 批）仍看得到批，資料長出來後自動退成月。
  const useBatchAxis = batchTrend.length > 0 && batchTrend.length <= MAX_BATCH_BARS;
  const maxMonthOrders = Math.max(...monthTrend.map((m) => m.orders), 1);
  const hotMonthOrders = [...monthTrend].reverse().find((m) => m.orders > 0)?.month ?? null;

  // 空狀態 = 換電腦 / 清 cache / 剛按過清空 —— 正是最需要「還原備份」的一刻。
  // Yen 2026-07-16：這裡原本只掛 PeriodChips，BackupControls 不在，
  // 於是「資料歸零 → 想還原 → 沒有按鈕」成了死路（拖檔上傳只吃 .xlsx、不吃備份 .json）。
  if (orders.length === 0) {
    return (
      <div className="h-full flex flex-col min-h-0" style={{ fontFamily: F.tc }}>
        <PageHeader caption="DASHBOARD · 跨批統計" title="OVEN CENTRAL"
          right={
            <div className="flex items-center" style={{ gap: 10 }}>
              <PeriodChips options={PERIODS} active={period} onChange={(k) => setPeriod(k as Period)} />
              <BackupControls refreshOrders={refreshOrders} restoreOnly />
            </div>
          } />
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <div style={{ margin: "40px 24px", padding: "32px 24px", background: "#0F0F12", border: "1px solid #26262C", borderLeft: `3px solid ${EMBER}`, fontFamily: F.mono, fontSize: 13, color: "#8A8A93", lineHeight: 1.9 }}>
            <span style={{ fontFamily: F.tc, fontWeight: 900, color: EMBER }}>暫無資料</span>
            {" "}— 請上傳訂單 Excel 以開始。
            <br />
            換過電腦、清過瀏覽器資料、或剛清空？按右上角{" "}
            <span style={{ fontFamily: F.tc, fontWeight: 700, color: "#C9C9CF" }}>↺ 還原備份</span>
            {" "}讀回先前的 .json 備份檔。
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden" style={{ fontFamily: F.tc }}>
      <PageHeader caption="DASHBOARD · 跨批統計" title="OVEN CENTRAL"
        right={
          <div className="flex items-center" style={{ gap: 10 }}>
            <PeriodChips options={PERIODS} active={period} onChange={(k) => setPeriod(k as Period)} />
            <ExportBtn
              label="匯出彙總"
              filename="dashboard_period_summary"
              onExport={() => writePeriodSummaryExcel(orders, menu, { type: "all" })}
            />
            <BackupControls refreshOrders={refreshOrders} />
          </div>
        } />

      {/* ── 釘住層 1：KPI 六宮格 ─────────────────────────────────── */}
      <div style={{ flex: "none", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, padding: "10px 24px 12px" }}>
        <Kpi accent="var(--acc,#F5D400)" label={`本批出爐 · ${batchDateDisplay}`}
          foot={Object.entries(batchKpi.otherAtoms).slice(0, 3).map(([id, n]) => `+${n} ${getDisplayName(id, menu)}`).join(" · ") || "—"}>
          <BigNum v={batchKpi.cinnamonCount} />
          <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 14, color: "#8A8A93", marginLeft: 7 }}>顆肉桂捲</span>
        </Kpi>
        <Kpi label="活躍訂單" foot={channelShare.slice(0, 3).map((c) => `${c.label}${c.count}`).join(" ") || "—"}>
          <BigNum v={kpi.active} />
        </Kpi>
        <Kpi accent="#43B23C" labelColor="#43B23C" label="CONFIRMED" foot="主軌通過">
          <BigNum v={kpi.confirmed} />
        </Kpi>
        <Kpi accent={EMBER} labelColor={EMBER} label="待處理桶" foot="標籤未定">
          <BigNum v={kpi.pending} color={EMBER} />
        </Kpi>
        <Kpi accent="#43B23C" labelColor="#43B23C" label="消失待確認"
          foot={kpi.disappeared === 0 ? "✓ 可產出" : `${kpi.disappeared} 筆待確認`}
          footColor={kpi.disappeared === 0 ? "#43B23C" : EMBER}>
          <BigNum v={kpi.disappeared} color={kpi.disappeared === 0 ? "#F5F4EF" : EMBER} />
        </Kpi>
        <Kpi label="本月 GMV" foot={kpi.currentMonthGmv > 0 ? "已確認訂單加總" : "暫無本月訂單"} footColor={kpi.currentMonthGmv > 0 ? "#43B23C" : "#6C6C74"}>
          <span style={{ fontFamily: F.mono, fontSize: 14, color: "#8A8A93" }}>NT$</span>
          <BigNum v={kpi.currentMonthGmv.toLocaleString()} size={32} />
        </Kpi>
      </div>

      {/* ── 釘住層 2：產出閘門燈號 ───────────────────────────────── */}
      <HealthStrip checks={healthChecks} gate={releaseGate} />

      {/* ── 牌組：P1 趨勢 / P2 結構 · 兩指左右滑翻頁 ─────────────── */}
      <div ref={deckRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {page === 0 && (
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(330px,1fr))", gap: 12, padding: "12px 24px 0" }}>
          {/* 出爐量趨勢 · 一格 = 一批出貨日（格數塞不下時退成月）· 空格照樣佔位 */}
          <PanelBox>
            <PanelHead title="出爐量趨勢" sub={useBatchAxis ? "訂單數 / 批" : "訂單數 / 月"}
              right={<span style={{ fontFamily: F.mono, fontSize: 11, color: "var(--acc,#F5D400)" }}>● 週二出爐</span>} />
            {batchTrend.length === 0 && monthTrend.length === 0 ? <EmptyRow /> : (
              <BarField>
                {useBatchAxis
                  ? batchTrend.map((b) => {
                      const isHot = b.date === hotBatch;
                      return (
                        <Bar key={b.date}
                          label={b.date.slice(5).replace("-", "/")}
                          v={b.orders === 0 ? "·" : String(b.orders)}
                          pct={(b.orders / maxBatchOrders) * 100}
                          color={isHot ? "var(--acc,#F5D400)" : "#2E2E34"}
                          isHot={isHot}
                          empty={b.orders === 0} />
                      );
                    })
                  : monthTrend.map((m) => {
                      const isHot = m.month === hotMonthOrders;
                      return (
                        <Bar key={m.month}
                          label={m.month.slice(5).replace(/^0/, "") + "月"}
                          v={m.orders === 0 ? "·" : String(m.orders)}
                          pct={(m.orders / maxMonthOrders) * 100}
                          color={isHot ? "var(--acc,#F5D400)" : "#2E2E34"}
                          isHot={isHot}
                          empty={m.orders === 0} />
                      );
                    })}
              </BarField>
            )}
          </PanelBox>

          {/* 月營收趨勢 */}
          <PanelBox>
            <PanelHead title="月營收趨勢" sub="NT$ · 含運"
              right={(() => {
                // 只比「有營收的」最後兩個月：補滿空月後，拿 0 當基期會算出假的 -100%
                const withRev = monthTrend.filter((m) => m.revenue > 0);
                if (withRev.length < 2) return null;
                const prev = withRev[withRev.length - 2]!.revenue;
                const curr = withRev[withRev.length - 1]!.revenue;
                const pct = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
                return <span style={{ fontFamily: F.mono, fontSize: 11, color: pct >= 0 ? "#43B23C" : "#E5352B" }}>{pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%</span>;
              })()} />
            {monthTrend.length === 0 ? <EmptyRow /> : (
              <>
                <BarField>
                  {monthTrend.map((m) => {
                    const isLatest = m.month === hotMonth;
                    const isCurrentMonth = m.month === currentYM;
                    const isEmpty = m.revenue === 0;
                    const shortLabel = m.month.slice(5).replace(/^0/, "") + "月" + (isCurrentMonth ? "*" : "");
                    const revLabel = m.revenue >= 1000 ? `${(m.revenue / 1000).toFixed(1)}k` : m.revenue.toLocaleString();
                    return (
                      <Bar key={m.month}
                        label={shortLabel}
                        v={isEmpty ? "·" : revLabel}
                        pct={(m.revenue / maxRevenue) * 100}
                        color={isLatest ? "#2AC7E8" : "#2E2E34"}
                        isHot={isLatest}
                        hatch={isCurrentMonth && !isEmpty}
                        empty={isEmpty} />
                    );
                  })}
                </BarField>
                {monthTrend.some((m) => m.month === currentYM) && (
                  <div style={{ flex: "none", fontFamily: F.mono, fontSize: 10, color: "#6C6C74", marginTop: 8, textAlign: "right" }}>* 本月至今 · 進行中</div>
                )}
              </>
            )}
          </PanelBox>
        </div>
      )}

      {page === 1 && (
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, padding: "12px 24px 0" }}>
          {/* 通路占比 */}
          <PanelBox>
            <PanelHead title="通路占比" />
            {channelShare.length === 0 ? <EmptyRow /> : (
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                <div style={{ display: "flex", height: 26, marginBottom: 16 }}>
                  {channelShare.map((c) => <div key={c.label} style={{ width: `${c.pct}%`, background: c.color }} />)}
                </div>
                {channelShare.map((c) => (
                  <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: F.mono, fontSize: 12, marginBottom: 8 }}>
                    <span style={{ width: 9, height: 9, background: c.color, flexShrink: 0, display: "inline-block" }} />
                    <span style={{ flex: 1, color: "#C9C9CF" }}>{c.label}</span>
                    <span style={{ color: "#7A7A82" }}>{c.count} · {c.pct.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}
          </PanelBox>

          {/* 回頭率 */}
          <PanelBox>
            <PanelHead title="客戶回頭率" />
            <div style={{ flex: "none", display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontFamily: F.anton, fontSize: 46, color: "#2AC7E8", lineHeight: 0.85 }}>
                {repeatStats.totalUnique > 0 ? `${Math.round(repeatStats.repeatPct)}%` : "—"}
              </span>
              <span style={{ fontFamily: F.mono, fontSize: 11, color: "#7A7A82" }}>{repeatStats.repeatCount} / {repeatStats.totalUnique} 位</span>
            </div>
            <div style={{ flex: "none", height: 1, background: "#26262C", margin: "14px 0" }} />
            <div style={{ flex: "none", fontFamily: F.mono, fontSize: 10, color: "#6C6C74", letterSpacing: ".1em", marginBottom: 10 }}>TOP 回頭客</div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {repeatStats.topRepeats.length === 0 ? (
                <div style={{ fontFamily: F.mono, fontSize: 12, color: "#6C6C74" }}>暫無回頭客</div>
              ) : repeatStats.topRepeats.map(({ key, count }) => (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: 12, marginBottom: 7 }}>
                  <span style={{ color: "#C9C9CF" }}>{key}</span>
                  <span style={{ color: "#7A7A82" }}>{count} 單</span>
                </div>
              ))}
            </div>
          </PanelBox>

          {/* TOP 10 品項 · sub 跟著期間走（原本寫死「本月」但根本沒過濾時間） */}
          <PanelBox>
            <PanelHead title="TOP 10 品項" sub={`份 · ${periodLabel}`} />
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {topProducts.length === 0 ? <EmptyRow /> : topProducts.map((it, i) => {
                const isLead = i === 0;
                const barW = Math.round((it.qty / topMax) * 100);
                return (
                  <div key={it.skuId} style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: F.mono, marginBottom: 9 }}>
                    <span style={{ width: 20, color: isLead ? "var(--acc,#F5D400)" : "#7A7A82", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span style={{ width: "40%", fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#E7E7EA", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {getDisplayName(it.skuId, menu)}
                    </span>
                    <div style={{ flex: 1, height: 13, background: "#161619" }}>
                      <div style={{ width: `${barW}%`, height: 13, background: isLead ? "var(--acc,#F5D400)" : "#3E3E46" }} />
                    </div>
                    <span style={{ width: 24, textAlign: "right", fontSize: 12, color: "#C9C9CF" }}>{it.qty}</span>
                  </div>
                );
              })}
            </div>
          </PanelBox>
        </div>
      )}
      </div>

      <Pager active={page} onChange={setPage} />
    </div>
  );
}
