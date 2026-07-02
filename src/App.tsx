import { useCallback, useMemo, useState } from "react";
import menuYamlText from "../data/menu.yaml?raw";
import { loadMenu } from "./domain/menu";
import { parseSellerBuy } from "./parsers/seller-buy";
import type { Order, ParseResult, PendingReasonCode } from "./domain/models";
import { OrdersTable } from "./ui/OrdersTable";
import { PendingBucket } from "./ui/PendingBucket";
import { ConservationBanner } from "./ui/ConservationBanner";

const menu = loadMenu(menuYamlText);

export default function App() {
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      try {
        setError(null);
        setFileName(file.name);
        const buf = await file.arrayBuffer();
        const r = parseSellerBuy(buf, file.name, menu);
        setResult(r);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setResult(null);
      }
    },
    []
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  const stats = useMemo(() => summarize(result?.orders ?? []), [result]);

  return (
    <div className="min-h-screen p-6 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">🔥 narcos-oven</h1>
        <p className="text-sm text-gray-600">
          NARCOS.sugar 出爐指揮台 · M1 vertical slice
        </p>
      </header>

      {/* 拖檔區 */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="mb-6 border-2 border-dashed border-gray-300 rounded-lg p-8 text-center bg-white hover:bg-gray-50 transition"
      >
        <p className="text-gray-700 mb-2">
          拖賣貨便 xlsx 進來、或
          <label className="ml-1 underline text-blue-600 cursor-pointer">
            點此挑檔
            <input type="file" accept=".xlsx" hidden onChange={onPick} />
          </label>
        </p>
        <p className="text-xs text-gray-500">
          M1 只認賣貨便格式（非訂單匯入 sheet）。面交/KOL 待 M2 實作。
        </p>
        {fileName && (
          <p className="mt-2 text-sm text-gray-600">目前檔案：{fileName}</p>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded p-4 text-sm text-red-900">
          <strong>解析錯誤：</strong> {error}
        </div>
      )}

      {result && (
        <>
          <ConservationBanner
            rawRowCount={result.raw_row_count}
            orders={result.orders}
          />

          {/* 憲章防護 #1 + 統計 summary */}
          <section className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="原始訂單" value={result.raw_row_count} />
            <StatCard label="confirmed" value={stats.confirmed} color="green" />
            <StatCard label="待處理" value={stats.pending} color="orange" />
            <StatCard label="標籤總數" value={stats.labels} color="blue" />
          </section>

          <section className="mb-6">
            <h2 className="text-xl font-bold mb-2">
              ✅ Confirmed（{stats.confirmed} 筆）
            </h2>
            <OrdersTable
              orders={result.orders.filter((o) => o.status === "confirmed")}
              menu={menu}
            />
          </section>

          <section>
            <h2 className="text-xl font-bold mb-2">
              🟡 待處理桶（{stats.pending} 筆）
            </h2>
            <PendingBucket
              orders={result.orders.filter((o) => o.status !== "confirmed")}
            />
          </section>
        </>
      )}
    </div>
  );
}

// ---- helpers ----

function summarize(orders: Order[]) {
  const confirmed = orders.filter((o) => o.status === "confirmed").length;
  const pending = orders.length - confirmed;
  const labels = orders
    .filter((o) => o.status === "confirmed")
    .reduce((s, o) => s + o.labelCount, 0);
  const byReason: Record<PendingReasonCode, number> = {} as never;
  for (const o of orders) {
    for (const r of o.pendingReasons) {
      byReason[r.code] = (byReason[r.code] ?? 0) + 1;
    }
  }
  return { confirmed, pending, labels, byReason };
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
