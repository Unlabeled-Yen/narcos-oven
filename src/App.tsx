import { useCallback, useEffect, useState } from "react";
import menuYamlText from "../data/menu.yaml?raw";
import { loadMenu } from "./domain/menu";
import { lintMenu, logLintWarnings } from "./domain/menu-lint";
import { parseSellerBuy } from "./parsers/seller-buy";
import { parseInPerson } from "./parsers/in-person";
import { parseKol } from "./parsers/kol";
import { detectFileKind, type FileKind } from "./parsers/detect";
import { planDiff } from "./domain/diff";
import type { ChannelId, ImportRun, Order } from "./domain/models";
import { getActiveByChannels, getAll, upsertMany, markDisappeared } from "./db/orders";
import { sanitizeDirtyDates } from "./db/sanitize";
import { saveImportRun, getLatestUnresolved } from "./db/import-runs";
import { checkImportSanity, type SanityReport } from "./domain/import-sanity";
import { ImportSummaryModal } from "./ui/ImportSummaryModal";
import { ImportSanityModal } from "./ui/ImportSanityModal";
import { AppShell } from "./ui/AppShell";

const menu = loadMenu(menuYamlText);
// Yen 2026-07-04 · 啟動時 lint menu.yaml · 提前抓 alias / signature 衝突
// 靜默 SKU 誤匹配根治 Layer B（Layer A 是 lookupSkuStrict）
logLintWarnings(lintMenu(menu));

const CHANNEL_MAP: Record<FileKind, ChannelId[]> = {
  "seller-buy": ["賣貨便"],
  "in-person": ["面交_中壢", "面交_台中", "面交_其他", "宅配", "待分類"],
  kol: ["KOL"],
  unknown: [],
};

function isPending(status: Order["status"]): boolean {
  return status.startsWith("pending_");
}

function pendingCountOf(orders: Order[]): number {
  return orders.filter(
    (o) => isPending(o.status) || o.status === "change_pending_resolution"
  ).length;
}

export default function App() {
  const [error, setError] = useState<string | null>(null);
  const [pendingRun, setPendingRun] = useState<ImportRun | null>(null);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [syncLabel, setSyncLabel] = useState<string>("尚未匯入");
  // Yen 2026-07-04：sanity check 若偵測「舊備份」訊號 · 匯入前彈確認
  const [pendingImport, setPendingImport] = useState<null | {
    report: SanityReport;
    fileNames: string[];
    proceed: () => Promise<void>;
  }>(null);

  useEffect(() => {
    void refreshOrders();
    void (async () => {
      const unresolved = await getLatestUnresolved();
      if (unresolved) setPendingRun(unresolved);
    })();
  }, []);

  async function refreshOrders() {
    let list = await getAll();
    // 自動清理歷史政策留下的髒日期（非 ISO YYYY-MM-DD）· 靜默失效零容忍
    // idempotent：乾淨的 orders 不會被動、有髒的清完會 console.warn
    const result = await sanitizeDirtyDates(list);
    if (result.fixed > 0) {
      // 有清、重讀最新
      list = await getAll();
    }
    setAllOrders(list);
  }

  const handleFiles = useCallback(async (files: FileList) => {
    setError(null);
    const nowIso = new Date().toISOString();
    const runId = `run-${nowIso}`;

    const parsed: { kind: FileKind; orders: Order[]; fileName: string }[] = [];
    const channelsTouched = new Set<ChannelId>();
    for (const file of Array.from(files)) {
      try {
        const buf = await file.arrayBuffer();
        const kind = detectFileKind(buf);
        if (kind === "unknown") {
          setError(`檔 "${file.name}" 無法辨識`);
          continue;
        }
        for (const ch of CHANNEL_MAP[kind]) channelsTouched.add(ch);
        let r;
        if (kind === "seller-buy") r = parseSellerBuy(buf, file.name, menu);
        else if (kind === "in-person") r = parseInPerson(buf, file.name, menu);
        else r = parseKol(buf, file.name, menu);
        parsed.push({ kind, orders: r.orders, fileName: file.name });
      } catch (e) {
        setError(`檔 "${file.name}" parse error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (parsed.length === 0) return;

    const newAll = parsed.flatMap((p) => p.orders);
    const dbActive = await getActiveByChannels([...channelsTouched]);

    // Sanity check：付款回退 / 下單日回退 / 消失比例過高 → 匯入前彈警告
    const report = checkImportSanity(newAll, dbActive);

    const doImport = async () => {
      const plan = planDiff(newAll, dbActive, runId, nowIso);
      await upsertMany(plan.upserts);
      if (plan.markDisappeared.length > 0) {
        await markDisappeared(plan.markDisappeared, nowIso);
      }
      const run: ImportRun = {
        id: runId,
        imported_at: nowIso,
        source_files: parsed.map((p) => p.fileName),
        channels_touched: [...channelsTouched],
        diff: plan.diff,
        resolutions: {},
        fully_resolved_at:
          plan.diff.disappeared.length + plan.diff.fields_changed.length === 0
            ? nowIso
            : null,
      };
      await saveImportRun(run);
      setSyncLabel(`SYNC ${nowIso.slice(5, 16).replace("T", " ")}`);
      if (run.fully_resolved_at === null) {
        setPendingRun(run);
      }
      await refreshOrders();
    };

    if (report.severity !== "ok") {
      // 卡在 sanity modal 讓雇主拍板繼續 or 取消
      setPendingImport({
        report,
        fileNames: parsed.map((p) => p.fileName),
        proceed: doImport,
      });
      return;
    }

    await doImport();
  }, []);

  return (
    <>
      {pendingImport && (
        <ImportSanityModal
          report={pendingImport.report}
          fileNames={pendingImport.fileNames}
          onProceed={async () => {
            const p = pendingImport;
            setPendingImport(null);
            await p.proceed();
          }}
          onCancel={() => setPendingImport(null)}
        />
      )}
      {pendingRun && (
        <ImportSummaryModal
          run={pendingRun}
          onClose={async () => {
            setPendingRun(null);
            await refreshOrders();
          }}
        />
      )}
      <AppShell
        orders={allOrders}
        menu={menu}
        refreshOrders={refreshOrders}
        pendingCount={pendingCountOf(allOrders)}
        syncLabel={syncLabel}
        onFiles={handleFiles}
        error={error}
      />
    </>
  );
}
