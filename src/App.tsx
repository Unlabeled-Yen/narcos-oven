import { useCallback, useMemo, useState } from "react";
import menuYamlText from "../data/menu.yaml?raw";
import { loadMenu } from "./domain/menu";
import { parseSellerBuy } from "./parsers/seller-buy";
import { parseInPerson } from "./parsers/in-person";
import { parseKol } from "./parsers/kol";
import { detectFileKind, type FileKind } from "./parsers/detect";
import type { Order } from "./domain/models";
import { OrdersTable } from "./ui/OrdersTable";
import { PendingBucket } from "./ui/PendingBucket";
import { ConservationBanner } from "./ui/ConservationBanner";

const menu = loadMenu(menuYamlText);

type FileResult = {
  fileName: string;
  kind: FileKind;
  rawCount: number;
  orders: Order[];
  error?: string;
};

export default function App() {
  const [results, setResults] = useState<FileResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback(async (files: FileList) => {
    setError(null);
    const out: FileResult[] = [];
    for (const file of Array.from(files)) {
      try {
        const buf = await file.arrayBuffer();
        const kind = detectFileKind(buf);
        if (kind === "unknown") {
          out.push({
            fileName: file.name,
            kind,
            rawCount: 0,
            orders: [],
            error: "無法辨識檔案類型（非賣貨便/面交/KOL）",
          });
          continue;
        }
        let r;
        if (kind === "seller-buy") r = parseSellerBuy(buf, file.name, menu);
        else if (kind === "in-person") r = parseInPerson(buf, file.name, menu);
        else r = parseKol(buf, file.name, menu);
        out.push({
          fileName: file.name,
          kind,
          rawCount: r.raw_row_count,
          orders: r.orders,
        });
      } catch (e) {
        out.push({
          fileName: file.name,
          kind: "unknown",
          rawCount: 0,
          orders: [],
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    setResults(out);
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

  const allOrders = useMemo(
    () => results.flatMap((r) => r.orders),
    [results]
  );
  const rawSum = useMemo(
    () => results.reduce((s, r) => s + r.rawCount, 0),
    [results]
  );

  return (
    <div className="min-h-screen p-6 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">🔥 narcos-oven</h1>
        <p className="text-sm text-gray-600">
          NARCOS.sugar 出爐指揮台 · M2 三通路整合
        </p>
      </header>

      {/* 拖檔區 */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="mb-6 border-2 border-dashed border-gray-300 rounded-lg p-8 text-center bg-white hover:bg-gray-50 transition"
      >
        <p className="text-gray-700 mb-2">
          拖賣貨便 + 面交 + KOL 全部 xlsx 進來、或
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
          M2 自動辨識三種資料源、統一 pipeline 走 Stage 1-5
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded p-4 text-sm text-red-900">
          <strong>解析錯誤：</strong> {error}
        </div>
      )}

      {results.length > 0 && (
        <FileResultsList results={results} />
      )}

      {allOrders.length > 0 && (
        <MergedOverview
          rawSum={rawSum}
          allOrders={allOrders}
        />
      )}
    </div>
  );
}

function FileResultsList({ results }: { results: FileResult[] }) {
  return (
    <section className="mb-6">
      <h2 className="text-xl font-bold mb-2">📁 已解析檔案</h2>
      <div className="space-y-2">
        {results.map((r, i) => (
          <div
            key={i}
            className="bg-white border rounded p-3 flex items-center justify-between text-sm"
          >
            <div>
              <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded mr-2">
                {r.kind}
              </span>
              <span className="font-medium">{r.fileName}</span>
              {r.error && (
                <span className="ml-2 text-red-700">❌ {r.error}</span>
              )}
            </div>
            {!r.error && (
              <div className="text-xs text-gray-600">
                原始 {r.rawCount} 筆 → 解析 {r.orders.length} 筆訂單
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function MergedOverview({
  rawSum,
  allOrders,
}: {
  rawSum: number;
  allOrders: Order[];
}) {
  const stats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byChannel: Record<string, number> = {};
    const byBatchDate: Record<string, number> = {};
    let totalLabels = 0;
    let totalRevenue = 0;
    for (const o of allOrders) {
      byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      byChannel[o.channel] = (byChannel[o.channel] ?? 0) + 1;
      if (o.status === "confirmed" && o.batchDate) {
        byBatchDate[o.batchDate] = (byBatchDate[o.batchDate] ?? 0) + 1;
        totalLabels += o.labelCount;
        totalRevenue += o.revenue.grossTotal;
      }
    }
    return { byStatus, byChannel, byBatchDate, totalLabels, totalRevenue };
  }, [allOrders]);

  return (
    <>
      <ConservationBanner rawRowCount={rawSum} orders={allOrders} />

      <section className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="原始總筆數" value={rawSum} />
        <StatCard
          label="confirmed"
          value={stats.byStatus["confirmed"] ?? 0}
          color="green"
        />
        <StatCard
          label="待處理"
          value={allOrders.length - (stats.byStatus["confirmed"] ?? 0)}
          color="orange"
        />
        <StatCard label="標籤總數" value={stats.totalLabels} color="blue" />
      </section>

      <section className="mb-4">
        <h2 className="text-xl font-bold mb-2">📅 各出爐日 confirmed 訂單</h2>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          {Object.entries(stats.byBatchDate)
            .sort()
            .map(([date, n]) => (
              <div key={date} className="bg-blue-50 rounded p-3">
                <div className="text-xs text-gray-600">{date}</div>
                <div className="text-xl font-bold">{n}</div>
              </div>
            ))}
        </div>
      </section>

      <section className="mb-4">
        <h2 className="text-xl font-bold mb-2">🏷️ 通路分佈</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Object.entries(stats.byChannel).map(([ch, n]) => (
            <div key={ch} className="bg-gray-100 rounded p-3">
              <div className="text-xs text-gray-600">{ch}</div>
              <div className="text-xl font-bold">{n}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-bold mb-2">
          ✅ Confirmed（{stats.byStatus["confirmed"] ?? 0} 筆）
        </h2>
        <OrdersTable
          orders={allOrders.filter((o) => o.status === "confirmed")}
          menu={menu}
        />
      </section>

      <section>
        <h2 className="text-xl font-bold mb-2">
          🟡 待處理桶（
          {allOrders.length - (stats.byStatus["confirmed"] ?? 0)} 筆）
        </h2>
        <PendingBucket
          orders={allOrders.filter((o) => o.status !== "confirmed")}
        />
      </section>
    </>
  );
}

function StatCard({
  label,
  value,
  color = "gray",
}: {
  label: string;
  value: number;
  color?: "gray" | "green" | "orange" | "blue";
}) {
  const c = {
    gray: "bg-gray-100 text-gray-900",
    green: "bg-green-100 text-green-900",
    orange: "bg-orange-100 text-orange-900",
    blue: "bg-blue-100 text-blue-900",
  }[color];
  return (
    <div className={`rounded-lg p-4 ${c}`}>
      <div className="text-xs uppercase font-semibold opacity-75">{label}</div>
      <div className="text-3xl font-bold">{value}</div>
    </div>
  );
}
