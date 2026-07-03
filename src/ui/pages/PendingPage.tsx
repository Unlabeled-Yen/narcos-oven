/**
 * PendingPage — 待處理桶（鍵盤優先）
 *
 * 設計稿：design_handoff_oven_control/出爐指揮台 待處理桶.dc.html
 * 品牌 pattern：DashboardPage.demo.tsx
 * DB 寫法：PendingPage.helpers.ts（沿用 PendingBucket.tsx 的 db.orders.update）
 *
 * 憲章紅線：
 *  #1  品項顯示經 getDisplayName（禁 hardcode）
 *  #2  建議來自 pendingReasons.suggestion，不呼叫 LLM
 *  #9  產出閘門：未清空=紅鎖 / 清空=綠開
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PendingReasonCode } from "../../domain/models";
import { PageHeader } from "../brand/PageHeader";
import type { PageProps } from "./types";
import {
  C, F,
  REASON_CONFIG,
  isPending, primaryReason, productSummary, recipientStr,
  buildOptions,
  resolveOrderByOption, resolveOrderBySuggestion,
} from "./PendingPage.helpers";

// ── Sub-components ──────────────────────────────────────────────────────────

function ReasonChip({
  label, color, count, active, onClick,
}: {
  label: string; color: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={{
      fontFamily: F.tc, fontWeight: 700, fontSize: 12,
      padding: "5px 12px", cursor: "pointer", border: "none", borderRadius: 0,
      ...(active
        ? { background: C.ink, color: "#111" }
        : { background: "transparent", border: `1px solid ${color}`, color }),
    }}>
      {label} {count}
    </button>
  );
}

function OptionBtn({
  num, label, isSuggest, onClick,
}: {
  num: number; label: string; isSuggest: boolean; onClick: () => void;
}) {
  if (isSuggest) {
    return (
      <button type="button" onClick={onClick} style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        fontFamily: F.tc, fontWeight: 900, fontSize: 13,
        color: "#111", background: C.acc, padding: "8px 14px",
        cursor: "pointer", border: "none", borderRadius: 0,
        boxShadow: "3px 3px 0 rgba(245,212,0,.25)",
      }}>
        <span style={{ fontFamily: F.mono, fontSize: 11, background: "#111", color: C.acc, padding: "1px 6px" }}>
          {num}
        </span>
        {label}
        <span style={{ fontFamily: F.mono, fontSize: 9, opacity: 0.7 }}>建議</span>
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 7,
      fontFamily: F.tc, fontWeight: 700, fontSize: 13,
      color: C.ink3, background: "transparent",
      border: `1px solid ${C.line}`, padding: "8px 14px",
      cursor: "pointer", borderRadius: 0,
    }}>
      <span style={{ fontFamily: F.mono, fontSize: 11, background: C.track, color: C.mut, padding: "1px 6px" }}>
        {num}
      </span>
      {label}
    </button>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export function PendingPage(props: PageProps) {
  const { orders, menu, refreshOrders } = props;

  const pendingOrders = orders.filter(isPending);

  const [activeFilter, setActiveFilter] = useState<PendingReasonCode | "ALL">("ALL");
  const [focusIdx, setFocusIdx]         = useState(0);
  const [resolvedSet, setResolvedSet]   = useState<Set<string>>(new Set());
  const [busy, setBusy]                 = useState(false);
  const focusRef = useRef(focusIdx);
  focusRef.current = focusIdx;

  // Reason chip counts
  const reasonCounts = new Map<PendingReasonCode, number>();
  for (const o of pendingOrders) {
    const code = primaryReason(o)?.code;
    if (code) reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + 1);
  }

  const visibleOrders =
    activeFilter === "ALL"
      ? pendingOrders
      : pendingOrders.filter((o) => primaryReason(o)?.code === activeFilter);

  useEffect(() => {
    setFocusIdx((p) => Math.min(p, Math.max(0, visibleOrders.length - 1)));
  }, [visibleOrders.length]);

  // ── Mutation helpers ────────────────────────────────────────────────────
  const pickOption = useCallback(async (orderId: string, optionValue: string) => {
    if (busy) return;
    const o = pendingOrders.find((x) => x.id === orderId);
    if (!o) return;
    setBusy(true);
    try {
      await resolveOrderByOption(o, optionValue, menu);
      setResolvedSet((prev) => new Set(prev).add(orderId));
      await refreshOrders();
    } catch (err) {
      // 憲章 #2 loud 失敗（例如 batchDate 非 ISO）
      // eslint-disable-next-line no-console
      console.error("[PendingPage.pickOption] resolve 失敗:", err);
      alert(`resolve 失敗：${(err as Error).message}`);
    } finally { setBusy(false); }
  }, [busy, pendingOrders, menu, refreshOrders]);

  const acceptSuggestion = useCallback(async () => {
    const o = visibleOrders[focusRef.current];
    if (!o || busy) return;
    setBusy(true);
    try {
      const ok = await resolveOrderBySuggestion(o, menu);
      if (ok) {
        setResolvedSet((prev) => new Set(prev).add(o.id));
        await refreshOrders();
      }
    } finally { setBusy(false); }
  }, [busy, visibleOrders, menu, refreshOrders]);

  const undo = useCallback((idx: number) => {
    const o = visibleOrders[idx];
    if (!o) return;
    setResolvedSet((prev) => { const n = new Set(prev); n.delete(o.id); return n; });
  }, [visibleOrders]);

  const resolveAll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      for (const o of visibleOrders) {
        if (!resolvedSet.has(o.id)) {
          await resolveOrderBySuggestion(o, menu);
          setResolvedSet((prev) => new Set(prev).add(o.id));
        }
      }
      await refreshOrders();
    } finally { setBusy(false); }
  }, [busy, visibleOrders, resolvedSet, menu, refreshOrders]);

  // ── Keyboard ────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const k = e.key;
      if (k === "j" || k === "ArrowDown") {
        e.preventDefault(); setFocusIdx((p) => Math.min(p + 1, visibleOrders.length - 1));
      } else if (k === "k" || k === "ArrowUp") {
        e.preventDefault(); setFocusIdx((p) => Math.max(p - 1, 0));
      } else if (k === "Enter") {
        e.preventDefault(); acceptSuggestion();
      } else if (k === "Backspace") {
        e.preventDefault(); undo(focusRef.current);
      } else if (/^[1-9]$/.test(k)) {
        const o = visibleOrders[focusRef.current];
        if (!o) return;
        const opts = buildOptions(o, menu);
        const opt = opts[parseInt(k, 10) - 1];
        if (opt) { e.preventDefault(); pickOption(o.id, opt.value ?? opt.label); }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleOrders, acceptSuggestion, undo, pickOption, menu]);

  // ── Progress ────────────────────────────────────────────────────────────
  const total = pendingOrders.length;
  const done  = resolvedSet.size;
  const remaining = total - done;
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  const isGateOpen = remaining === 0;

  // ── Empty state ─────────────────────────────────────────────────────────
  if (total === 0) {
    return (
      <div className="h-full flex flex-col min-h-0" style={{ fontFamily: F.tc, background: C.bg }}>
        <PageHeader caption="PENDING · 主軌的一等公民出口 · 非錯誤" title="待處理桶" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 24px", gap: 16 }}>
          <div style={{ fontFamily: F.anton, fontSize: 64, color: C.green, lineHeight: 1 }}>✓</div>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 24, color: C.ink }}>桶已清空</div>
          <div style={{ fontFamily: F.mono, fontSize: 13, color: C.mut }}>可產出 Excel / PDF / 出爐統計</div>
          <div style={{ marginTop: 16, background: C.panel, border: `1px solid ${C.green}`, borderLeft: `3px solid ${C.green}`, padding: "14px 20px" }}>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: C.green }}>✓ 產出閘門已開 · 憲章 #9</div>
            <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 11, color: C.mut, marginTop: 5 }}>待處理桶清空 · 可產出出爐統計 / 標籤 PDF</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col min-h-0" style={{ fontFamily: F.tc, background: C.bg }}>
      <PageHeader
        caption="PENDING · 主軌的一等公民出口 · 非錯誤"
        title="待處理桶"
        right={
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontFamily: F.anton, fontSize: 34, color: C.orange }}>{remaining}</span>
            <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 16, color: C.mut }}>筆待拍板</span>
          </div>
        }
      />

      {/* Action row + filter chips */}
      <div style={{ padding: "0 24px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={resolveAll} disabled={busy} style={{
            fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: "#111",
            background: C.acc, padding: "9px 16px",
            cursor: busy ? "not-allowed" : "pointer", border: "none", borderRadius: 0, opacity: busy ? 0.6 : 1,
          }}>
            ⏎ 全採用建議 ×{remaining}
          </button>
          <button type="button" onClick={() => { setResolvedSet(new Set()); setFocusIdx(0); }} disabled={busy} style={{
            fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: C.mut,
            background: "transparent", border: `1px solid ${C.line}`,
            padding: "9px 16px", cursor: busy ? "not-allowed" : "pointer", borderRadius: 0,
          }}>
            重置
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ReasonChip label="全部" color={C.ink} count={total} active={activeFilter === "ALL"}
            onClick={() => { setActiveFilter("ALL"); setFocusIdx(0); }} />
          {Array.from(reasonCounts.entries()).map(([code, count]) => (
            <ReasonChip key={code} label={REASON_CONFIG[code].label} color={REASON_CONFIG[code].color}
              count={count} active={activeFilter === code}
              onClick={() => { setActiveFilter(code); setFocusIdx(0); }} />
          ))}
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "2.4fr 1fr", gap: 12, padding: "8px 24px 16px", flex: 1, minHeight: 0 }}>

        {/* ── Left: order list ── */}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0, overflowY: "auto" }}>
          {visibleOrders.map((o, i) => {
            const isFocus   = i === focusIdx;
            const isResolved = resolvedSet.has(o.id);
            const reason    = primaryReason(o);
            const cfg       = reason ? REASON_CONFIG[reason.code] : null;
            const accentBar = isResolved ? C.green : (cfg?.color ?? C.line);
            const conf      = reason?.suggestionConfidence ?? 0;
            const opts      = isFocus ? buildOptions(o, menu) : [];

            return (
              <div key={o.id} onClick={() => setFocusIdx(i)} style={{
                background: isFocus ? "#141417" : C.panel,
                border: `1px solid ${isFocus ? "#3a3a40" : C.line}`,
                borderLeft: `3px solid ${accentBar}`,
                padding: "13px 15px", cursor: "pointer",
              }}>
                {/* Header row */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontFamily: F.mono, fontSize: 12, color: "#6C6C74", width: 12 }}>
                    {isFocus ? "▼" : "▶"}
                  </span>
                  <span style={{ fontFamily: F.mono, fontSize: 12, color: C.ink3 }}>{o.id}</span>
                  {cfg && (
                    <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 10, color: cfg.color, border: `1px solid ${cfg.color}`, padding: "2px 8px" }}>
                      {cfg.label}
                    </span>
                  )}
                  {reason?.code && (
                    <span style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74" }}>{reason.code}</span>
                  )}
                  <span style={{ flex: 1 }} />
                  {isResolved
                    ? <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 11, color: "#111", background: C.green, padding: "3px 10px" }}>✓ 已拍板</span>
                    : reason && (
                      <span style={{ fontFamily: F.mono, fontSize: 11, color: conf >= 0.9 ? C.green : C.mut }}>
                        建議信心 {Math.round(conf * 100)}%
                      </span>
                    )
                  }
                </div>

                {/* Collapsed */}
                {!isFocus && (
                  <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: C.mut, marginTop: 7, marginLeft: 22 }}>
                    {recipientStr(o)} · {productSummary(o, menu)}
                  </div>
                )}

                {/* Expanded */}
                {isFocus && (
                  <div style={{ marginTop: 12, marginLeft: 22 }}>
                    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontFamily: F.tc, fontSize: 12, marginBottom: 12 }}>
                      <span style={{ color: C.mut }}>收件 <span style={{ color: "#E7E7EA", fontWeight: 700 }}>{recipientStr(o)}</span></span>
                      <span style={{ color: C.mut }}>品項 <span style={{ color: "#E7E7EA", fontWeight: 700 }}>{productSummary(o, menu)}</span></span>
                    </div>
                    {reason?.humanMessage && (
                      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
                        <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 16, color: C.ink }}>
                          ⚠ {reason.humanMessage}
                        </span>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {opts.map((opt, oi) => (
                        <OptionBtn key={opt.label} num={oi + 1} label={opt.label} isSuggest={opt.isSuggest}
                          onClick={() => pickOption(o.id, opt.value ?? opt.label)} />
                      ))}
                    </div>
                    <div style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", marginTop: 12 }}>
                      數字鍵 選項 · ⏎ 採用建議 · ⌫ 復原 · J/K 換筆
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          </div>{/* end scrolling list */}

          {/* Cross-filter hint */}
          {activeFilter !== "ALL" && pendingOrders.length > visibleOrders.length && (
            <div style={{ background: "#0d0d0f", border: `1px dashed ${C.line}`, padding: "12px 15px", fontFamily: F.mono, fontSize: 11, color: "#6C6C74", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span style={{ color: C.cyan }}>＋ {pendingOrders.length - visibleOrders.length}</span> 其他類別待處理
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => setActiveFilter("ALL")} style={{ color: "#111", background: C.cyan, fontFamily: F.tc, fontWeight: 900, fontSize: 11, padding: "4px 10px", border: "none", cursor: "pointer", borderRadius: 0 }}>
                顯示全部
              </button>
            </div>
          )}
        </div>{/* end left column */}

        {/* ── Right rail ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0, minHeight: 0, overflowY: "auto" }}>

          {/* Progress */}
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 16 }}>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: C.ink, marginBottom: 12 }}>處理進度</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
              <span style={{ fontFamily: F.anton, fontSize: 36, color: C.ink, lineHeight: 0.85 }}>{done}</span>
              <span style={{ fontFamily: F.mono, fontSize: 12, color: C.mut2 }}>/ {total} 已拍板</span>
            </div>
            <div style={{ height: 12, background: C.track }}>
              <div style={{ width: `${pct}%`, height: 12, background: C.green, transition: "width .3s" }} />
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", marginTop: 6, textAlign: "right" }}>剩 {remaining} 筆</div>
          </div>

          {/* 產出閘門 (憲章 #9) */}
          {!isGateOpen ? (
            <div style={{ background: C.panel, border: `1px solid ${C.orange}`, borderLeft: `3px solid ${C.orange}`, padding: "14px 16px" }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: C.orange }}>🔒 產出閘門 · 憲章 #9</div>
              <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 11, color: C.mut, marginTop: 5 }}>
                尚有 {remaining} 筆未拍板 · Excel / PDF / 標籤產出 disabled
              </div>
            </div>
          ) : (
            <div style={{ background: C.panel, border: `1px solid ${C.green}`, borderLeft: `3px solid ${C.green}`, padding: "14px 16px" }}>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: C.green }}>✓ 產出閘門已開 · 憲章 #9</div>
              <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 11, color: C.mut, marginTop: 5 }}>待處理桶清空 · 可產出出爐統計 / 標籤 PDF</div>
              <span style={{ display: "inline-block", marginTop: 10, fontFamily: F.tc, fontWeight: 900, fontSize: 11, color: "#111", background: C.green, padding: "7px 14px", cursor: "pointer" }}>
                產出全部 →
              </span>
            </div>
          )}

          {/* 鍵盤速查 */}
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 16 }}>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 15, color: C.ink, marginBottom: 12 }}>鍵盤速查</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { key: "J / K", desc: "下一筆 / 上一筆" },
                { key: "↑ / ↓", desc: "下一筆 / 上一筆" },
                { key: "1–9",   desc: "選分類選項" },
                { key: "⏎",     desc: "採用建議答案", acc: true },
                { key: "⌫",     desc: "復原此筆" },
              ].map(({ key, desc, acc }) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontFamily: F.mono, fontSize: 11, color: "#0B0B0C", background: acc ? C.acc : C.ink3, padding: "2px 8px", fontWeight: 700 }}>{key}</span>
                  <span style={{ fontFamily: F.mono, fontSize: 11, color: C.mut }}>{desc}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}`, fontFamily: F.tc, fontWeight: 500, fontSize: 11, color: "#6C6C74" }}>
              信心 ≥ 90% 的建議會以品牌黃 highlight，可直接 ⏎ 連按清桶。
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
