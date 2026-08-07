import { useCallback, useEffect, useState } from "react";
import menuYamlText from "../data/menu.yaml?raw";
import { loadMenu } from "./domain/menu";
import { lintMenu, logLintWarnings } from "./domain/menu-lint";
import { parseSellerBuy } from "./parsers/seller-buy";
import { parseInPerson, parseInPersonRows } from "./parsers/in-person";
import { parseKol } from "./parsers/kol";
import { parseSellerBuyHtml } from "./parsers/seller-buy-html";
import { applyHtmlWishDates } from "./domain/apply-html-wish-dates";
import { getSheetRows, extractSheetId } from "./google/sheets";
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
  "seller-buy-html": [], // #12：html 只補寫既有訂單欄位，不走新增/消失 diff、不算「觸碰某通路」
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

  /**
   * 共用 import pipeline · Yen 2026-07-06 抽出讓 xlsx 與 Google Sheet 同步共用
   * 拿到 parsed orders + channelsTouched + sources → 跑 sanity / diff / upsert
   */
  const runImport = useCallback(async (
    parsed: { orders: Order[]; fileName: string }[],
    channelsTouched: Set<ChannelId>,
  ) => {
    if (parsed.length === 0) return;
    const nowIso = new Date().toISOString();
    const runId = `run-${nowIso}`;
    const newAll = parsed.flatMap((p) => p.orders);
    const dbActive = await getActiveByChannels([...channelsTouched]);
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
      setPendingImport({
        report,
        fileNames: parsed.map((p) => p.fileName),
        proceed: doImport,
      });
      return;
    }
    await doImport();
  }, []);

  /**
   * #12：html 不是新訂單匯入，是「補寫既有訂單的 customer_wish_date」——
   * 不走 diff/sanity，直接比對 DB 現有訂單、寫回，結果一律 loud 顯示
   * （找不到對應訂單的編號絕不能靜默吞掉）。
   */
  const applyHtmlFiles = useCallback(async (htmlFiles: { text: string; fileName: string }[]) => {
    const entries = [];
    const parseErrors: string[] = [];
    for (const { text, fileName } of htmlFiles) {
      try {
        const r = parseSellerBuyHtml(text, fileName);
        entries.push(...r.entries);
      } catch (e) {
        parseErrors.push(`"${fileName}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (entries.length === 0) {
      if (parseErrors.length > 0) setError(parseErrors.join("；"));
      return;
    }
    const current = await getAll();
    const result = applyHtmlWishDates(current, entries);
    const toWriteIds = new Set([...result.filledOrderIds, ...result.conflictOrderIds]);
    const toWrite = result.updatedOrders.filter((o) => toWriteIds.has(o.id));
    if (toWrite.length > 0) await upsertMany(toWrite);

    const parts: string[] = [];
    if (parseErrors.length > 0) parts.push(...parseErrors);
    if (result.filledCount > 0) parts.push(`✓ 補上指定出貨日 ${result.filledCount} 筆`);
    if (result.conflictOrderIds.length > 0) {
      parts.push(`⚠ ${result.conflictOrderIds.length} 筆日期衝突已進待處理桶：${result.conflictOrderIds.join("、")}`);
    }
    if (result.unmatchedOrderIds.length > 0) {
      parts.push(`⚠ ${result.unmatchedOrderIds.length} 筆訂單編號在系統中找不到對應訂單：${result.unmatchedOrderIds.join("、")}`);
    }
    setError(parts.length > 0 ? parts.join("；") : null);
    if (result.filledCount > 0 || result.conflictOrderIds.length > 0) {
      setSyncLabel(`HTML ${new Date().toISOString().slice(5, 16).replace("T", " ")}`);
    }
    await refreshOrders();
  }, []);

  const handleFiles = useCallback(async (files: FileList) => {
    setError(null);
    const parsed: { orders: Order[]; fileName: string }[] = [];
    const htmlFiles: { text: string; fileName: string }[] = [];
    const channelsTouched = new Set<ChannelId>();
    for (const file of Array.from(files)) {
      try {
        const buf = await file.arrayBuffer();
        const kind = detectFileKind(buf, file.name);
        if (kind === "unknown") {
          setError(`檔 "${file.name}" 無法辨識`);
          continue;
        }
        if (kind === "seller-buy-html") {
          htmlFiles.push({ text: new TextDecoder("utf-8").decode(buf), fileName: file.name });
          continue;
        }
        for (const ch of CHANNEL_MAP[kind]) channelsTouched.add(ch);
        let r;
        if (kind === "seller-buy") r = parseSellerBuy(buf, file.name, menu);
        else if (kind === "in-person") r = parseInPerson(buf, file.name, menu);
        else r = parseKol(buf, file.name, menu);
        parsed.push({ orders: r.orders, fileName: file.name });
      } catch (e) {
        setError(`檔 "${file.name}" parse error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (htmlFiles.length > 0) await applyHtmlFiles(htmlFiles);
    await runImport(parsed, channelsTouched);
  }, [runImport, applyHtmlFiles]);

  /**
   * Google Sheet 同步（面交 · in-person）
   * 沿用完全一樣的 dedup / diff / sanity 邏輯 → 跟拖 xlsx 語意等價
   */
  const handleSheetSync = useCallback(async (sheetUrlOrId: string): Promise<{ orderCount: number }> => {
    setError(null);
    const sheetId = extractSheetId(sheetUrlOrId);
    if (!sheetId) throw new Error("無法從 URL 抽出 Spreadsheet ID · 請貼完整 sheet 網址");
    const rows = await getSheetRows(sheetId, "表單回覆 1");
    const result = parseInPersonRows(rows, `google-sheet:${sheetId}`, menu);
    const channelsTouched = new Set<ChannelId>(CHANNEL_MAP["in-person"]);
    await runImport(
      [{ orders: result.orders, fileName: `google-sheet:${sheetId}` }],
      channelsTouched,
    );
    return { orderCount: result.orders.length };
  }, [runImport]);

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
        onSheetSync={handleSheetSync}
        error={error}
      />
    </>
  );
}
