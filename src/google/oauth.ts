/**
 * Google OAuth · GIS token flow（browser-only, no backend）
 * Yen 2026-07-06
 *
 * 用 Google Identity Services (GIS) 拿 access_token · 只讀權限
 * Token 存 sessionStorage · 過期就叫 UI 重新按 button 授權
 *
 * SDK 由 index.html 的 <script src="https://accounts.google.com/gsi/client"> 載入
 */

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_KEY = "narcos-oven.google-token";

// Vite env var · 部署到 Vercel 前記得在 Vercel Project Settings 加 VITE_GOOGLE_CLIENT_ID
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "") as string;

export type StoredToken = {
  access_token: string;
  expires_at: number; // epoch ms
};

// GIS SDK 全域型別（沒 @types 就手打）
type TokenResponse = {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
};
type TokenClient = { requestAccessToken: (opts?: { prompt?: string }) => void };
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: TokenResponse) => void;
            error_callback?: (err: { type: string; message?: string }) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

function saveToken(t: StoredToken): void {
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t));
}
function loadToken(): StoredToken | null {
  const raw = sessionStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as StoredToken;
    if (typeof t.access_token !== "string" || typeof t.expires_at !== "number") return null;
    return t;
  } catch {
    return null;
  }
}
function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function getStoredToken(): StoredToken | null {
  const t = loadToken();
  if (!t) return null;
  // 提早 60 秒視為過期 · 避免 request 中途過期
  if (t.expires_at <= Date.now() + 60_000) {
    clearToken();
    return null;
  }
  return t;
}

export function signOut(): void {
  clearToken();
}

/**
 * 觸發 GIS token popup · resolve 拿到 access_token
 * 需在 user gesture context (click) 內呼叫 · 不然 popup 會被瀏覽器擋
 */
export async function requestAccessToken(): Promise<StoredToken> {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error(
      "缺 VITE_GOOGLE_CLIENT_ID · 請在 Vercel Project Settings → Environment Variables 加、或本地 .env.local 加",
    );
  }
  if (!window.google?.accounts?.oauth2) {
    throw new Error(
      "Google Identity Services SDK 未載入 · 檢查 index.html 有沒有 accounts.google.com/gsi/client script tag",
    );
  }
  return new Promise<StoredToken>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) {
          reject(new Error(`Google OAuth 錯誤：${resp.error}`));
          return;
        }
        const token: StoredToken = {
          access_token: resp.access_token,
          expires_at: Date.now() + resp.expires_in * 1000,
        };
        saveToken(token);
        resolve(token);
      },
      error_callback: (err) => {
        reject(new Error(`Google OAuth 失敗：${err.type}${err.message ? ` · ${err.message}` : ""}`));
      },
    });
    // prompt="consent" 每次都顯示同意畫面；"" = 有 session 就 silent、沒有才彈
    client.requestAccessToken({ prompt: "" });
  });
}

export async function ensureAccessToken(): Promise<StoredToken> {
  const existing = getStoredToken();
  if (existing) return existing;
  return requestAccessToken();
}
