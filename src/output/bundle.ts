/**
 * Bundle 打包所有 Excel 為單一 ZIP
 */
import JSZip from "jszip";
import type { Menu, Order } from "../domain/models";
import { writeStatsExcel } from "./stats-excel";
import { writeOverviewExcel } from "./overview-excel";
import { writePayoutExcel } from "./payout-excel";

export async function buildBundleZip(
  orders: Order[],
  menu: Menu
): Promise<Blob> {
  const zip = new JSZip();
  const today = new Date().toISOString().slice(0, 10);
  const folder = zip.folder(`narcos-oven-${today}`);
  if (!folder) throw new Error("zip folder 建立失敗");

  folder.file("出爐統計.xlsx", writeStatsExcel(orders, menu));
  folder.file("出貨總覽.xlsx", writeOverviewExcel(orders, menu));
  folder.file("分潤統計.xlsx", writePayoutExcel(orders, menu));

  return zip.generateAsync({ type: "blob" });
}
