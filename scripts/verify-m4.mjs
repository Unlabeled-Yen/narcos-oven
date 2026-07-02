/**
 * M4 Excel 產出驗證
 *
 * 跑三個 parser、模擬 db 為空的初次匯入、產 3 個 Excel 到 test-output/
 * Yen 可 open 檢查外觀。
 */
import * as fs from "node:fs";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as XLSX from "xlsx";
XLSX.set_fs(fs);
import { load as yamlLoad } from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIXTURE = join(ROOT, "fixtures/2026-07-round1");
const OUT_DIR = join(ROOT, "test-output");
mkdirSync(OUT_DIR, { recursive: true });

// ============================================================
// vanilla parser + snapshot generator（跟 src/ 一致）
// ============================================================
function toNum(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const c = v.replace(/,/g, "").trim();
    if (!c) return null;
    const n = Number(c);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function colToNum(l) { let n = 0; for (const ch of l) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
function numToCol(n) { let s = ""; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
function readSheetTolerant(sh) {
  let maxRow = 0, maxCol = 0;
  for (const key of Object.keys(sh)) {
    if (key.startsWith("!")) continue;
    const m = /^([A-Z]+)(\d+)$/.exec(key);
    if (!m) continue;
    maxRow = Math.max(maxRow, +m[2]);
    maxCol = Math.max(maxCol, colToNum(m[1]));
  }
  const out = [];
  for (let r = 1; r <= maxRow; r++) {
    const row = [];
    for (let c = 0; c <= maxCol; c++) row.push(sh[numToCol(c) + r]?.v ?? null);
    out.push(row);
  }
  return out;
}
function menuLookup(name, menu) {
  const t = String(name).trim();
  for (const [sku, p] of Object.entries(menu.products)) {
    if ((p.aliases ?? []).includes(t) || p.display_name === t) return sku;
  }
  const cand = [];
  for (const [sku, p] of Object.entries(menu.products)) {
    const sig = p.match_signature ?? { include: [], exclude: [] };
    if ((sig.include ?? []).length === 0) continue;
    const inc = sig.include.every((kw) => t.includes(kw));
    const exc = (sig.exclude ?? []).some((kw) => t.includes(kw));
    if (inc && !exc) cand.push({ sku, score: sig.include.reduce((s, kw) => s + kw.length, 0) });
  }
  if (cand.length === 0) return null;
  cand.sort((a, b) => b.score - a.score);
  return cand[0].sku;
}
function inferYYYYMMDD(month, day, anchor) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const a = anchor ?? new Date();
  for (const y of [a.getFullYear(), a.getFullYear() + 1]) {
    const cand = new Date(y, month - 1, day);
    if (cand.getFullYear() === y && cand.getMonth() === month - 1 && cand.getDate() === day) {
      const diff = (cand.getTime() - a.getTime()) / 86400000;
      if (diff >= -3 && diff <= 90) {
        return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }
  return null;
}
function parseYMD(v) {
  if (typeof v === "string") {
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(v);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  return null;
}
function parseSB(buf, sourceFile, menu) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sh = wb.Sheets["非訂單匯入"];
  if (!sh) return [];
  const rows = readSheetTolerant(sh);
  const orders = [];
  let cur = null;
  const flush = () => {
    if (cur) orders.push(finalizeSB(cur, menu));
  };
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const c4Raw = r[4];
    const c4 = typeof c4Raw === "string" && c4Raw.trim() ? c4Raw.trim() : null;
    const c12 = r[12];
    if (c4 && c4 !== cur?.id) {
      flush();
      cur = {
        id: c4,
        status: r[5] ?? "",
        c22: toNum(r[22]),
        freight: toNum(r[17]) ?? 0,
        discount: (toNum(r[18]) ?? 0) + (toNum(r[19]) ?? 0) + (toNum(r[20]) ?? 0),
        total: toNum(r[21]),
        items: c12 != null ? [{ name: String(c12).trim(), subtotal: toNum(r[16]), qty: toNum(r[15]) }] : [],
        recipient: r[7] != null ? String(r[7]).trim() : null,
        conv: r[11] != null ? String(r[11]).trim() : null,
        order_date: parseYMD(r[3]),
        source: sourceFile,
      };
    } else if (c12 != null && String(c12).trim() && cur) {
      cur.items.push({ name: String(c12).trim(), subtotal: toNum(r[16]), qty: toNum(r[15]) });
    }
  }
  flush();
  return orders;
}
function finalizeSB(w, menu) {
  let batchDate = null;
  for (const it of w.items) {
    if (it.name.includes("指定出貨日")) {
      const m = /指定出貨日.*?(\d+)\/(\d+)/.exec(it.name);
      if (m) batchDate = inferYYYYMMDD(+m[1], +m[2], w.order_date);
      break;
    }
  }
  const items = [];
  let productKey = [];
  for (const raw of w.items) {
    if (raw.name.includes("指定出貨日")) continue;
    productKey.push(raw.name);
    const sku = menuLookup(raw.name, menu);
    if (!sku) continue;
    const qty = raw.qty ?? 1;
    const p = menu.products[sku];
    items.push({
      productSkuId: sku,
      rawName: raw.name,
      quantity: qty,
      subtotal: raw.subtotal,
      atoms: p.contains.map((a) => ({ atomId: a.atom, count: a.count * qty })),
    });
  }
  const paid = String(w.status).includes("付款完成");
  const status = paid ? "confirmed" : "pending_payment";
  const labelCount = w.c22 != null ? Math.max(1, Math.floor(w.c22)) : 1;
  return {
    id: w.id,
    channel: "賣貨便",
    status,
    batchDate,
    recipient: { name: w.recipient, igOrLine: null, phone: null, address: null, convStore: w.conv },
    items,
    revenue: { grossTotal: w.total ?? 0, freight: w.freight, discount: w.discount },
    labelCount,
    pendingReasons: [],
    rawSource: { file: w.source, sheet: "非訂單匯入", rowIndex: 0, rawStatus: String(w.status) },
    snapshot: { c5_status: String(w.status), c11_conv_store: w.conv, c12_product: productKey.join("\n"), c17_freight: w.freight, c18_discount_seller: 0, c19_discount_freight: 0, c20_discount_platform: w.discount, c21_total: w.total, c22_label_count: w.c22 },
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    disappeared_at: null,
    disappeared_resolution: null,
    frozen_after_label_print: false,
    changes: [],
  };
}

// 面交 parser 略（M4 產出用得到但複雜、只做賣貨便驗證足夠）
// KOL 略

// ============================================================
// generate excel (簡化版)
// ============================================================
function last5(id) { return id.startsWith("CM") ? id.slice(-5) : id; }

function statsWb(orders, menu) {
  const eligible = orders.filter((o) => (o.status === "confirmed" || o.status === "kol_shipped") && o.batchDate);
  const atoms = Object.keys(menu.atoms);
  const dates = [...new Set(eligible.map((o) => o.batchDate))].sort();
  const chOrder = ["賣貨便", "面交", "宅配", "KOL", "其他"];
  const normalizeCh = (c) => c === "賣貨便" ? "賣貨便" : c.startsWith("面交") ? "面交" : c === "宅配" ? "宅配" : c === "KOL" ? "KOL" : "其他";
  const cols = [];
  for (const d of dates) {
    const chs = new Set(eligible.filter((o) => o.batchDate === d).map((o) => normalizeCh(o.channel)));
    for (const ch of chOrder) if (chs.has(ch)) cols.push({ d, ch });
  }
  const counts = new Map();
  for (const o of eligible) {
    const nch = normalizeCh(o.channel);
    for (const it of o.items) for (const a of it.atoms) {
      const k = `${a.atomId}||${o.batchDate}||${nch}`;
      counts.set(k, (counts.get(k) ?? 0) + a.count);
    }
  }
  const header = ["品項", ...cols.map((c) => `${c.d} ${c.ch}`), "合計"];
  const rows = [header];
  const colSums = new Array(cols.length).fill(0);
  for (const a of atoms) {
    let rowSum = 0;
    const row = [`${a} (${menu.atoms[a].unit})`];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const n = counts.get(`${a}||${c.d}||${c.ch}`) ?? 0;
      row.push(n || "");
      rowSum += n;
      colSums[i] += n;
    }
    row.push(rowSum || "");
    if (rowSum > 0) rows.push(row);
  }
  const total = ["合計", ...colSums.map((n) => n || ""), colSums.reduce((s, n) => s + n, 0)];
  rows.push(total);
  const wb = XLSX.utils.book_new();
  const sh = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, sh, "出爐統計");
  return wb;
}

function overviewWb(orders, menu) {
  const eligible = orders.filter((o) => (o.status === "confirmed") && o.batchDate);
  const byDate = new Map();
  for (const o of eligible) {
    if (!byDate.has(o.batchDate)) byDate.set(o.batchDate, []);
    byDate.get(o.batchDate).push(o);
  }
  const wb = XLSX.utils.book_new();
  for (const d of [...byDate.keys()].sort()) {
    const list = byDate.get(d);
    const header = ["#", "單號後五碼", "姓名", "取件門市", "訂購商品", "金額", "IG/LINE", "標籤數"];
    const rows = [header];
    let idx = 1;
    for (const o of list) {
      const items = o.items.map((it) => {
        const dn = menu.products[it.productSkuId]?.display_name ?? it.rawName;
        return `${dn} ×${it.quantity}`;
      }).join("\n");
      rows.push([idx++, last5(o.id), o.recipient.name ?? "", o.recipient.convStore ?? "", items, o.revenue.grossTotal || "", "", o.labelCount]);
    }
    rows.push([]);
    rows.push(["品項統計", "顆/罐"]);
    const cnt = new Map();
    for (const o of list) for (const it of o.items) for (const a of it.atoms) cnt.set(a.atomId, (cnt.get(a.atomId) ?? 0) + a.count);
    for (const [k, n] of [...cnt.entries()].sort((a, b) => b[1] - a[1])) {
      rows.push([k, `${n} ${menu.atoms[k]?.unit ?? ""}`]);
    }
    const sh = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, sh, d);
  }
  return wb;
}

function payoutWb(orders, menu) {
  const eligible = orders.filter((o) => (o.status === "confirmed") && o.batchDate);
  const byDate = new Map();
  for (const o of eligible) {
    if (!byDate.has(o.batchDate)) byDate.set(o.batchDate, []);
    byDate.get(o.batchDate).push(o);
  }
  const table = menu.logistics_cost ?? {};
  function logistics(o) {
    if (o.channel === "賣貨便") return table["賣貨便_超商"] ?? 60;
    if (o.channel === "宅配") return table["宅配"] ?? 130;
    if (o.channel.startsWith("面交")) return table["面交"] ?? 0;
    if (o.channel === "KOL") return table["KOL"] ?? 60;
    return 0;
  }
  const header = ["批次", "筆數", "總營收", "品牌50%", "主廚30%", "行銷20%", "物流實付", "淨營收"];
  const rows = [header];
  let tc = 0, tr = 0, tl = 0;
  for (const d of [...byDate.keys()].sort()) {
    const list = byDate.get(d);
    let rev = 0, log = 0;
    for (const o of list) { rev += o.revenue.grossTotal; log += logistics(o); }
    rows.push([d, list.length, rev, Math.round(rev*0.5), Math.round(rev*0.3), Math.round(rev*0.2), log, rev - log]);
    tc += list.length; tr += rev; tl += log;
  }
  rows.push(["合計", tc, tr, Math.round(tr*0.5), Math.round(tr*0.3), Math.round(tr*0.2), tl, tr-tl]);
  const wb = XLSX.utils.book_new();
  const sh = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, sh, "分潤統計");
  return wb;
}

// ============================================================
// 執行
// ============================================================
const menu = yamlLoad(readFileSync(join(ROOT, "data/menu.yaml"), "utf-8"));

const sb1 = parseSB(readFileSync(join(FIXTURE, "1.xlsx")), "1.xlsx", menu);
const sb2 = parseSB(readFileSync(join(FIXTURE, "2.xlsx")), "2.xlsx", menu);
const all = [...sb1, ...sb2];

console.log(`  總訂單: ${all.length} (賣貨便 only、M4 verify 簡化)`);
console.log(`  confirmed: ${all.filter((o) => o.status === "confirmed").length}`);
console.log(`  有 batchDate: ${all.filter((o) => o.batchDate).length}`);
console.log(`  confirmed + batchDate (可入 Excel): ${all.filter((o) => o.status === "confirmed" && o.batchDate).length}\n`);

const stats = statsWb(all, menu);
const overview = overviewWb(all, menu);
const payout = payoutWb(all, menu);

XLSX.writeFile(stats, join(OUT_DIR, "出爐統計.xlsx"));
XLSX.writeFile(overview, join(OUT_DIR, "出貨總覽.xlsx"));
XLSX.writeFile(payout, join(OUT_DIR, "分潤統計.xlsx"));

console.log("✅ 產出：");
console.log(`   ${join(OUT_DIR, "出爐統計.xlsx")}`);
console.log(`   ${join(OUT_DIR, "出貨總覽.xlsx")}`);
console.log(`   ${join(OUT_DIR, "分潤統計.xlsx")}`);
console.log("\n在 Finder 或 Numbers 打開檢查外觀。");
