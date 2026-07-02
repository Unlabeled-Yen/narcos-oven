/**
 * 檔案類型智慧辨識
 * 依 sheet name + column header 特徵判斷是賣貨便/面交/KOL/未知
 */
import * as XLSX from "xlsx";
import { readSheetTolerant } from "../domain/xlsx-tolerant";

export type FileKind = "seller-buy" | "in-person" | "kol" | "unknown";

export function detectFileKind(buffer: ArrayBuffer): FileKind {
  const wb = XLSX.read(buffer, { type: "array" });
  const names = wb.SheetNames;

  if (names.includes("非訂單匯入") || names.includes("訂單匯入")) {
    return "seller-buy";
  }
  if (names.includes("表單回覆 1") || names.some((n) => n.startsWith("表單回覆"))) {
    return "in-person";
  }
  if (names.includes("未完成") && names.includes("已完成")) {
    return "kol";
  }

  // fallback：讀第一個 sheet 第一列看 header 有沒有特徵
  const firstSheet = wb.Sheets[names[0]!];
  if (firstSheet) {
    const rows = readSheetTolerant(firstSheet);
    const header = String((rows[0] ?? []).join(" ")).slice(0, 500);
    if (header.includes("賣場類型") && header.includes("訂單編號")) {
      return "seller-buy";
    }
    if (header.includes("在哪邊取貨") || header.includes("提醒面交")) {
      return "in-person";
    }
    if (header.includes("折扣碼") && header.includes("IG 帳號")) {
      return "kol";
    }
  }

  return "unknown";
}
