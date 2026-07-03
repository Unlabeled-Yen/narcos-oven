/**
 * LabelsPage 的子元件（LabelCard / LabelPage）。
 *
 * 依真實出貨標籤 JPG 重寫（2026-07-03）：
 *   純白紙、黑字、置中、三張一頁、虛線裁切。
 *   通路差異只在 top_line / mid_line / bottom_line 的字級與意涵。
 *
 * label-data.ts 的三行契約：
 *   賣貨便: top=訂單後5碼 | mid=分盒編號+品項簡稱 | bottom=門市
 *   面交:   top=中壢面交/台中面交/面交 | mid=分盒編號+品項簡稱 | bottom=IG
 *   KOL:    top=KOL | mid=@IG | bottom=分盒編號+品項簡稱
 *   宅配/待分類：走面交同版式
 */
import type { LabelData } from "../../output/label-data";

// ── 字型常數 ──────────────────────────────────────────────────
export const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
} as const;

// ── 顏色常數（深色 UI + 純白標籤兩套） ──────────────────────
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
  // 標籤紙（依真實 JPG）：純白 + 黑字 + 灰虛線
  paper: "#FFFFFF",
  paperInk: "#0B0B0C",
  paperMut: "#8A8A8A",
  dash: "#B8B8B8",
} as const;

export const LABEL_W = 590;
export const LABEL_H = 315;
export const LABELS_PER_PAGE = 3;

// ── 單張標籤（極簡黑白） ─────────────────────────────────────
export function LabelCard({
  label,
  isLast,
}: {
  label: LabelData;
  isLast: boolean;
  sizeLabel?: string;
}) {
  const isSellerBuy = label.kind === "賣貨便";
  const isKOL = label.kind === "KOL";
  // 面交 / 宅配 / 待分類 共用同版式（頂部通路大字）

  return (
    <div
      style={{
        position: "relative",
        width: LABEL_W,
        height: LABEL_H,
        background: C.paper,
        borderBottom: isLast ? "none" : `1.5px dashed ${C.dash}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "22px 24px 18px",
        boxSizing: "border-box",
      }}
    >
      {/* 上區塊：三行主資訊 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          gap: 6,
          width: "100%",
        }}
      >
        {/* Top line：通路頭銜或訂單編號 */}
        {isSellerBuy ? (
          // 賣貨便：訂單後 5 碼，最大 Anton
          <div
            style={{
              fontFamily: F.anton,
              fontSize: 82,
              color: C.paperInk,
              lineHeight: 0.9,
              letterSpacing: "0.02em",
            }}
          >
            {label.top_line}
          </div>
        ) : isKOL ? (
          // KOL：頂 "KOL" Anton 極大
          <div
            style={{
              fontFamily: F.anton,
              fontSize: 76,
              color: C.paperInk,
              lineHeight: 0.9,
              letterSpacing: "0.05em",
            }}
          >
            {label.top_line}
          </div>
        ) : (
          // 面交/宅配/待分類：頂 = 通路大字（中壢面交/台中面交/面交/宅配/待分類）
          <div
            style={{
              fontFamily: F.tc,
              fontWeight: 900,
              fontSize: 52,
              color: C.paperInk,
              lineHeight: 1,
              letterSpacing: "0.04em",
            }}
          >
            {label.top_line}
          </div>
        )}

        {/* Mid line：KOL 是 @handle 放大，其他是分盒+品項 */}
        {isKOL ? (
          <div
            style={{
              fontFamily: F.tc,
              fontWeight: 500,
              fontSize: 34,
              color: C.paperInk,
              lineHeight: 1.1,
              marginTop: 4,
            }}
          >
            {label.mid_line}
          </div>
        ) : (
          <div
            style={{
              fontFamily: F.tc,
              fontWeight: 500,
              fontSize: 26,
              color: C.paperInk,
              lineHeight: 1.15,
              marginTop: 2,
              textAlign: "center",
            }}
          >
            {label.mid_line}
          </div>
        )}
      </div>

      {/* 下區塊：底部灰字（門市 / IG / 分盒+品項） */}
      <div
        style={{
          fontFamily: F.tc,
          fontWeight: 500,
          fontSize: isKOL ? 20 : 18,
          color: C.paperMut,
          textAlign: "center",
          width: "100%",
        }}
      >
        {label.bottom_line}
      </div>

      {/* 資料不一致警告（極小、右下角） */}
      {label.warning && (
        <div
          style={{
            position: "absolute",
            bottom: 3,
            right: 8,
            fontFamily: F.mono,
            fontSize: 8,
            color: C.red,
          }}
        >
          ⚠ {label.warning}
        </div>
      )}
    </div>
  );
}

// ── 一頁（最多 3 張） ────────────────────────────────────────
export function LabelPage({
  labels,
}: {
  labels: LabelData[];
  sizeLabel?: string;
  pageIndex?: number;
  totalPages?: number;
}) {
  return (
    <div
      style={{
        background: C.paper,
        width: LABEL_W,
        maxWidth: "100%",
        boxShadow: "0 30px 70px rgba(0,0,0,.5)",
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
