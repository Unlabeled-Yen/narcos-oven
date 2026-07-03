/**
 * 檔案下載通用 helper（browser 端）。
 *
 * 憲章 #2 靜默失效零容忍：下載失敗要 loud 告知（try/catch 由 caller 處理）。
 */

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const ZIP_MIME = "application/zip";

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 給瀏覽器時間吃掉 URL
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

/** 下載 xlsx（Uint8Array from output/*-excel.ts writeXxxExcel）。 */
export function downloadXlsx(bytes: Uint8Array, filename: string): void {
  // 直接 new Blob([bytes]) 型別在某些瀏覽器版本嚴格模式會抱怨、包一層 view
  const blob = new Blob([new Uint8Array(bytes)], { type: XLSX_MIME });
  triggerDownload(blob, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

/** 下載 zip（Uint8Array from output/bundle.ts buildBundleZip）。 */
export function downloadZip(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: ZIP_MIME });
  triggerDownload(blob, filename.endsWith(".zip") ? filename : `${filename}.zip`);
}

/** 產出檔名的日期戳（本機時區 YYYYMMDD_HHmm）。 */
export function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}${mo}${day}_${h}${mi}`;
}
