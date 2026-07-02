/**
 * M2 憲章合規性驗證 script
 *
 * 跑三個 fixture、印各通路統計、憲章守恆律檢驗、對出爐日 7/7、7/14 分佈與雇主已知數字對照。
 *
 * ⚠️ 這 script 內嵌 vanilla JS 版本的 parser（因為 Node 直接跑 TS parsers 需 tsx，先簡化）。
 * 未來 M3 SQLite 進來時、改成 esbuild 打包 dist/parsers.js 供 Node 用。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as XLSX from "xlsx";
import { load as yamlLoad } from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIXTURE_DIR = join(ROOT, "fixtures/2026-07-round1");

// ================ shared helpers ================

function toNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const c = v.replace(/,/g, "").trim();
    if (c === "") return null;
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
    const col = colToNum(m[1]);
    const row = parseInt(m[2], 10);
    if (row > maxRow) maxRow = row;
    if (col > maxCol) maxCol = col;
  }
  const out = [];
  for (let r = 1; r <= maxRow; r++) {
    const row = [];
    for (let c = 0; c <= maxCol; c++) {
      row.push(sh[numToCol(c) + r]?.v ?? null);
    }
    out.push(row);
  }
  return out;
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function inferYYYYMMDD(month, day, anchor) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const a = anchor ?? new Date();
  for (const y of [a.getFullYear(), a.getFullYear() + 1]) {
    const cand = new Date(y, month - 1, day);
    if (cand.getFullYear() === y && cand.getMonth() === month - 1 && cand.getDate() === day) {
      const diff = (cand.getTime() - a.getTime()) / 86400000;
      if (diff >= -3 && diff <= 90) return fmtDate(cand);
    }
  }
  return null;
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

// ================ seller-buy parser ================

function parseSellerBuy(buf, sourceFile, menu) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sh = wb.Sheets["非訂單匯入"];
  if (!sh) throw new Error("seller-buy 缺 sheet");
  const rows = readSheetTolerant(sh);
  const orders = [];
  let current = null;
  let raw = 0;
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const c4 = typeof r[4] === "string" && r[4].trim() ? r[4].trim() : null;
    const c12 = r[12];
    if (c4 && c4 !== current?.order_id) {
      if (current) orders.push(finalizeSB(current, menu));
      raw++;
      const orderDate = parseYMD(r[3]);
      current = {
        order_id: c4,
        status_raw: r[5] != null ? String(r[5]) : "",
        c22: toNum(r[22]),
        freight: toNum(r[17]) ?? 0,
        discount: (toNum(r[18]) ?? 0) + (toNum(r[19]) ?? 0) + (toNum(r[20]) ?? 0),
        total: toNum(r[21]),
        items: c12 != null ? [makeSBItem(r)] : [],
        recipient: r[7] != null ? String(r[7]).trim() : null,
        order_date: orderDate,
      };
    } else if (c12 != null && String(c12).trim() && current) {
      current.items.push(makeSBItem(r));
    }
  }
  if (current) orders.push(finalizeSB(current, menu));
  return { orders, raw };
}

function parseYMD(v) {
  if (typeof v === "string") {
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(v);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  return null;
}

function makeSBItem(r) {
  return {
    name: String(r[12] ?? "").trim(),
    price: toNum(r[13]),
    qty: toNum(r[15]),
    subtotal: toNum(r[16]),
  };
}

function finalizeSB(w, menu) {
  const reasons = [];
  if (!w.status_raw.includes("付款完成")) {
    reasons.push({ code: "PAYMENT_NOT_CONFIRMED" });
  }
  let batchDate = null;
  for (const it of w.items) {
    if (it.name.includes("指定出貨日")) {
      const m = /指定出貨日.*?(\d+)\/(\d+)/.exec(it.name);
      if (m) batchDate = inferYYYYMMDD(+m[1], +m[2], w.order_date);
      break;
    }
  }
  if (!batchDate) reasons.push({ code: "MISSING_BATCH_DATE" });
  const items = [];
  for (const raw of w.items) {
    if (raw.name.includes("指定出貨日")) continue;
    const sku = menuLookup(raw.name, menu);
    if (!sku) reasons.push({ code: "UNKNOWN_PRODUCT", msg: raw.name.slice(0, 30) });
    items.push({ sku, subtotal: raw.subtotal });
  }
  if (w.total !== null) {
    const sum = items.reduce((s, it) => s + (it.subtotal ?? 0), 0);
    const expected = sum + w.freight - w.discount;
    if (Math.abs(expected - w.total) > 2) reasons.push({ code: "AMOUNT_MISMATCH" });
  }
  const labelCount = w.c22 != null ? Math.max(1, Math.floor(w.c22)) : 1;
  const status =
    reasons.length === 0
      ? "confirmed"
      : reasons.find((x) => x.code === "PAYMENT_NOT_CONFIRMED")
      ? "pending_payment"
      : reasons.find((x) => x.code === "UNKNOWN_PRODUCT")
      ? "pending_product"
      : reasons.find((x) => x.code === "AMOUNT_MISMATCH")
      ? "pending_amount"
      : "pending_batch_date";
  return {
    id: w.order_id,
    channel: "賣貨便",
    status,
    batchDate,
    labelCount,
    revenue: w.total ?? 0,
  };
}

// ================ in-person parser ================

const LOC_RE = /(中壢|台中|台北|新竹|高雄|桃園|台南|嘉義|澎湖)/;
const TYPE_RE = /(面交|冷凍宅配|宅配|駐店|活動|私定)/;

const IP_HEADER_TO_SKU = [
  ["肉桂捲四入", "經典肉桂捲4入"],
  ["蘋果肉桂捲四入", "蘋果肉桂捲4入"],
  ["焦糖蘋果肉桂麵包", "方型3入_焦糖蘋果"],
  ["芝麻焙茶奶酥磅蛋糕", "方型3入_芝麻磅"],
  ["鳳梨肉桂奶酥磅蛋糕", "方型3入_鳳梨磅"],
  ["肉桂捲x5", "經典肉桂捲5入含醬"],
  ["蘋果肉桂捲x5", "蘋果肉桂捲5入含醬"],
  ["肉桂捲x3", "混合5入含醬"],
  ["原味巴斯克", "原味巴斯克"],
  ["芝麻巴斯克", "芝麻巴斯克"],
  ["焙茶巴斯克", "焙茶栗子巴斯克"],
  ["白玉烏龍茶巴斯克", "白玉烏龍茶巴斯克"],
  ["90ml 香料堅果醬", "香料堅果醬90ml"],
  ["240ml 香料堅果醬", "香料堅果醬240ml"],
];
function mapIpHeader(h) {
  for (const [kw, sku] of IP_HEADER_TO_SKU) if (h.includes(kw)) return sku;
  return null;
}

function parseInPerson(buf, sourceFile) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sh = wb.Sheets["表單回覆 1"];
  if (!sh) throw new Error("in-person 缺 sheet");
  const rows = readSheetTolerant(sh);
  const header = rows[0] ?? [];
  const orders = [];
  let raw = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const c2 = r[2], c23 = r[23];
    if (!(typeof c2 === "string" && c2.trim()) && !(typeof r[21] === "string" && r[21].trim()) && toNum(c23) === null) continue;
    raw++;
    const reasons = [];
    const c2Text = typeof c2 === "string" ? c2.trim() : "";
    const loc = LOC_RE.exec(c2Text);
    const typ = TYPE_RE.exec(c2Text);
    const submitDate = parseISOish(r[0]);
    const dateM = /(\d+)\/(\d+)/.exec(c2Text);
    const batchDate = dateM ? inferYYYYMMDD(+dateM[1], +dateM[2], submitDate) : null;
    let channel;
    if (typ?.[1] === "冷凍宅配" || typ?.[1] === "宅配") channel = "宅配";
    else if (typ?.[1] === "面交" && loc) channel = loc[1] === "中壢" ? "面交_中壢" : loc[1] === "台中" ? "面交_台中" : "面交_其他";
    else if (typ?.[1]) { channel = "待分類"; reasons.push({ code: "AMBIGUOUS_CHANNEL" }); }
    else { channel = "待分類"; reasons.push({ code: "AMBIGUOUS_CHANNEL" }); }
    if (!batchDate) reasons.push({ code: "MISSING_BATCH_DATE" });
    const items = [];
    for (let col = 7; col <= 20; col++) {
      const qty = toNum(r[col]);
      if (qty === null || qty <= 0) continue;
      const sku = mapIpHeader(String(header[col] ?? ""));
      if (!sku) { reasons.push({ code: "UNKNOWN_PRODUCT" }); continue; }
      items.push({ sku, qty });
    }
    if (items.length === 0 && !reasons.some(x => x.code === "UNKNOWN_PRODUCT")) reasons.push({ code: "UNKNOWN_PRODUCT" });
    const labelCount = items.reduce((s, it) => s + it.qty, 0) || 1;
    const status =
      reasons.length === 0
        ? "confirmed"
        : reasons.find(x => x.code === "AMBIGUOUS_CHANNEL")
        ? "pending_channel"
        : reasons.find(x => x.code === "MISSING_BATCH_DATE")
        ? "pending_batch_date"
        : "pending_product";
    orders.push({
      id: `IP-r${i + 1}`,
      channel,
      status,
      batchDate,
      labelCount,
      revenue: toNum(c23) ?? 0,
    });
  }
  return { orders, raw };
}

function parseISOish(v) {
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  return null;
}

// ================ KOL parser ================

const CHOICE_RE = /擇一|口味擇一|請選/;
function mapKolProductToSku(raw, menu) {
  const t = raw.replace(/^◆\s*/, "").trim();
  const direct = menuLookup(t, menu);
  if (direct) return direct;
  if (/四入肉桂捲|肉桂捲\s*4\s*入/.test(t) && !t.includes("蘋果")) return "經典肉桂捲4入";
  if (/四入蘋果|蘋果肉桂捲\s*4\s*入|四入.*蘋果捲/.test(t)) return "蘋果肉桂捲4入";
  if (/香料堅果醬.*90|90.*香料堅果醬/.test(t)) return "香料堅果醬90ml";
  if (/原味巴斯克/.test(t) && !/白玉/.test(t)) return "原味巴斯克";
  return null;
}

function parseKol(buf, sourceFile, menu) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sh = wb.Sheets["未完成"];
  if (!sh) return { orders: [], raw: 0 };
  const rows = readSheetTolerant(sh);
  const orders = [];
  let current = null;
  let raw = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const c1 = r[1], c2 = r[2], c4 = r[4], c5 = r[5], c6 = r[6];
    const hasNew = (typeof c1 === "string" && c1.trim()) || (typeof c2 === "string" && c2.trim());
    if (hasNew) {
      if (current) orders.push(finalizeKol(current, menu));
      raw++;
      current = {
        id: `KOL-${(c1 || c2 || `row${i + 1}`).toString().trim()}`,
        ship_raw: c4,
        products: (typeof c5 === "string" && c5.trim()) ? [c5.trim()] : [],
        shipped: c6 === true,
        row_start: i + 1,
      };
    } else if (current && typeof c5 === "string" && c5.trim()) {
      current.products.push(c5.trim());
      if (c6 === true) current.shipped = true;
    }
  }
  if (current) orders.push(finalizeKol(current, menu));
  return { orders, raw };
}

function kolDate(v) {
  if (v instanceof Date) return fmtDate(v);
  if (typeof v === "string") {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const md = /(\d+)\/(\d+)/.exec(v);
    if (md) return inferYYYYMMDD(+md[1], +md[2], null);
  }
  if (typeof v === "number") {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return fmtDate(d);
  }
  return null;
}

function finalizeKol(w, menu) {
  if (w.shipped) {
    return { id: w.id, channel: "KOL", status: "kol_shipped", batchDate: kolDate(w.ship_raw), labelCount: 0, revenue: 0 };
  }
  const reasons = [];
  const batchDate = kolDate(w.ship_raw);
  if (!batchDate) reasons.push({ code: "MISSING_BATCH_DATE" });
  const items = [];
  for (const p of w.products) {
    if (CHOICE_RE.test(p)) { reasons.push({ code: "KOL_CHOICE_UNRESOLVED" }); continue; }
    const sku = mapKolProductToSku(p, menu);
    if (!sku) { reasons.push({ code: "UNKNOWN_PRODUCT" }); continue; }
    items.push({ sku });
  }
  const labelCount = items.length;
  const status =
    reasons.length === 0
      ? "confirmed"
      : reasons.find(x => x.code === "MISSING_BATCH_DATE")
      ? "pending_batch_date"
      : reasons.find(x => x.code === "KOL_CHOICE_UNRESOLVED")
      ? "pending_kol_choice"
      : "pending_product";
  return { id: w.id, channel: "KOL", status, batchDate, labelCount, revenue: 0 };
}

// ================ 執行 ================

const menu = yamlLoad(readFileSync(join(ROOT, "data/menu.yaml"), "utf-8"));

console.log("═══════════════════════════════════════════");
console.log("  M2 三通路整合驗證");
console.log("═══════════════════════════════════════════\n");

const sb1 = parseSellerBuy(readFileSync(join(FIXTURE_DIR, "1.xlsx")), "1.xlsx", menu);
const sb2 = parseSellerBuy(readFileSync(join(FIXTURE_DIR, "2.xlsx")), "2.xlsx", menu);
const ip = parseInPerson(readFileSync(join(FIXTURE_DIR, "2026 六月 面交訂購單 (回覆).xlsx")), "面交.xlsx", menu);
const kol = parseKol(readFileSync(join(FIXTURE_DIR, "KOL 合作.xlsx")), "KOL.xlsx", menu);

const allOrders = [...sb1.orders, ...sb2.orders, ...ip.orders, ...kol.orders];
const rawSum = sb1.raw + sb2.raw + ip.raw + kol.raw;

console.log(`  賣貨便 1.xlsx : raw=${sb1.raw}  orders=${sb1.orders.length}`);
console.log(`  賣貨便 2.xlsx : raw=${sb2.raw}  orders=${sb2.orders.length}`);
console.log(`  面交         : raw=${ip.raw}  orders=${ip.orders.length}`);
console.log(`  KOL          : raw=${kol.raw}  orders=${kol.orders.length}`);
console.log();
console.log(`  合計 raw=${rawSum}  orders=${allOrders.length}`);
console.log(`  [憲章防護 #1 守恆律] ${rawSum === allOrders.length ? "✅" : "🚨"}\n`);

// 按 status
const byStatus = {};
for (const o of allOrders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
console.log("  訂單狀態分佈：");
for (const [s, n] of Object.entries(byStatus).sort()) {
  console.log(`    ${s.padEnd(25)}: ${n}`);
}
console.log();

// 按通路
const byChannel = {};
for (const o of allOrders.filter(o => o.status === "confirmed")) byChannel[o.channel] = (byChannel[o.channel] ?? 0) + 1;
console.log("  ✅ confirmed 訂單各通路分佈：");
for (const [ch, n] of Object.entries(byChannel).sort()) {
  console.log(`    ${ch.padEnd(20)}: ${n}`);
}
console.log();

// 按出爐日
const byDate = {};
for (const o of allOrders.filter(o => o.status === "confirmed")) {
  if (o.batchDate) byDate[o.batchDate] = (byDate[o.batchDate] ?? 0) + 1;
}
console.log("  📅 出爐日分佈（confirmed）：");
for (const [d, n] of Object.entries(byDate).sort()) {
  console.log(`    ${d}: ${n}`);
}
console.log();

// 對比雇主參考檔案的統計數字
console.log("═══════════════════════════════════════════");
console.log("  vs. 雇主現有出爐統計對照 (＠ 參考 目前ai提供內容)");
console.log("═══════════════════════════════════════════");
console.log("  雇主檔案的 7/07 資料：120 顆肉桂捲（賣貨便）+ KOL 4 個 + 15 顆蘋果肉桂捲 + ...");
console.log("  我們的 7/07 confirmed:", byDate["2026-07-07"] ?? 0, "筆訂單");
console.log("  雇主檔案的 7/14 資料：15 顆肉桂捲（賣貨便）+ KOL 18");
console.log("  我們的 7/14 confirmed:", byDate["2026-07-14"] ?? 0, "筆訂單");
console.log();
console.log("  ⚠️ 「筆數 ≠ 顆數」——這是 order-level 對照，atom-level 統計 M4 產出 Excel 時實作");
