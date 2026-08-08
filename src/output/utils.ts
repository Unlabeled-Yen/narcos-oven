/**
 * Excel 產出共用 utility
 * 用 SheetJS xlsx.writeXLSX 產生二進位 buffer。
 */
import * as XLSX from "xlsx";
import type { Order } from "../domain/models";
import type { DayType } from "../domain/day-type";
import { effectiveShipDate } from "../domain/effective-ship-date";

/**
 * 從 aoa (array of arrays) 產生 worksheet + 自動計算欄寬。
 */
export function aoaToSheet(
  aoa: (string | number | null)[][],
  colWidths?: number[]
): XLSX.WorkSheet {
  const sh = XLSX.utils.aoa_to_sheet(aoa);
  if (colWidths) {
    sh["!cols"] = colWidths.map((w) => ({ wch: w }));
  } else {
    // 自動：每欄取該欄所有 cell 最大長度
    const maxCols = Math.max(...aoa.map((r) => r.length));
    const widths: XLSX.ColInfo[] = [];
    for (let c = 0; c < maxCols; c++) {
      let max = 4;
      for (const row of aoa) {
        const v = row[c];
        if (v != null) {
          const len = String(v).length;
          if (len > max) max = len;
        }
      }
      widths.push({ wch: Math.min(max + 2, 40) });
    }
    sh["!cols"] = widths;
  }
  return sh;
}

/**
 * 建立 workbook 並加入多個 sheet。
 */
export function buildWorkbook(
  sheets: Array<{ name: string; sheet: XLSX.WorkSheet }>
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const { name, sheet } of sheets) {
    // sheet name 有 31 字上限、且不能含 [ ] : \ / ? *
    const cleaned = name.replace(/[\[\]:\\/?*]/g, "").slice(0, 31);
    XLSX.utils.book_append_sheet(wb, sheet, cleaned);
  }
  return wb;
}

/**
 * Workbook → Uint8Array (瀏覽器下載用)。
 */
export function writeWorkbookBuffer(wb: XLSX.WorkBook): Uint8Array {
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

/**
 * 從 orders 集合過濾出「可入 Excel」的訂單（confirmed、含未排出爐日）。
 * M100-A1：改為納入 pending_batch_date 訂單、UI 顯示為「待老闆排」
 */
export function ordersForOutput(orders: Order[]): Order[] {
  return orders.filter(
    (o) =>
      o.status === "confirmed" ||
      o.status === "kol_shipped" ||
      o.status === "pending_batch_date"
  );
}

/**
 * #6 2026-08-06：批次欄位一律用有效出貨日（不是原始 batchDate），
 * 跟儀表板/工單/出貨明細一致——同一張單不會在 Excel 裡歸到跟畫面
 * 不同的月份/批次。dayTypeOf 由呼叫端注入（見 domain/day-type.ts）。
 */
export function pendingBatchLabel(o: Order, dayTypeOf: (iso: string) => DayType): string {
  return effectiveShipDate(o, dayTypeOf) ?? "待老闆排";
}

/**
 * 觸發瀏覽器下載。
 */
export function downloadBlob(
  data: Uint8Array | Blob,
  filename: string,
  mime = "application/octet-stream"
) {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
