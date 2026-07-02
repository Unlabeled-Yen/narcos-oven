/**
 * M5 標籤 PDF renderer (browser)
 *
 * 用 HTML5 Canvas 繪製中文（native font），每張標籤轉 PNG dataURL
 * 再用 jsPDF.addImage 組合成 PDF。
 *
 * spec (雇主 R2-3): 每頁 590×945 px、內含 3 個標籤直排、虛線分隔。
 */
import { jsPDF } from "jspdf";
import type { LabelData } from "./label-data";

const PAGE_WIDTH_PX = 590;
const PAGE_HEIGHT_PX = 945;
const LABELS_PER_PAGE = 3;
const LABEL_HEIGHT_PX = PAGE_HEIGHT_PX / LABELS_PER_PAGE; // 315

/**
 * 主入口：labels[] → PDF ArrayBuffer
 */
export function renderLabelsToPDF(labels: LabelData[]): ArrayBuffer {
  if (labels.length === 0) {
    // 空 PDF
    const pdf = new jsPDF({ unit: "px", format: [PAGE_WIDTH_PX, PAGE_HEIGHT_PX] });
    pdf.text("（無標籤）", PAGE_WIDTH_PX / 2, PAGE_HEIGHT_PX / 2, { align: "center" });
    return pdf.output("arraybuffer");
  }

  const pdf = new jsPDF({
    unit: "px",
    format: [PAGE_WIDTH_PX, PAGE_HEIGHT_PX],
    hotfixes: ["px_scaling"],
  });

  // 排序：先按 batch_date、再按 kind、再按 order_id、再按 index
  const sorted = [...labels].sort((a, b) => {
    if (a.batch_date !== b.batch_date) return a.batch_date.localeCompare(b.batch_date);
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    if (a.order_id !== b.order_id) return a.order_id.localeCompare(b.order_id);
    return a.index - b.index;
  });

  // 每頁 3 標籤
  for (let i = 0; i < sorted.length; i++) {
    const label = sorted[i]!;
    const posInPage = i % LABELS_PER_PAGE;
    if (posInPage === 0 && i > 0) {
      pdf.addPage([PAGE_WIDTH_PX, PAGE_HEIGHT_PX], "portrait");
    }
    const yTop = posInPage * LABEL_HEIGHT_PX;
    const png = renderLabelToPngDataUrl(label);
    pdf.addImage(png, "PNG", 0, yTop, PAGE_WIDTH_PX, LABEL_HEIGHT_PX);

    // 虛線分隔（第 2/3 個標籤上方）
    if (posInPage > 0) {
      pdf.setLineDashPattern([4, 4], 0);
      pdf.setDrawColor(180);
      pdf.line(20, yTop, PAGE_WIDTH_PX - 20, yTop);
      pdf.setLineDashPattern([], 0);
    }
  }

  return pdf.output("arraybuffer");
}

/**
 * 單張標籤 → Canvas → PNG dataURL
 * Canvas 用 browser 原生中文字型（PingFang / Noto Sans TC）
 */
function renderLabelToPngDataUrl(label: LabelData): string {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH_PX;
  canvas.height = LABEL_HEIGHT_PX;
  const ctx = canvas.getContext("2d")!;

  // 白底
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textAlign = "center";
  ctx.fillStyle = "#000000";

  const cx = canvas.width / 2;

  // 三行 layout（top big, mid medium, bottom light）
  // top: 60-80px 字大、位置 y=90
  // mid: 40-50px 字、y=180
  // bottom: 20-24px 字、灰色、y=270

  ctx.font = "bold 70px 'PingFang TC', 'Noto Sans TC', 'Heiti TC', sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(label.top_line, cx, 80);

  ctx.font = "44px 'PingFang TC', 'Noto Sans TC', 'Heiti TC', sans-serif";
  // mid 可能有 \n 空白
  drawMultiline(ctx, label.mid_line, cx, 180, 52);

  ctx.font = "22px 'PingFang TC', 'Noto Sans TC', 'Heiti TC', sans-serif";
  ctx.fillStyle = "#999999";
  ctx.fillText(label.bottom_line, cx, 285);

  if (label.warning) {
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "#dd0000";
    ctx.fillText(`⚠ ${label.warning}`, cx, LABEL_HEIGHT_PX - 12);
  }

  return canvas.toDataURL("image/png");
}

function drawMultiline(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  lineHeight: number
) {
  const lines = text.split(/\s{2,}|\n/).filter((l) => l.length > 0);
  const totalH = lines.length * lineHeight;
  const startY = cy - totalH / 2 + lineHeight / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, cx, startY + i * lineHeight);
  }
}
