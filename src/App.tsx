import { useCallback, useEffect, useMemo, useState } from "react";
import menuYamlText from "../data/menu.yaml?raw";
import { loadMenu } from "./domain/menu";
import { parseSellerBuy } from "./parsers/seller-buy";
import { parseInPerson } from "./parsers/in-person";
import { parseKol } from "./parsers/kol";
import { detectFileKind, type FileKind } from "./parsers/detect";
import { planDiff } from "./domain/diff";
import type { ChannelId, ImportRun, Order } from "./domain/models";
import { getActiveByChannels, getAll, upsertMany, markDisappeared, clearAll } from "./db/orders";
import { saveImportRun, getLatestUnresolved } from "./db/import-runs";
import { OrdersTable } from "./ui/OrdersTable";
import { PendingBucket } from "./ui/PendingBucket";
import { ConservationBanner } from "./ui/ConservationBanner";
import { ImportSummaryModal } from "./ui/ImportSummaryModal";
import { ExportPanel } from "./ui/ExportPanel";
import { SchedulePanel } from "./ui/SchedulePanel";

const menu = loadMenu(menuYamlText);

const CHANNEL_MAP: Record<FileKind, ChannelId[]> = {
  "seller-buy": ["賣貨便"],
  "in-person": ["面交_中壢", "面交_台中", "面交_其他", "宅配", "待分類"],
  kol: ["KOL"],
  unknown: [],
};

export default function App() {
  const [error, setError] = useState<string | null>(null);
  const [pendingRun, setPendingRun] = useState<ImportRun | null>(null);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [importHistory, setImportHistory] = useState<string[]>([]);

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

    // 1) 解析每個檔
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

    // 2) 依 channel 分組跑 diff
    const newAll = parsed.flatMap((p) => p.orders);
    const dbActive = await getActiveByChannels([...channelsTouched]);

    const plan = planDiff(newAll, dbActive, runId, nowIso);

    // 3) 寫入 upserts + mark disappeared
    await upsertMany(plan.upserts);
    if (plan.markDisappeared.length > 0) {
      await markDisappeared(plan.markDisappeared, nowIso);
    }

    // 4) 建 ImportRun
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

    // 5) 若有 disappeared 或 fields_changed → 彈 modal
    if (run.fully_resolved_at === null) {
      setPendingRun(run);
    } else {
      setImportHistory((h) => [`${nowIso.slice(0, 19)} 匯入完成、無異動`, ...h]);
    }

    await refreshOrders();
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );
  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0)
        void handleFiles(e.target.files);
    },
    [handleFiles]
  );

  const stats = useMemo(() => summarize(allOrders), [allOrders]);

  return (
    <div className="min-h-screen p-6 max-w-7xl mx-auto">
      {pendingRun && (
        <ImportSummaryModal
          run={pendingRun}
          onClose={async () => {
            setPendingRun(null);
            await refreshOrders();
            setImportHistory((h) => [
              `${new Date().toISOString().slice(0, 19)} 匯入完成、雇主已拍板`,
              ...h,
            ]);
          }}
        />
      )}

      <header className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">🔥 narcos-oven</h1>
          <p className="text-sm text-gray-600">
            NARCOS.sugar 出爐指揮台 · M3 連續匯入 + 憲章 #9 #10
          </p>
        </div>
        <button
          onClick={async () => {
            if (confirm("清空所有資料（dev only）？")) {
              await clearAll();
              await refreshOrders();
            }
          }}
          className="text-xs text-red-600 underline"
        >
          清空資料（dev）
        </button>
      </header>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="mb-6 border-2 border-dashed border-gray-300 rounded-lg p-8 text-center bg-white hover:bg-gray-50 transition"
      >
        <p className="text-gray-700 mb-2">
          拖賣貨便 / 面交 / KOL xlsx 進來、或
          <label className="ml-1 underline text-blue-600 cursor-pointer">
            點此挑檔（可多選）
            <input
              type="file"
              accept=".xlsx"
              multiple
              hidden
              onChange={onPick}
            />
          </label>
        </p>
        <p className="text-xs text-gray-500">
          M3 支援連續匯入、自動偵測新單/付款/變動/消失、憲章防護 #9 #10
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded p-3 text-sm text-red-900">
          {error}
        </div>
      )}

      {importHistory.length > 0 && (
        <section className="mb-4">
          <h2 className="text-sm font-bold text-gray-600 mb-1">📜 匯入紀錄</h2>
          <div className="space-y-1 text-xs text-gray-500">
            {importHistory.slice(0, 5).map((h, i) => (
              <div key={i}>{h}</div>
            ))}
          </div>
        </section>
      )}

      {allOrders.length > 0 && (
        <>
          <ConservationBanner rawRowCount={allOrders.length} orders={allOrders} />

          <section className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="全部訂單" value={allOrders.length} />
            <StatCard label="confirmed" value={stats.confirmed} color="green" />
            <StatCard label="待處理" value={stats.pending} color="orange" />
            <StatCard label="消失待拍板" value={stats.disappeared} color="red" />
          </section>

          {stats.disappeared > 0 && (
            <div className="mb-4 bg-red-50 border-2 border-red-500 rounded p-3 text-sm text-red-900">
              🚨 <strong>憲章 #9</strong>：有 {stats.disappeared} 筆消失訂單未拍板、
              Excel/PDF 產出 disabled。點右下的匯入紀錄再叫出 modal。
            </div>
          )}

          <SchedulePanel orders={allOrders} menu={menu} onOrdersChanged={refreshOrders} />

          <ExportPanel orders={allOrders} menu={menu} />

          <section className="mb-6">
            <h2 className="text-xl font-bold mb-2">
              ✅ Confirmed（{stats.confirmed}）
            </h2>
            <OrdersTable
              orders={allOrders.filter((o) => o.status === "confirmed")}
              menu={menu}
            />
          </section>

          <section className="mb-6">
            <h2 className="text-xl font-bold mb-2">
              🟡 待處理桶（{stats.pending}）
            </h2>
            <PendingBucket
              orders={allOrders.filter((o) => isPending(o.status))}
            />
          </section>

          {stats.shipped > 0 && (
            <section className="mb-6">
              <h2 className="text-xl font-bold mb-2">
                📦 已出貨歷史（{stats.shipped}）
              </h2>
              <details className="text-sm text-gray-600">
                <summary className="cursor-pointer">展開</summary>
                <OrdersTable
                  orders={allOrders.filter((o) => o.status === "shipped")}
                  menu={menu}
                />
              </details>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function isPending(status: Order["status"]): boolean {
  return status.startsWith("pending_");
}

function summarize(orders: Order[]) {
  let confirmed = 0, pending = 0, disappeared = 0, shipped = 0;
  for (const o of orders) {
    if (o.status === "confirmed") confirmed++;
    else if (o.status === "shipped" || o.status === "kol_shipped") shipped++;
    else if (o.status === "disappeared_pending_resolution") disappeared++;
    else if (isPending(o.status) || o.status === "change_pending_resolution") pending++;
  }
  return { confirmed, pending, disappeared, shipped };
}

function StatCard({
  label,
  value,
  color = "gray",
}: {
  label: string;
  value: number;
  color?: "gray" | "green" | "orange" | "blue" | "red";
}) {
  const c = {
    gray: "bg-gray-100 text-gray-900",
    green: "bg-green-100 text-green-900",
    orange: "bg-orange-100 text-orange-900",
    blue: "bg-blue-100 text-blue-900",
    red: "bg-red-100 text-red-900",
  }[color];
  return (
    <div className={`rounded-lg p-4 ${c}`}>
      <div className="text-xs uppercase font-semibold opacity-75">{label}</div>
      <div className="text-3xl font-bold">{value}</div>
    </div>
  );
}
