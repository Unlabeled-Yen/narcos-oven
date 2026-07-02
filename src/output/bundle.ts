/**
 * Bundle 打包所有 Excel 為單一 ZIP
 */
import JSZip from "jszip";
import type { Menu, Order } from "../domain/models";
import { writeStatsExcel } from "./stats-excel";
import { writeOverviewExcel } from "./overview-excel";
import { writePayoutExcel } from "./payout-excel";
import { extractLabels } from "./label-data";
import { renderLabelsToPDF } from "./label-renderer";

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

  // 標籤 PDF（依 batchDate 分檔）
  const labels = extractLabels(orders, menu);
  const byDate = new Map<string, typeof labels>();
  for (const l of labels) {
    if (!byDate.has(l.batch_date)) byDate.set(l.batch_date, []);
    byDate.get(l.batch_date)!.push(l);
  }
  for (const [d, ls] of byDate) {
    const pdf = renderLabelsToPDF(ls);
    folder.file(`標籤_${d}.pdf`, pdf);
  }

  return zip.generateAsync({ type: "blob" });
}
