/**
 * Excel/Bundle 產出面板 + 憲章 #6 + #9 release gate
 */
import { useMemo, useState } from "react";
import type { Menu, Order } from "../domain/models";
import { checkReleaseGate } from "../domain/release-gate";
import { writeStatsExcel } from "../output/stats-excel";
import { writeOverviewExcel } from "../output/overview-excel";
import { writePayoutExcel } from "../output/payout-excel";
import { writePeriodSummaryExcel } from "../output/period-summary-excel";
import { buildBundleZip } from "../output/bundle";
import { downloadBlob, ordersForOutput } from "../output/utils";
import { extractLabels } from "../output/label-data";
import { renderLabelsToPDF } from "../output/label-renderer";
import { filterByPeriod, periodLabel, type Period } from "../domain/period";
import { PeriodPicker } from "./PeriodPicker";

export function ExportPanel({
  orders,
  menu,
}: {
  orders: Order[];
  menu: Menu;
}) {
  const gate = checkReleaseGate(orders);
  const [period, setPeriod] = useState<Period>({ type: "all" });
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = useMemo(() => filterByPeriod(orders, period), [orders, period]);
  const eligibleOrders = ordersForOutput(filtered);
  const label = periodLabel(period);
  const today = new Date().toISOString().slice(0, 10);
  const suffix = period.type === "all" ? today : label;

  async function handleStats() {
    setBusy("stats");
    const buf = writeStatsExcel(filtered, menu);
    downloadBlob(buf, `出爐統計_${suffix}.xlsx`);
    setBusy(null);
  }
  async function handleOverview() {
    setBusy("overview");
    const buf = writeOverviewExcel(filtered, menu);
    downloadBlob(buf, `出貨總覽_${suffix}.xlsx`);
    setBusy(null);
  }
  async function handlePayout() {
    setBusy("payout");
    const buf = writePayoutExcel(filtered, menu);
    downloadBlob(buf, `分潤統計_${suffix}.xlsx`);
    setBusy(null);
  }
  async function handlePeriodSummary() {
    setBusy("period");
    const buf = writePeriodSummaryExcel(filtered, menu, period);
    downloadBlob(buf, `期間摘要_${suffix}.xlsx`);
    setBusy(null);
  }
  async function handleLabels() {
    setBusy("labels");
    const labels = extractLabels(filtered, menu);
    const pdf = renderLabelsToPDF(labels);
    downloadBlob(new Uint8Array(pdf), `標籤_${suffix}.pdf`, "application/pdf");
    setBusy(null);
  }
  async function handleBundle() {
    setBusy("bundle");
    const zip = await buildBundleZip(filtered, menu);
    downloadBlob(zip, `narcos-oven-${suffix}.zip`, "application/zip");
    setBusy(null);
  }

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="text-xl font-bold">📊 產出 Excel</h2>
        <PeriodPicker orders={orders} period={period} onChange={setPeriod} />
      </div>

      {!gate.can_release && (
        <div className="mb-3 bg-red-100 border-2 border-red-500 rounded p-3 text-sm text-red-900">
          🚨 <strong>釋出鎖定中</strong>
          <ul className="ml-4 mt-1 list-disc">
            {gate.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {gate.can_release && eligibleOrders.length === 0 && (
        <div className="mb-3 bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-900">
          ⚠️ 目前沒有已排出爐日的 confirmed 訂單、產出的 Excel 會是空的。
          （v1 只認 batchDate 有值的、M6 排程系統上線後改用 assigned_batch_date）
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <ExportButton
          disabled={!gate.can_release}
          busy={busy === "stats"}
          onClick={handleStats}
          label="出爐統計"
          hint="品項 × 出爐日 × 通路"
        />
        <ExportButton
          disabled={!gate.can_release}
          busy={busy === "overview"}
          onClick={handleOverview}
          label="出貨總覽"
          hint="每批一 sheet 訂單明細"
        />
        <ExportButton
          disabled={!gate.can_release}
          busy={busy === "payout"}
          onClick={handlePayout}
          label="分潤統計"
          hint="總+淨營收並列"
        />
        <ExportButton
          disabled={!gate.can_release || period.type === "all"}
          busy={busy === "period"}
          onClick={handlePeriodSummary}
          label="期間摘要"
          hint={
            period.type === "month"
              ? "每天一列"
              : period.type === "quarter" || period.type === "year"
              ? "每月一列"
              : "選期間才可用"
          }
        />
        <ExportButton
          disabled={!gate.can_release}
          busy={busy === "labels"}
          onClick={handleLabels}
          label="出貨標籤"
          hint="PDF 每頁 3 標籤直排"
        />
        <ExportButton
          disabled={!gate.can_release}
          busy={busy === "bundle"}
          onClick={handleBundle}
          label="打包全部 (zip)"
          hint="Excel + 標籤 PDF"
          primary
        />
      </div>

      <div className="mt-2 text-xs text-gray-500">
        {period.type === "all"
          ? `本次可入 Excel 的訂單：${eligibleOrders.length} 筆（confirmed + 有 batchDate）`
          : `期間 ${label} 內符合條件：${eligibleOrders.length} 筆 / 全域 ${orders.length} 筆`}
      </div>
    </section>
  );
}

function ExportButton({
  label,
  hint,
  onClick,
  disabled,
  busy,
  primary,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={`text-left p-3 rounded border transition ${
        disabled
          ? "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed"
          : primary
          ? "bg-green-600 border-green-700 text-white hover:bg-green-700"
          : "bg-white border-gray-300 hover:bg-gray-50"
      }`}
    >
      <div className="font-semibold text-sm">
        {busy ? "產出中…" : label}
      </div>
      <div className={`text-xs ${primary && !disabled ? "text-green-100" : "text-gray-500"}`}>
        {hint}
      </div>
    </button>
  );
}
