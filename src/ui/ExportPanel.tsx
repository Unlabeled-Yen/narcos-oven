/**
 * Excel/Bundle 產出面板 + 憲章 #6 + #9 release gate
 */
import { useState } from "react";
import type { Menu, Order } from "../domain/models";
import { checkReleaseGate } from "../domain/release-gate";
import { writeStatsExcel } from "../output/stats-excel";
import { writeOverviewExcel } from "../output/overview-excel";
import { writePayoutExcel } from "../output/payout-excel";
import { buildBundleZip } from "../output/bundle";
import { downloadBlob, ordersForOutput } from "../output/utils";

export function ExportPanel({
  orders,
  menu,
}: {
  orders: Order[];
  menu: Menu;
}) {
  const gate = checkReleaseGate(orders);
  const eligibleOrders = ordersForOutput(orders);
  const [busy, setBusy] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  async function handleStats() {
    setBusy("stats");
    const buf = writeStatsExcel(orders, menu);
    downloadBlob(buf, `出爐統計_${today}.xlsx`);
    setBusy(null);
  }
  async function handleOverview() {
    setBusy("overview");
    const buf = writeOverviewExcel(orders, menu);
    downloadBlob(buf, `出貨總覽_${today}.xlsx`);
    setBusy(null);
  }
  async function handlePayout() {
    setBusy("payout");
    const buf = writePayoutExcel(orders, menu);
    downloadBlob(buf, `分潤統計_${today}.xlsx`);
    setBusy(null);
  }
  async function handleBundle() {
    setBusy("bundle");
    const zip = await buildBundleZip(orders, menu);
    downloadBlob(zip, `narcos-oven-${today}.zip`, "application/zip");
    setBusy(null);
  }

  return (
    <section className="mb-6">
      <h2 className="text-xl font-bold mb-2">📊 產出 Excel</h2>

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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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
          disabled={!gate.can_release}
          busy={busy === "bundle"}
          onClick={handleBundle}
          label="打包全部 (zip)"
          hint="3 個 Excel 一次下載"
          primary
        />
      </div>

      <div className="mt-2 text-xs text-gray-500">
        本次可入 Excel 的訂單：{eligibleOrders.length} 筆（confirmed + 有 batchDate）
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
