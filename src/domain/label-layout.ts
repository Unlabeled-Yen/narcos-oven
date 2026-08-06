/**
 * #1 標籤列印版面（純函式、可 Node 測）
 *
 * 老闆的標籤機是 Xprinter XP-P3301B：203dpi 熱感應、單色、最大列印寬度
 * 72mm。標籤紙實際尺寸 4cm×3cm，一標一頁（不是「一頁排幾張」）。
 *
 * 203dpi 單色熱感應在 40×30mm 只有約 320×240 點——字要大要粗才印得清楚：
 *   - 字級一律 ≥ 8pt（用 pt 而非 px，pt 是實體尺寸單位、跟螢幕 DPI 無關，
 *     瀏覽器印出時會照 @page size 精確對應到紙張，不會被縮放）
 *   - 字重一律 ≥ 600（細字在熱感應紙上容易糊）
 *   - 純黑（#000）不用灰階/淺色——單色熱感應對顏色沒有語意，彩色文字
 *     印出來反而對比度更差
 *   - 內容區留安全邊，避免熱感應頭邊緣裁切
 *
 * 60×90mm / 75×120mm 兩個舊 preset 保留，但這次是真的用 mm 驅動版面
 * （@page size 同步），不再只是文案。
 */

export type LabelPresetKey = "4x3cm" | "60x90mm" | "75x120mm";

export type LabelLayout = {
  key: LabelPresetKey;
  displayLabel: string;
  pageWidthMm: number;
  pageHeightMm: number;
  /** 一標一頁設計，恆為 1；保留欄位供測試斷言，不是可調參數 */
  labelsPerPage: 1;
  safetyMarginMm: number;
  /** XP-P3301B 約束：字級 pt 值一律 ≥ minFontPt */
  minFontPt: number;
  /** XP-P3301B 約束：字重一律 ≥ minFontWeight */
  minFontWeight: number;
  fontPt: { top: number; mid: number; bottom: number; warning: number };
  /** 各行截斷上限字元數（含 subNumber 前綴），超過補「…」防溢出容器 */
  maxChars: { top: number; mid: number; bottom: number };
  /** 注入 <style>@page{...}</style> 的內容 */
  pageCss: string;
};

export const LABEL_PRESETS: Record<LabelPresetKey, LabelLayout> = {
  "4x3cm": {
    key: "4x3cm",
    displayLabel: "4×3cm（Xprinter XP-P3301B）",
    pageWidthMm: 40,
    pageHeightMm: 30,
    labelsPerPage: 1,
    safetyMarginMm: 1.5,
    minFontPt: 8,
    minFontWeight: 600,
    fontPt: { top: 13, mid: 9, bottom: 8, warning: 8 },
    maxChars: { top: 10, mid: 24, bottom: 16 },
    pageCss: "size: 40mm 30mm; margin: 0;",
  },
  "60x90mm": {
    key: "60x90mm",
    displayLabel: "60×90mm",
    pageWidthMm: 60,
    pageHeightMm: 90,
    labelsPerPage: 1,
    safetyMarginMm: 2,
    minFontPt: 8,
    minFontWeight: 600,
    fontPt: { top: 22, mid: 14, bottom: 11, warning: 8 },
    maxChars: { top: 12, mid: 32, bottom: 24 },
    pageCss: "size: 60mm 90mm; margin: 0;",
  },
  "75x120mm": {
    key: "75x120mm",
    displayLabel: "75×120mm",
    pageWidthMm: 75,
    pageHeightMm: 120,
    labelsPerPage: 1,
    safetyMarginMm: 2,
    minFontPt: 8,
    minFontWeight: 600,
    fontPt: { top: 28, mid: 16, bottom: 12, warning: 8 },
    maxChars: { top: 14, mid: 36, bottom: 28 },
    pageCss: "size: 75mm 120mm; margin: 0;",
  },
};

export const LABEL_PRESET_ORDER: LabelPresetKey[] = ["4x3cm", "60x90mm", "75x120mm"];

export function labelLayout(preset: LabelPresetKey): LabelLayout {
  const layout = LABEL_PRESETS[preset];
  if (!layout) throw new Error(`未知標籤尺寸 preset：${preset}`);
  return layout;
}

/** 一標一頁：頁數 = 標籤數 / 每頁張數（恆為 1，但保留公式以便未來若真的要多標一頁時不必改呼叫端） */
export function pagesFor(labelCount: number, layout: LabelLayout): number {
  return Math.ceil(labelCount / layout.labelsPerPage);
}

/** 96dpi 螢幕換算（僅供畫面預覽用；實際列印靠 @page size，不吃這個常數） */
const PX_PER_MM = 3.7795275591;
export function mmToPx(mm: number): number {
  return Math.round(mm * PX_PER_MM * 100) / 100;
}

/**
 * 截斷過長內容、補「…」防止溢出容器。maxChars 是保守估計的安全上限
 * （含分盒編號前綴），正常內容（見 data/menu.yaml label_short_forms）
 * 不會觸發；只有異常長字串（例如 fallback 到 rawName 前 20 字 + 分盒
 * 編號後仍超長）才會被截斷。
 */
export function truncateForLabel(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return "…";
  return text.slice(0, maxChars - 1) + "…";
}
