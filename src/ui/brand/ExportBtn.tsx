/**
 * 匯出按鈕 · 通用元件（loud 失敗、憲章 #2）
 *
 * 各頁 render：
 *   <ExportBtn label="匯出台帳" onExport={() => writeOverviewExcel(orders, menu)} filename="orders" />
 */
import { useState } from "react";
import { downloadXlsx, todayStamp } from "../../output/download";

export function ExportBtn({
  label,
  filename,
  onExport,
  color = "#F5D400",
}: {
  label: string;
  /** 檔名基底（自動附上時間戳 + .xlsx） */
  filename: string;
  /** 產出 Uint8Array 的函式（同步或 async） */
  onExport: () => Uint8Array | Promise<Uint8Array>;
  /** 按鈕色（default 品牌黃） */
  color?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const bytes = await onExport();
      const name = `${filename}_${todayStamp()}.xlsx`;
      downloadXlsx(bytes, name);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ExportBtn]", e);
      setErr((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        style={{
          fontFamily: "'Noto Sans TC',sans-serif",
          fontWeight: 900,
          fontSize: 12,
          color: "#111",
          background: color,
          border: "none",
          padding: "8px 14px",
          cursor: busy ? "wait" : "pointer",
          letterSpacing: ".05em",
        }}
      >
        {busy ? "產出中…" : `↓ ${label}`}
      </button>
      {err && (
        <span
          style={{
            fontFamily: "'Space Mono',monospace",
            fontSize: 9,
            color: "#E5352B",
            maxWidth: 240,
            wordBreak: "break-word",
          }}
        >
          ⚠ {err}
        </span>
      )}
    </span>
  );
}
