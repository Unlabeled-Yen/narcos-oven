/**
 * LabelsPage 的子元件（LabelCard / LabelPage）。
 *
 * #1 2026-08-06 改版：真實尺寸 4cm×3cm、一標一頁（Xprinter XP-P3301B，
 * 見 src/domain/label-layout.ts）。畫面預覽用 CSS transform 放大同一份
 * mm/pt 標記的 DOM，列印時 transform 歸零——預覽跟印出來的東西是同一份
 * 標記、不是兩套樣式，不會有「畫面看起來對、印出來不對」的落差。
 *
 * label-data.ts 的三行契約：
 *   賣貨便: top=訂單後5碼 | mid=分盒編號+品項簡稱 | bottom=門市
 *   面交:   top=中壢面交/台中面交/面交 | mid=分盒編號+品項簡稱 | bottom=IG
 *   KOL:    top=KOL | mid=@IG | bottom=分盒編號+品項簡稱
 *   宅配/待分類：走面交同版式
 */
import type { LabelData } from "../../output/label-data";
import { type LabelLayout, mmToPx, truncateForLabel } from "../../domain/label-layout";

/**
 * 印表機 CSS 開關（body.printing-labels / .printing-nutrition）跟
 * window.print() 在同一個 event loop tick 裡連續呼叫時，瀏覽器不保證
 * 「display:none → block」那次 DOM 切換已經真的 reflow/paint 完——
 * 結果印出來/存 PDF 是空白頁（2026-08-09 老闆回報的成分表列印空白）。
 * 修法：切完 class 後至少等兩次 requestAnimationFrame（等瀏覽器真的
 * 畫完那一輪），才觸發 window.print()。
 */
export function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

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
  // 標籤紙：純白 + 純黑字（203dpi 單色熱感應——彩色對比反而更差，見 label-layout.ts）
  paper: "#FFFFFF",
  paperInk: "#000000",
  dash: "#B8B8B8",
} as const;

/** 螢幕預覽放大倍率（只影響畫面、不影響列印——列印永遠是 layout 的真實 mm） */
const PREVIEW_ZOOM = 4;

// ── 單張標籤（真實 mm/pt、一標一頁） ─────────────────────────
export function LabelCard({ label, layout }: { label: LabelData; layout: LabelLayout }) {
  const isSellerBuy = label.kind === "賣貨便";
  const isKOL = label.kind === "KOL";
  const { fontPt, maxChars, safetyMarginMm } = layout;

  const topText = truncateForLabel(label.top_line, maxChars.top);
  const midText = truncateForLabel(label.mid_line, maxChars.mid);
  const bottomText = truncateForLabel(label.bottom_line, maxChars.bottom);

  const lineClamp: React.CSSProperties = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100%",
  };

  return (
    <div
      className="label-card"
      style={{
        width: `${layout.pageWidthMm}mm`,
        height: `${layout.pageHeightMm}mm`,
        background: C.paper,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `${safetyMarginMm}mm`,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {/* 上區塊：top + mid */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          gap: "0.15em",
          width: "100%",
          minHeight: 0,
        }}
      >
        <div
          style={{
            fontFamily: isSellerBuy || isKOL ? F.anton : F.tc,
            fontWeight: 900,
            fontSize: `${fontPt.top}pt`,
            color: C.paperInk,
            lineHeight: 1.05,
            letterSpacing: "0.02em",
            ...lineClamp,
          }}
        >
          {topText}
        </div>

        <div
          style={{
            fontFamily: F.tc,
            fontWeight: 700,
            fontSize: `${fontPt.mid}pt`,
            color: C.paperInk,
            lineHeight: 1.15,
            textAlign: "center",
            ...lineClamp,
          }}
        >
          {midText}
        </div>
      </div>

      {/* 下區塊：bottom */}
      <div
        style={{
          fontFamily: F.tc,
          fontWeight: 600,
          fontSize: `${fontPt.bottom}pt`,
          color: C.paperInk,
          textAlign: "center",
          width: "100%",
          ...lineClamp,
        }}
      >
        {bottomText}
      </div>

      {/* 資料不一致警告——純黑（熱感應對顏色沒語意）、靠 ⚠ 符號辨識而非顏色 */}
      {label.warning && (
        <div
          style={{
            position: "absolute",
            bottom: "1mm",
            right: "1mm",
            fontFamily: F.mono,
            fontWeight: 600,
            fontSize: `${fontPt.warning}pt`,
            color: C.paperInk,
          }}
        >
          ⚠
        </div>
      )}
    </div>
  );
}

// ── 一頁 = 一張標籤（螢幕預覽用 transform 放大，列印時歸零） ──
export function LabelPage({ label, layout }: { label: LabelData; layout: LabelLayout }) {
  const wPx = mmToPx(layout.pageWidthMm);
  const hPx = mmToPx(layout.pageHeightMm);
  return (
    <div
      className="label-page"
      style={{
        width: wPx * PREVIEW_ZOOM,
        height: hPx * PREVIEW_ZOOM,
        maxWidth: "100%",
        boxShadow: "0 30px 70px rgba(0,0,0,.5)",
        overflow: "hidden",
      }}
    >
      <div
        className="label-page-zoom"
        style={{
          width: `${layout.pageWidthMm}mm`,
          height: `${layout.pageHeightMm}mm`,
          transform: `scale(${PREVIEW_ZOOM})`,
          transformOrigin: "top left",
          position: "relative",
        }}
      >
        <LabelCard label={label} layout={layout} />
      </div>
    </div>
  );
}
