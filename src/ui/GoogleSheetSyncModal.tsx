/**
 * Google Sheet 同步 modal · Yen 2026-07-06
 * 用途：面交（in-person）Google Form 問卷回覆 sheet 一鍵拉最新資料
 *
 * 流程：
 *   1. 使用者貼 sheet URL（記憶到 localStorage）
 *   2. 沒 token → 點「授權 Google」按 GIS popup 拿 token
 *   3. 有 token → 點「立即同步」→ 拉 sheet → 走跟 xlsx 一樣的 import pipeline
 */
import { useEffect, useState } from "react";
import { ensureAccessToken, getStoredToken, signOut, GOOGLE_CLIENT_ID } from "../google/oauth";

const F = { tc: "'Noto Sans TC',sans-serif", mono: "'Space Mono',monospace", anton: "'Anton',sans-serif" };
const C = {
  bg: "#0F0F12", panel: "#141417", ink: "#F5F4EF",
  mut: "#8A8A93", mut2: "#6C6C74", line: "#26262C",
  acc: "#F5D400", green: "#43B23C", red: "#E5352B", orange: "#E5622A",
};

const LS_KEY = "narcos-oven.sheet-sync-config";
type SavedConfig = { sheetUrl: string; lastSyncAt: string | null };

function loadConfig(): SavedConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { sheetUrl: "", lastSyncAt: null };
    const p = JSON.parse(raw) as SavedConfig;
    return {
      sheetUrl: typeof p.sheetUrl === "string" ? p.sheetUrl : "",
      lastSyncAt: typeof p.lastSyncAt === "string" ? p.lastSyncAt : null,
    };
  } catch {
    return { sheetUrl: "", lastSyncAt: null };
  }
}
function saveConfig(c: SavedConfig): void {
  localStorage.setItem(LS_KEY, JSON.stringify(c));
}

export function GoogleSheetSyncModal({
  onClose,
  onSync,
}: {
  onClose: () => void;
  onSync: (sheetUrlOrId: string) => Promise<{ orderCount: number }>;
}) {
  const [saved, setSaved] = useState<SavedConfig>(loadConfig);
  const [sheetUrl, setSheetUrl] = useState(saved.sheetUrl);
  const [authed, setAuthed] = useState<boolean>(!!getStoredToken());
  const [busy, setBusy] = useState<null | "auth" | "sync">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // sync sheetUrl 到 localStorage（打字時 debounce 也可、這裡簡單起見即時存）
  useEffect(() => {
    const next = { ...saved, sheetUrl };
    saveConfig(next);
    setSaved(next);
  }, [sheetUrl]);

  const missingClientId = !GOOGLE_CLIENT_ID;

  async function onAuth() {
    if (busy) return;
    setBusy("auth");
    setMsg(null);
    try {
      await ensureAccessToken();
      setAuthed(true);
      setMsg({ ok: true, text: "✓ 已授權 Google 帳號" });
    } catch (err) {
      setMsg({ ok: false, text: `❌ 授權失敗：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(null);
    }
  }

  function onSignOut() {
    signOut();
    setAuthed(false);
    setMsg({ ok: true, text: "已登出 Google" });
  }

  async function onSyncClick() {
    if (busy) return;
    if (!sheetUrl.trim()) {
      setMsg({ ok: false, text: "❌ 請先貼 Sheet 網址" });
      return;
    }
    setBusy("sync");
    setMsg(null);
    try {
      const result = await onSync(sheetUrl.trim());
      const now = new Date().toISOString();
      const next = { sheetUrl, lastSyncAt: now };
      saveConfig(next);
      setSaved(next);
      setAuthed(!!getStoredToken());
      setMsg({ ok: true, text: `✓ 同步完成 · 拉到 ${result.orderCount} 筆訂單` });
    } catch (err) {
      setMsg({ ok: false, text: `❌ 同步失敗：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.bg, border: `1px solid ${C.line}`,
          width: "min(560px, 92vw)", maxHeight: "90vh", overflowY: "auto",
          padding: 0,
        }}
      >
        {/* header */}
        <div style={{ padding: "18px 22px 14px", borderBottom: `1px solid ${C.line}` }}>
          <div className="flex items-baseline" style={{ gap: 10 }}>
            <span style={{ fontFamily: F.anton, fontSize: 22, color: C.acc, letterSpacing: ".05em" }}>
              GOOGLE SHEET SYNC
            </span>
            <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 14, color: C.ink }}>
              面交問卷 · 線上同步
            </span>
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut2, marginTop: 6 }}>
            拉「表單回覆 1」分頁的訂單、跑跟拖檔一樣的 diff / dedup / sanity 流程
          </div>
        </div>

        {/* warning tape */}
        <div style={{ height: 6, background: "repeating-linear-gradient(45deg,#F5D400 0 12px,#111 12px 24px)" }} />

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
          {missingClientId && (
            <div style={{ background: "#2a1a10", border: `1px solid ${C.orange}`, padding: 12, fontFamily: F.mono, fontSize: 11, color: C.orange }}>
              ⚠ 系統未設定 VITE_GOOGLE_CLIENT_ID · 部署前要在 Vercel Project Settings → Environment Variables 加
            </div>
          )}

          {/* Step 1 · auth */}
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut, letterSpacing: ".14em", marginBottom: 8 }}>
              1 · GOOGLE 帳號授權
            </div>
            <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
              {authed ? (
                <>
                  <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 13, color: C.green }}>
                    ✓ 已授權（sessionStorage · 關 tab 需重授權）
                  </span>
                  <button
                    type="button"
                    onClick={onSignOut}
                    disabled={busy !== null}
                    style={{
                      fontFamily: F.mono, fontSize: 11,
                      color: C.mut, background: "transparent",
                      border: `1px solid ${C.line}`, padding: "5px 10px", cursor: "pointer",
                    }}
                  >
                    登出
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void onAuth()}
                  disabled={busy !== null || missingClientId}
                  style={{
                    fontFamily: F.tc, fontWeight: 900, fontSize: 13,
                    color: "#111", background: C.acc, border: "none",
                    padding: "9px 18px", cursor: busy ? "wait" : "pointer",
                    opacity: (busy || missingClientId) ? 0.6 : 1,
                  }}
                >
                  {busy === "auth" ? "授權中…" : "🔑 授權 Google 帳號"}
                </button>
              )}
            </div>
          </div>

          {/* Step 2 · sheet URL */}
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut, letterSpacing: ".14em", marginBottom: 8 }}>
              2 · SHEET 網址
            </div>
            <input
              type="url"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/xxxx/edit"
              spellCheck={false}
              style={{
                width: "100%", boxSizing: "border-box",
                fontFamily: F.mono, fontSize: 12, color: C.ink,
                background: C.panel, border: `1px solid ${C.line}`,
                padding: "9px 12px", outline: "none",
              }}
            />
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut2, marginTop: 6, lineHeight: 1.5 }}>
              · 貼問卷回覆連動 sheet 的完整網址（會自動抽 Spreadsheet ID）
              <br />· 分頁名固定為「表單回覆 1」· 更改分頁名的話請跟開發者說
            </div>
          </div>

          {/* Step 3 · sync button */}
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut, letterSpacing: ".14em", marginBottom: 8 }}>
              3 · 執行
            </div>
            <button
              type="button"
              onClick={() => void onSyncClick()}
              disabled={busy !== null || !sheetUrl.trim()}
              style={{
                width: "100%",
                fontFamily: F.tc, fontWeight: 900, fontSize: 14,
                color: "#111", background: C.green, border: "none",
                padding: "12px 0", cursor: busy ? "wait" : "pointer",
                opacity: (busy || !sheetUrl.trim()) ? 0.55 : 1,
                letterSpacing: ".05em",
              }}
            >
              {busy === "sync" ? "同步中…" : "🔄 立即同步"}
            </button>
            {saved.lastSyncAt && (
              <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut2, marginTop: 6, textAlign: "right" }}>
                上次同步：{saved.lastSyncAt.slice(0, 19).replace("T", " ")}
              </div>
            )}
          </div>

          {msg && (
            <div style={{
              padding: "10px 12px",
              background: msg.ok ? "#0f2410" : "#2a1010",
              border: `1px solid ${msg.ok ? C.green : C.red}`,
              fontFamily: F.mono, fontSize: 11,
              color: msg.ok ? C.green : C.red,
            }}>
              {msg.text}
            </div>
          )}
        </div>

        <div style={{ padding: "14px 22px", borderTop: `1px solid ${C.line}`, textAlign: "right" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontFamily: F.tc, fontWeight: 700, fontSize: 12,
              color: C.mut, background: "transparent",
              border: `1px solid ${C.line}`, padding: "7px 16px", cursor: "pointer",
            }}
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
