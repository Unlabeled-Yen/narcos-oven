import { useCallback, useEffect, useState } from "react";
import menuYamlText from "../data/menu.yaml?raw";
import { loadMenu } from "./domain/menu";
import { parseSellerBuy } from "./parsers/seller-buy";
import { parseInPerson } from "./parsers/in-person";
import { parseKol } from "./parsers/kol";
import { detectFileKind, type FileKind } from "./parsers/detect";
import { planDiff } from "./domain/diff";
import type { ChannelId, ImportRun, Order } from "./domain/models";
import { getActiveByChannels, getAll, upsertMany, markDisappeared } from "./db/orders";
import { saveImportRun, getLatestUnresolved } from "./db/import-runs";
import { ImportSummaryModal } from "./ui/ImportSummaryModal";
import { AppShell } from "./ui/AppShell";

const menu = loadMenu(menuYamlText);

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

  useEffect(() => {
    void refreshOrders();
    void (async () => {
      const unresolved = await getLatestUnresolved();
      if (unresolved) setPendingRun(unresolved);
    })();
  }, []);

  async function refreshOrders() {
    const list = await getAll();
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
  }, []);

  return (
    <>
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
