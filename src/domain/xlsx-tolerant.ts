/**
 * 對抗 broken !ref：直接掃 cell keys 決定真實 row/col 範圍。
 * 憲章原則 1 實例——不能信外部匯出的 metadata。
 *
 * 從 seller-buy.ts 抽出，供 in-person.ts / kol.ts 共用。
 */
import * as XLSX from "xlsx";

export function readSheetTolerant(sh: XLSX.WorkSheet): unknown[][] {
  let maxRow = 0;
  let maxCol = 0;
  for (const key of Object.keys(sh)) {
    if (key.startsWith("!")) continue;
    const m = /^([A-Z]+)(\d+)$/.exec(key);
    if (!m) continue;
    const col = colToNum(m[1]!);
    const row = parseInt(m[2]!, 10);
    if (row > maxRow) maxRow = row;
    if (col > maxCol) maxCol = col;
  }
  const out: unknown[][] = [];
  for (let r = 1; r <= maxRow; r++) {
    const row: unknown[] = [];
    for (let c = 0; c <= maxCol; c++) {
      const addr = numToCol(c) + r;
      const cell = sh[addr] as XLSX.CellObject | undefined;
      row.push(cell?.v ?? null);
    }
    out.push(row);
  }
  return out;
}

function colToNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function numToCol(n: number): string {
  let s = "";
  n++;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
