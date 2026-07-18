/**
 * ImportSanityModal · 匯入前預檢警告 modal
 *
 * Yen 2026-07-04：偵測到「這輪 xlsx 疑似舊備份」時彈出、讓雇主選繼續 or 取消
 * critical → 警示紅底 · warn → 橙 · notice → 黃
 * NARCOS 品牌深色設計 · 跟 ImportSummaryModal 同一套視覺基準
 */
import type { SanityReport, Severity, SourceStats } from "../domain/import-sanity";
import { SOURCE_NAME } from "../domain/import-sanity";

const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
} as const;

const C = {
  bg: "#0F0F12",
  card: "#141417",
  line: "#26262C",
  line2: "#1F1F24",
  ink: "#F5F4EF",
  mut: "#C9C9CF",
  mut2: "#8A8A93",
  mut3: "#6C6C74",
  acc: "var(--acc,#F5D400)",
  red: "#E5352B",
  orange: "#E5622A",
  green: "#43B23C",
  cyan: "#2AC7E8",
} as const;

const SEVERITY_META: Record<Severity, { color: string; label: string; note: string }> = {
  critical: { color: C.red,    label: "CRITICAL", note: "強烈建議取消匯入" },
  warn:     { color: C.orange, label: "WARN",     note: "建議取消匯入、對照原檔" },
  notice:   { color: C.acc,    label: "NOTICE",   note: "可繼續、留意" },
};

export function ImportSanityModal({
  report,
  fileNames,
  onProceed,
  onCancel,
}: {
  report: SanityReport;
  fileNames: string[];
  onProceed: () => void;
  onCancel: () => void;
}) {
  if (report.severity === "ok") return null;
  const meta = SEVERITY_META[report.severity];
  const canForce = report.severity !== "critical"; // critical 也讓過、但按鈕標紅字

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)", overflowY: "auto" }}
    >
      <div
        style={{
          background: C.bg,
          border: `1px solid ${meta.color}`,
          width: "100%",
          maxWidth: 720,
          maxHeight: "94vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ position: "sticky", top: 0, background: C.bg, zIndex: 2 }}>
          <div className="flex items-baseline justify-between flex-wrap" style={{ padding: "14px 20px 12px", gap: 12 }}>
            <div className="flex items-baseline flex-wrap" style={{ gap: 10 }}>
              <span style={{ fontFamily: F.mono, fontSize: 10, color: meta.color, letterSpacing: ".2em" }}>
                ⚠ IMPORT · SANITY · {meta.label}
              </span>
            </div>
            <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3 }}>
              {meta.note}
            </span>
          </div>
          <div style={{ height: 5, background: `repeating-linear-gradient(45deg, ${meta.color} 0 12px, #111 12px 24px)` }} />
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px 20px", overflowY: "auto" }}>
          <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 16, color: C.ink, marginBottom: 6 }}>
            這輪 xlsx 疑似為舊備份
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut2, marginBottom: 16 }}>
            檔案：{fileNames.join(" · ")}
          </div>

          {/* Per source stats · 三通路各自一 row · 低摩擦顯示 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, letterSpacing: ".14em", marginBottom: 8 }}>
              通路檢查明細
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {report.perSource.map((s) => (
                <SourceRow key={s.source} stats={s} highlight={meta.color} />
              ))}
            </div>
          </div>

          {/* Warnings */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
            {report.warnings.map((w, i) => {
              const m = SEVERITY_META[w.severity];
              return (
                <div
                  key={i}
                  style={{
                    background: C.card,
                    border: `1px solid ${C.line2}`,
                    borderLeft: `3px solid ${m.color}`,
                    padding: "10px 14px",
                  }}
                >
                  <div className="flex items-baseline flex-wrap" style={{ gap: 8, marginBottom: 4 }}>
                    <span style={{ fontFamily: F.mono, fontSize: 9, color: m.color, letterSpacing: ".14em" }}>
                      {m.label}
                    </span>
                    <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: C.ink }}>
                      {w.title}
                    </span>
                  </div>
                  <div style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 12, color: C.mut, lineHeight: 1.5 }}>
                    {w.detail}
                  </div>
                  {w.affectedIds && w.affectedIds.length > 0 && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ fontFamily: F.mono, fontSize: 10, color: C.mut2, cursor: "pointer" }}>
                        展開影響 {w.affectedIds.length} 筆訂單編號
                      </summary>
                      <div style={{ marginTop: 4, padding: "6px 10px", background: C.line2, fontFamily: F.mono, fontSize: 10, color: C.mut, wordBreak: "break-all", lineHeight: 1.6 }}>
                        {w.affectedIds.slice(0, 30).join(" · ")}
                        {w.affectedIds.length > 30 && <span style={{ color: C.mut3 }}> … 另 {w.affectedIds.length - 30} 筆</span>}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center flex-wrap" style={{ gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: "#111",
                background: C.green, border: `1px solid ${C.green}`,
                padding: "9px 18px", cursor: "pointer", letterSpacing: ".05em",
              }}
            >
              ✓ 取消匯入 · 回去對照原檔
            </button>
            <button
              type="button"
              onClick={onProceed}
              title={canForce ? "確認資料無誤、繼續匯入" : "強烈建議取消 · 除非你確定無誤"}
              style={{
                fontFamily: F.tc, fontWeight: 900, fontSize: 12,
                color: canForce ? C.mut : C.red,
                background: "transparent",
                border: `1px solid ${canForce ? C.line : C.red}`,
                padding: "9px 18px", cursor: "pointer", letterSpacing: ".05em",
              }}
            >
              {canForce ? "略過警告 · 繼續匯入" : "⚠ 強制繼續（不建議）"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceRow({ stats, highlight }: { stats: SourceStats; highlight: string }) {
  const skipped = stats.newCount === 0 || stats.dbCount === 0;
  const disappearHigh = stats.disappearRatio > 0.5;
  const dateBack =
    stats.maxOrderDateNew && stats.maxOrderDateDb && stats.maxOrderDateNew < stats.maxOrderDateDb;
  const hasIssue = !skipped && (stats.paymentReversedCount > 0 || disappearHigh || dateBack);
  const rowColor = skipped ? C.mut3 : hasIssue ? highlight : C.mut;
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.line2}`,
        borderLeft: `3px solid ${rowColor}`,
        padding: "8px 12px",
        display: "grid",
        gridTemplateColumns: "1.1fr 1fr 1fr 1.4fr",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div className="flex items-baseline" style={{ gap: 8 }}>
        <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: rowColor }}>
          {SOURCE_NAME[stats.source]}
        </span>
        {skipped && (
          <span style={{ fontFamily: F.mono, fontSize: 9, color: C.mut3, letterSpacing: ".05em" }}>
            {stats.newCount === 0 ? "· 本輪未匯入" : "· 目前尚無資料"}
          </span>
        )}
      </div>
      <div className="flex items-baseline" style={{ gap: 4 }}>
        <span style={{ fontFamily: F.anton, fontSize: 16, color: C.ink }}>{stats.newCount}</span>
        <span style={{ fontFamily: F.mono, fontSize: 9, color: C.mut3 }}>本輪</span>
        <span style={{ fontFamily: F.mono, fontSize: 9, color: C.mut3 }}>/</span>
        {/* 顯示「範圍內」筆數（消失比例的分母），不是通路全量。避免「50 目前 · 0% 消失」的錯覺。*/}
        <span style={{ fontFamily: F.anton, fontSize: 16, color: C.mut }}>{stats.dbInRangeCount}</span>
        <span style={{ fontFamily: F.mono, fontSize: 9, color: C.mut3 }}>目前</span>
        {stats.dbInRangeCount !== stats.dbCount && (
          <span style={{ fontFamily: F.mono, fontSize: 9, color: C.mut3 }}>
            （全 {stats.dbCount}）
          </span>
        )}
      </div>
      <div className="flex items-baseline" style={{ gap: 4 }}>
        <span
          style={{
            fontFamily: F.anton,
            fontSize: 16,
            color: disappearHigh ? highlight : C.mut,
          }}
        >
          {skipped ? "—" : `${(stats.disappearRatio * 100).toFixed(0)}%`}
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 9, color: C.mut3 }}>
          消失 {skipped ? "" : `(${stats.disappearCount})`}
        </span>
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 10, color: dateBack ? highlight : C.mut2, letterSpacing: ".03em" }}>
        {skipped
          ? "—"
          : stats.maxOrderDateNew && stats.maxOrderDateDb
          ? `${stats.maxOrderDateNew.slice(5)} vs 目前 ${stats.maxOrderDateDb.slice(5)}`
          : "無下單日資料"}
      </div>
    </div>
  );
}
