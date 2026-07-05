/**
 * Google Sheets API v4 client · 只讀
 * Yen 2026-07-06
 *
 * 用 access_token 呼 REST · 拿 spreadsheet 內某 tab 的 rows
 * 回傳 2D array · 完全對齊 xlsx-tolerant readSheetTolerant 的 shape
 */
import { ensureAccessToken } from "./oauth";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

/** 從 sheet URL 抽 spreadsheet id · 支援 /d/{id}/... */
export function extractSheetId(input: string): string | null {
  const trimmed = input.trim();
  // 直接就是 ID（44 char alphanumeric+dash+underscore）
  if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  const m = /\/d\/([A-Za-z0-9_-]+)/.exec(trimmed);
  return m?.[1] ?? null;
}

async function fetchWithToken<T>(url: string): Promise<T> {
  const token = await ensureAccessToken();
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!resp.ok) {
    let bodyText = "";
    try { bodyText = await resp.text(); } catch { /* ignore */ }
    throw new Error(`Sheets API ${resp.status}：${bodyText.slice(0, 300)}`);
  }
  return (await resp.json()) as T;
}

export type SpreadsheetMeta = {
  spreadsheetId: string;
  properties: { title: string };
  sheets: Array<{
    properties: {
      sheetId: number;
      title: string;
      gridProperties: { rowCount: number; columnCount: number };
    };
  }>;
};

export async function getSpreadsheetMeta(sheetId: string): Promise<SpreadsheetMeta> {
  const url = `${BASE}/${encodeURIComponent(sheetId)}?fields=spreadsheetId,properties.title,sheets.properties`;
  return fetchWithToken<SpreadsheetMeta>(url);
}

/**
 * 讀某 tab 的所有 rows · valueRenderOption=UNFORMATTED_VALUE 讓數字 / 日期回原生型別
 * dateTimeRenderOption=FORMATTED_STRING 讓時戳回字串（跟 xlsx cell string 一致）
 */
export async function getSheetRows(
  sheetId: string,
  tabName: string,
): Promise<unknown[][]> {
  const range = encodeURIComponent(tabName);
  const url =
    `${BASE}/${encodeURIComponent(sheetId)}/values/${range}` +
    `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const data = await fetchWithToken<{ range: string; majorDimension: string; values?: unknown[][] }>(url);
  return data.values ?? [];
}
