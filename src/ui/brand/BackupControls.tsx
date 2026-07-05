/**
 * BackupControls — 全庫備份 / 還原 button pair
 * Yen 2026-07-05：交付雇主前必要功能
 *   · 匯出：一鍵 dump IndexedDB → .json 檔（雇主每週丟 Google Drive）
 *   · 還原：選 .json 覆蓋（換電腦 / 清 cache 後救援）
 */
import { useRef, useState } from "react";
import { downloadBackup, exportBackup, importBackup } from "../../db/backup";

const F = { tc: "'Noto Sans TC',sans-serif", mono: "'Space Mono',monospace" };

export function BackupControls({ refreshOrders }: { refreshOrders: () => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onExport() {
    if (busy) return;
    setBusy("export");
    setMsg(null);
    try {
      const blob = await exportBackup();
      downloadBackup(blob);
      setMsg({ ok: true, text: "✓ 已下載備份檔" });
    } catch (err) {
      setMsg({ ok: false, text: `❌ 匯出失敗：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(null);
    }
  }

  async function onImport(file: File) {
    // Yen 2026-07-05 憲章 #1：不做 silent overwrite · 明確 confirm
    const confirmed = window.confirm(
      `⚠ 還原備份將清空當前資料庫並用 ${file.name} 覆蓋 · 無法復原 · 確定嗎？`,
    );
    if (!confirmed) return;
    setBusy("import");
    setMsg(null);
    const result = await importBackup(file);
    if (result.ok) {
      await refreshOrders();
      setMsg({
        ok: true,
        text: `✓ 已還原 · orders ${result.counts.orders} / runs ${result.counts.import_runs} / changes ${result.counts.order_changes}`,
      });
    } else {
      setMsg({ ok: false, text: `❌ ${result.error}` });
    }
    setBusy(null);
  }

  return (
    <div className="flex items-center" style={{ gap: 6, position: "relative" }}>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onImport(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => void onExport()}
        disabled={busy !== null}
        title="下載當前資料庫備份（.json）· 建議每週丟 Google Drive"
        style={{
          fontFamily: F.tc, fontWeight: 900, fontSize: 12,
          color: "#111", background: "#43B23C", border: "none",
          padding: "8px 14px", cursor: busy ? "wait" : "pointer",
          opacity: busy === "export" ? 0.6 : 1,
        }}
      >
        {busy === "export" ? "匯出中…" : "💾 備份全部"}
      </button>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy !== null}
        title="從 .json 備份還原（會覆蓋當前資料）"
        style={{
          fontFamily: F.tc, fontWeight: 900, fontSize: 12,
          color: "#E5622A", background: "transparent",
          border: "1px solid #E5622A",
          padding: "7px 12px", cursor: busy ? "wait" : "pointer",
          opacity: busy === "import" ? 0.6 : 1,
        }}
      >
        {busy === "import" ? "還原中…" : "↺ 還原備份"}
      </button>
      {msg && (
        <div
          onClick={() => setMsg(null)}
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0,
            zIndex: 30, maxWidth: 380,
            padding: "8px 12px",
            background: msg.ok ? "#0f2410" : "#2a1010",
            border: `1px solid ${msg.ok ? "#43B23C" : "#E5352B"}`,
            fontFamily: F.mono, fontSize: 11,
            color: msg.ok ? "#43B23C" : "#E5352B",
            cursor: "pointer",
          }}
        >
          {msg.text} · 點掉
        </div>
      )}
    </div>
  );
}
