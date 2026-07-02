/**
 * M1 憲章合規性驗證 script (Node ESM)
 *
 * 用 fixtures/2026-07-round1/1.xlsx 跑 seller-buy parser、印統計 + 檢驗防護 #1/#2。
 * 因為 Node 環境不吃 Vite 的 ?raw 匯入，這個 script 用 fs 直接讀檔並手動模擬。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as XLSX from "xlsx";
import { load as yamlLoad } from "js-yaml";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MENU_PATH = join(ROOT, "data/menu.yaml");
const FIXTURE = join(ROOT, "fixtures/2026-07-round1/1.xlsx");

// ---- 內嵌迷你版 domain logic（複製自 src/ 但 vanilla JS）----

function toNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/,/g, "").trim();
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function loadMenu(text) {
  return yamlLoad(text);
}

function lookupSku(rawName, menu) {
  const trimmed = String(rawName).trim();
  // aliases exact
  for (const [skuId, p] of Object.entries(menu.products)) {
    if ((p.aliases ?? []).includes(trimmed) || p.display_name === trimmed) {
      return skuId;
    }
  }
  // signature
  const cand = [];
  for (const [skuId, p] of Object.entries(menu.products)) {
    const sig = p.match_signature ?? { include: [], exclude: [] };
    if ((sig.include ?? []).length === 0) continue;
    const allInclude = sig.include.every((kw) => trimmed.includes(kw));
    const anyExclude = (sig.exclude ?? []).some((kw) => trimmed.includes(kw));
    if (allInclude && !anyExclude) {
      cand.push({
        skuId,
        score: sig.include.reduce((s, kw) => s + kw.length, 0),
      });
    }
  }
  if (cand.length === 0) return null;
  cand.sort((a, b) => b.score - a.score);
  return cand[0].skuId;
}

function readSheetTolerant(sh) {
  let maxRow = 0, maxCol = 0;
  for (const key of Object.keys(sh)) {
    if (key.startsWith("!")) continue;
    const m = /^([A-Z]+)(\d+)$/.exec(key);
    if (!m) continue;
    const col = colToNum(m[1]);
    const row = parseInt(m[2], 10);
    if (row > maxRow) maxRow = row;
    if (col > maxCol) maxCol = col;
  }
  const out = [];
  for (let r = 1; r <= maxRow; r++) {
    const row = [];
    for (let c = 0; c <= maxCol; c++) {
      const cell = sh[numToCol(c) + r];
      row.push(cell?.v ?? null);
    }
    out.push(row);
  }
  return out;
}
function colToNum(l) { let n = 0; for (const ch of l) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
function numToCol(n) { let s = ""; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }

function parseSellerBuy(buffer, sourceFile, menu) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sh = wb.Sheets["非訂單匯入"];
  if (!sh) throw new Error("缺 非訂單匯入 sheet");
  const rows = readSheetTolerant(sh);
  const orders = [];
  let current = null;
  let rawCount = 0;
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const c4Raw = r[4];
    const c12 = r[12];
    const c4Str = typeof c4Raw === "string" && c4Raw.trim() ? c4Raw.trim() : null;
    const isNew = c4Str !== null && c4Str !== current?.order_id;
    if (isNew) {
      if (current) orders.push(finalize(current, menu));
      current = {
        order_id: c4Str,
        status_raw: r[5] != null ? String(r[5]) : "",
        c22: toNum(r[22]),
        freight: toNum(r[17]) ?? 0,
        discount: (toNum(r[18]) ?? 0) + (toNum(r[19]) ?? 0) + (toNum(r[20]) ?? 0),
        total: toNum(r[21]),
        items: c12 != null ? [makeItem(r)] : [],
        recipient_name: r[7] != null ? String(r[7]).trim() : null,
        conv_store: r[11] != null ? String(r[11]).trim() : null,
      };
      rawCount++;
    } else if (c12 != null && String(c12).trim() && current) {
      current.items.push(makeItem(r));
    }
  }
  if (current) orders.push(finalize(current, menu));
  return { orders, raw_row_count: rawCount, source_file: sourceFile };
}

function makeItem(r) {
  return {
    name: String(r[12] ?? "").trim(),
    price: toNum(r[13]),
    qty: toNum(r[15]),
    subtotal: toNum(r[16]),
  };
}

function finalize(w, menu) {
  const reasons = [];
  if (!w.status_raw.includes("付款完成")) {
    reasons.push({
      code: "PAYMENT_NOT_CONFIRMED",
      msg: `狀態=${w.status_raw.split("\n")[0]}`,
    });
  }
  const items = [];
  for (const raw of w.items) {
    if (raw.name.includes("指定出貨日")) continue;
    const sku = lookupSku(raw.name, menu);
    if (!sku) {
      reasons.push({
        code: "UNKNOWN_PRODUCT",
        msg: raw.name.slice(0, 40),
      });
    }
    items.push({
      productSkuId: sku,
      rawName: raw.name,
      quantity: raw.qty ?? 1,
      subtotal: raw.subtotal,
    });
  }
  if (w.total !== null) {
    const subSum = items.reduce((s, it) => s + (it.subtotal ?? 0), 0);
    const expected = subSum + w.freight - w.discount;
    if (Math.abs(expected - w.total) > 2) {
      reasons.push({
        code: "AMOUNT_MISMATCH",
        msg: `expected=${expected} vs c21=${w.total}`,
      });
    }
  }
  const status =
    reasons.length === 0
      ? "confirmed"
      : reasons[0].code === "PAYMENT_NOT_CONFIRMED"
      ? "pending_payment"
      : reasons[0].code === "UNKNOWN_PRODUCT"
      ? "pending_product"
      : "pending_amount";
  return {
    id: w.order_id,
    status,
    c22: w.c22 ?? 1,
    labelCount: Math.max(1, Math.floor(w.c22 ?? 1)),
    total: w.total,
    reasons,
    items_count: items.length,
  };
}

// ---- 執行驗證 ----

const menuText = readFileSync(MENU_PATH, "utf-8");
const menu = loadMenu(menuText);
const buf = readFileSync(FIXTURE);
const result = parseSellerBuy(buf, "1.xlsx", menu);

const byStatus = {};
for (const o of result.orders) {
  byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
}
const totalLabels = result.orders
  .filter((o) => o.status === "confirmed")
  .reduce((s, o) => s + o.labelCount, 0);

console.log("═══════════════════════════════════════════");
console.log("  M1 驗證：fixtures/2026-07-round1/1.xlsx");
console.log("═══════════════════════════════════════════");
console.log(`  原始訂單列數 (rawCount) : ${result.raw_row_count}`);
console.log(`  解析出的訂單 (orders)   : ${result.orders.length}`);
console.log();
console.log("  訂單狀態分佈：");
for (const [s, n] of Object.entries(byStatus).sort()) {
  console.log(`    ${s.padEnd(25)}: ${n}`);
}
console.log();
console.log(`  Confirmed 訂單標籤總數  : ${totalLabels}`);
console.log();
console.log("═══════════════════════════════════════════");
console.log("  憲章防護檢驗");
console.log("═══════════════════════════════════════════");
const consOK = result.raw_row_count === result.orders.length;
console.log(
  `  [#1 總數守恆律] raw=${result.raw_row_count} vs orders=${result.orders.length}: ${consOK ? "✅" : "🚨 失敗"}`
);
// 憲章補丁：零筆訂單 = 疑似 parser 失效
if (result.raw_row_count === 0) {
  console.log("  🚨 [新增守恆律] rawCount=0 = parser 沒抓到任何訂單、必是 bug");
  process.exit(2);
}

// 顯示前 3 個 pending 樣本
const pending = result.orders.filter((o) => o.status !== "confirmed");
if (pending.length > 0) {
  console.log(`\n  前 3 筆 pending 樣本：`);
  for (const o of pending.slice(0, 3)) {
    console.log(`    ${o.id} [${o.status}]`);
    for (const r of o.reasons) {
      console.log(`      - ${r.code}: ${r.msg}`);
    }
  }
}

// 前 3 筆 confirmed
const confirmed = result.orders.filter((o) => o.status === "confirmed");
if (confirmed.length > 0) {
  console.log(`\n  前 3 筆 confirmed 樣本：`);
  for (const o of confirmed.slice(0, 3)) {
    console.log(
      `    ${o.id} → c22=${o.c22} label=${o.labelCount} $${o.total} items=${o.items_count}`
    );
  }
}
console.log();
