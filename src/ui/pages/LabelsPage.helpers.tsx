/**
 * LabelsPage 的子元件（LabelCard / LabelPage）。
 * 故意獨立以符合 500 行上限，由 LabelsPage.tsx import。
 */
import type { LabelData } from "../../output/label-data";

// ── 字型常數 ──────────────────────────────────────────────────
export const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
} as const;

// ── 顏色常數 ──────────────────────────────────────────────────
export const C = {
  bg: "#08080A",
  panel: "#0F0F12",
  card: "#111114",
  line: "#26262C",
  line2: "#161619",
  ink: "#F5F4EF",
  mut: "#8A8A93",
  mut2: "#7A7A82",
  mut3: "#6C6C74",
  acc: "var(--acc,#F5D400)",
  accHex: "#F5D400",
  red: "#E5352B",
  orange: "#E5622A",
  paper: "#F5F1E6",
  dash: "#b8ae95",
} as const;

export const LABEL_W = 590;
export const LABEL_H = 315;
export const LABELS_PER_PAGE = 3;

// ── 單張標籤 ─────────────────────────────────────────────────
export function LabelCard({
  label,
  isLast,
  sizeLabel,
}: {
  label: LabelData;
  isLast: boolean;
  sizeLabel: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: LABEL_W,
        height: LABEL_H,
        background: C.paper,
        borderBottom: isLast ? "none" : `1.5px dashed ${C.dash}`,
        boxSizing: "border-box",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      {/* Top row: NARCOS badge + FRAGILE + 分盒編號 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: C.accHex,
            padding: "3px 11px",
            borderRadius: 999,
            transform: "skewX(-6deg)",
            border: "1.5px solid #111",
          }}
        >
          <span style={{ fontFamily: F.anton, fontSize: 15, color: "#111", transform: "skewX(6deg)" }}>
            NARCOS
          </span>
          <span
            style={{
              fontFamily: F.mono,
              fontSize: 9,
              fontWeight: 700,
              color: C.red,
              transform: "skewX(6deg)",
            }}
          >
            sugar
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontFamily: F.anton,
              fontSize: 13,
              color: "#fff",
              background: "#111",
              padding: "2px 8px",
              letterSpacing: ".06em",
            }}
          >
            FRAGILE
          </span>
          {label.sub_number && (
            <span style={{ fontFamily: F.anton, fontSize: 26, color: C.red, lineHeight: 0.8 }}>
              {label.sub_number}
            </span>
          )}
        </div>
      </div>

      {/* 警示膠帶 */}
      <div
        style={{
          height: 6,
          background: `repeating-linear-gradient(45deg,${C.accHex} 0 9px,#111 9px 18px)`,
          margin: "8px 0",
        }}
      />

      {/* 出貨日 / 通路 / 訂單後八碼 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: F.mono, fontSize: 11, color: "#333" }}>
          出貨 {label.batch_date} · {label.kind}
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: "#888" }}>
          {label.order_id.length > 8 ? label.order_id.slice(-8) : label.order_id}
        </span>
      </div>

      {/* top_line（通路標示）+ mid_line（分盒+品項簡碼） */}
      <div style={{ margin: "6px 0 4px", display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            fontFamily: F.tc,
            fontWeight: 900,
            fontSize: 11,
            color: "#fff",
            background: "#111",
            padding: "2px 8px",
            whiteSpace: "nowrap",
          }}
        >
          {label.top_line}
        </span>
        <span
          style={{
            fontFamily: F.tc,
            fontWeight: 900,
            fontSize: 20,
            color: "#111",
            lineHeight: 1,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label.mid_line}
        </span>
      </div>

      {/* 收件人（bottom_line） */}
      <div
        style={{
          fontFamily: F.tc,
          fontWeight: 700,
          fontSize: 13,
          color: "#222",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label.bottom_line}
      </div>

      {/* HANDLE WITH CARE + 尺寸 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginTop: 6,
        }}
      >
        <span
          style={{
            fontFamily: F.tc,
            fontWeight: 900,
            fontSize: 9,
            color: C.red,
            letterSpacing: ".1em",
          }}
        >
          HANDLE WITH CARE · MUAH MUAH MUAH
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 9, color: "#999" }}>
          保存3天/常溫 · {sizeLabel}
        </span>
      </div>

      {/* 資料不一致警告 */}
      {label.warning && (
        <div
          style={{
            position: "absolute",
            bottom: 4,
            left: 8,
            fontFamily: F.mono,
            fontSize: 9,
            color: C.red,
          }}
        >
          ⚠ {label.warning}
        </div>
      )}
    </div>
  );
}

// ── 一頁（最多 3 張）────────────────────────────────────────────
export function LabelPage({
  labels,
  sizeLabel,
}: {
  labels: LabelData[];
  sizeLabel: string;
  pageIndex?: number;
  totalPages?: number;
}) {
  return (
    <div
      style={{
        background: C.paper,
        width: LABEL_W,
        maxWidth: "100%",
        boxShadow: "0 30px 70px rgba(0,0,0,.6)",
        display: "flex",
        flexDirection: "column",
      }}
      className="label-page"
    >
      {labels.map((l, i) => (
        <LabelCard
          key={`${l.order_id}-${l.index}`}
          label={l}
          isLast={i === labels.length - 1}
          sizeLabel={sizeLabel}
        />
      ))}
      {/* 不足 3 張時補空白留位（列印對齊用） */}
      {labels.length < LABELS_PER_PAGE &&
        Array.from({ length: LABELS_PER_PAGE - labels.length }).map((_, i) => (
          <div
            key={`empty-${i}`}
            style={{
              width: LABEL_W,
              height: LABEL_H,
              background: C.paper,
              borderTop: `1.5px dashed ${C.dash}`,
              opacity: 0.3,
            }}
          />
        ))}
    </div>
  );
}
