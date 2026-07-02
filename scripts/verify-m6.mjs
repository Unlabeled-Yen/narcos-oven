/**
 * M6 排程系統驗證：Stage 8 + 9 + 10 + 11
 *
 * Cases:
 *   1. 純規則排程：無雇主指定、系統排下週二
 *   2. 產能超載：巨量訂單觸發下週轉移
 *   3. BOM 計算：atom_fallback（雇主未提供 recipe）
 *   4. 製作時程回推：lead_time_days 對映
 *   5. 憲章 #12：連續 10 週超載 → unscheduled
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load as yamlLoad } from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const menu = yamlLoad(readFileSync(join(ROOT, "data/menu.yaml"), "utf-8"));

// 內嵌純函式（來自 scheduler.ts / bom.ts / production-timeline.ts）
function fmt(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function nextTuesday(from) {
  const d = new Date(from); d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const add = ((2 - dow + 7) % 7) || 7;
  d.setDate(d.getDate() + add);
  return d;
}
const weekdayKey = (d) => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];

function suggestSchedule(orders, menu, today) {
  const capacity = menu.production_capacity?.daily_max_by_atom ?? {};
  const weekly = menu.production_capacity?.weekly_pattern;
  const scheduledByDateAtom = new Map();
  for (const o of orders) {
    if (!o.batchDate) continue;
    if (o.status !== "confirmed") continue;
    if (!scheduledByDateAtom.has(o.batchDate)) scheduledByDateAtom.set(o.batchDate, new Map());
    for (const it of o.items) for (const a of it.atoms) {
      const m = scheduledByDateAtom.get(o.batchDate);
      m.set(a.atomId, (m.get(a.atomId) ?? 0) + a.count);
    }
  }
  const pending = orders.filter((o) => o.assignment_source === "pending" && (o.status === "confirmed" || o.status === "pending_batch_date"));
  const suggestions = [];
  const unscheduled = [];
  for (const o of pending) {
    const orderAtoms = new Map();
    for (const it of o.items) for (const a of it.atoms) {
      orderAtoms.set(a.atomId, (orderAtoms.get(a.atomId) ?? 0) + a.count);
    }
    let cursor = nextTuesday(today);
    let placed = false;
    const tried = [];
    for (let week = 0; week < 10; week++) {
      const dateStr = fmt(cursor);
      tried.push(dateStr);
      const scheduled = scheduledByDateAtom.get(dateStr) ?? new Map();
      const overloads = [];
      const wm = weekly ? (weekly[weekdayKey(cursor)] ?? 1) : 1;
      for (const [atomId, would] of orderAtoms) {
        const capA = (capacity[atomId] ?? Infinity) * wm;
        const already = scheduled.get(atomId) ?? 0;
        if (already + would > capA) overloads.push({ atomId, would_add: would, already, capacity: capA });
      }
      if (overloads.length === 0) {
        if (!scheduledByDateAtom.has(dateStr)) scheduledByDateAtom.set(dateStr, new Map());
        const m = scheduledByDateAtom.get(dateStr);
        for (const [atomId, n] of orderAtoms) m.set(atomId, (m.get(atomId) ?? 0) + n);
        suggestions.push({ order_id: o.id, suggested_date: dateStr, week });
        placed = true;
        break;
      }
      cursor = addDays(cursor, 7);
    }
    if (!placed) unscheduled.push({ order_id: o.id, tried });
  }
  return { suggestions, unscheduled };
}

function calculateBOM(batchDate, orders, menu) {
  const batchOrders = orders.filter((o) => o.batchDate === batchDate && o.status === "confirmed");
  const atomTotals = new Map();
  for (const o of batchOrders) for (const it of o.items) for (const a of it.atoms) {
    atomTotals.set(a.atomId, (atomTotals.get(a.atomId) ?? 0) + a.count);
  }
  const lines = [];
  for (const [atomId, qty] of atomTotals) {
    const unit = menu.atoms[atomId]?.unit ?? "";
    lines.push({ material: atomId, quantity: qty, unit, source: "atom_fallback" });
  }
  lines.sort((a, b) => b.quantity - a.quantity);
  return { batch_date: batchDate, order_count: batchOrders.length, lines };
}

function productionTimeline(batchDate, orders, menu) {
  const leadTimes = menu.product_lead_time ?? {};
  const atomTotals = new Map();
  for (const o of orders) {
    if (o.batchDate !== batchDate || o.status !== "confirmed") continue;
    for (const it of o.items) for (const a of it.atoms) {
      atomTotals.set(a.atomId, (atomTotals.get(a.atomId) ?? 0) + a.count);
    }
  }
  const batch = new Date(batchDate + "T00:00:00");
  const steps = [];
  for (const [atomId, qty] of atomTotals) {
    const lead = leadTimes[atomId] ?? 1;
    const start = new Date(batch); start.setDate(start.getDate() - lead);
    steps.push({ date: fmt(start), action: `開始製作 ${atomId} (提前 ${lead} 天)`, atomId, quantity: qty });
    steps.push({ date: batchDate, action: `出貨 ${atomId}`, atomId, quantity: qty });
  }
  steps.sort((a, b) => a.date === b.date ? a.atomId.localeCompare(b.atomId) : a.date.localeCompare(b.date));
  return { batch_date: batchDate, steps };
}

// ============================================================
// helpers to build test orders
// ============================================================
function makeOrder(id, atoms, opts = {}) {
  return {
    id,
    channel: opts.channel ?? "賣貨便",
    status: opts.status ?? "confirmed",
    batchDate: opts.batchDate ?? null,
    assignment_source: opts.source ?? "pending",
    items: [{ productSkuId: "test", rawName: "test", quantity: 1, subtotal: null, atoms: atoms.map(([a, n]) => ({ atomId: a, count: n })) }],
    recipient: { name: id, igOrLine: null, phone: null, address: null, convStore: null },
    revenue: { grossTotal: 0, freight: 0, discount: 0 },
    labelCount: 1,
    pendingReasons: [], rawSource: { file: "", sheet: "", rowIndex: 0, rawStatus: "" },
    snapshot: {}, first_seen_at: "", last_seen_at: "", disappeared_at: null, disappeared_resolution: null, frozen_after_label_print: false, changes: [],
    customer_wish_date: null, system_suggested_date: null,
  };
}

const today = new Date("2026-07-15T00:00:00"); // 週三

// ============================================================
// Case 1: 純規則排程（3 筆小訂單）
// ============================================================
console.log("═══════════════════════════════════════════");
console.log("  Case 1: 純規則排程 3 筆小訂單");
console.log("═══════════════════════════════════════════");
{
  const orders = [
    makeOrder("A1", [["肉桂捲", 4]]),
    makeOrder("A2", [["蘋果肉桂捲", 4]]),
    makeOrder("A3", [["原味巴斯克", 1]]),
  ];
  const r = suggestSchedule(orders, menu, today);
  console.log(`  suggested: ${r.suggestions.length}, unscheduled: ${r.unscheduled.length}`);
  const nextTue = fmt(nextTuesday(today));
  assert(r.suggestions.every((s) => s.suggested_date === nextTue), `全部應排到 ${nextTue}`);
  console.log(`  ✅ 全排到 ${nextTue} (下次週二)\n`);
}

// ============================================================
// Case 2: 產能超載遞進（250 顆肉桂捲、超過 200/天）
// ============================================================
console.log("═══════════════════════════════════════════");
console.log("  Case 2: 產能超載 → 遞進到下週");
console.log("═══════════════════════════════════════════");
{
  // 一筆 250 顆肉桂捲、超過 200/天 → 應該直接掛「unscheduled」（因為無論排哪週都超過單天上限）
  const orders = [makeOrder("BIG", [["肉桂捲", 250]])];
  const r = suggestSchedule(orders, menu, today);
  console.log(`  suggested: ${r.suggestions.length}, unscheduled: ${r.unscheduled.length}`);
  assert(r.unscheduled.length === 1, "250 顆超單天上限 200 → 憲章 #12 unscheduled");
  console.log(`  ✅ 憲章 #12 生效：250 顆連續 10 週都超載、進 unscheduled\n`);
}

// ============================================================
// Case 3: 遞進到下週的邊界（198 + 5 = 203 > 200）
// ============================================================
console.log("═══════════════════════════════════════════");
console.log("  Case 3: 邊界產能觸發遞進下週");
console.log("═══════════════════════════════════════════");
{
  const nextTue = fmt(nextTuesday(today));
  const nextNextTue = fmt(addDays(nextTuesday(today), 7));
  const orders = [
    // 已排 198 顆到 nextTue
    makeOrder("EXISTING", [["肉桂捲", 198]], { batchDate: nextTue, source: "customer_wish_kept" }),
    // 新的 5 顆 → 198+5=203 > 200 → 應該遞進到 nextNextTue
    makeOrder("NEW", [["肉桂捲", 5]]),
  ];
  const r = suggestSchedule(orders, menu, today);
  console.log(`  NEW 訂單被排到: ${r.suggestions[0]?.suggested_date}`);
  assert(r.suggestions[0]?.suggested_date === nextNextTue, `應該遞進到 ${nextNextTue}`);
  console.log(`  ✅ 產能超載遞進正確\n`);
}

// ============================================================
// Case 4: BOM 計算（atom fallback）
// ============================================================
console.log("═══════════════════════════════════════════");
console.log("  Case 4: BOM 計算 (atom_fallback、雇主未提供 recipe)");
console.log("═══════════════════════════════════════════");
{
  const orders = [
    makeOrder("A1", [["肉桂捲", 4], ["香料堅果醬90ml", 1]], { batchDate: "2026-07-21" }),
    makeOrder("A2", [["肉桂捲", 5], ["蘋果肉桂捲", 2]], { batchDate: "2026-07-21" }),
    makeOrder("A3", [["原味巴斯克", 1]], { batchDate: "2026-07-21" }),
  ];
  const bom = calculateBOM("2026-07-21", orders, menu);
  console.log(`  批次日: ${bom.batch_date}, 訂單: ${bom.order_count}, 原料行: ${bom.lines.length}`);
  for (const l of bom.lines) console.log(`    ${l.material}: ${l.quantity} ${l.unit}`);
  const cinnamon = bom.lines.find((l) => l.material === "肉桂捲");
  assert(cinnamon?.quantity === 9, "肉桂捲應 9 顆 (4+5)");
  console.log(`  ✅ BOM atom 累積正確\n`);
}

// ============================================================
// Case 5: 製作時程回推
// ============================================================
console.log("═══════════════════════════════════════════");
console.log("  Case 5: 製作時程回推");
console.log("═══════════════════════════════════════════");
{
  const orders = [makeOrder("A", [["肉桂捲", 4], ["原味巴斯克", 1]], { batchDate: "2026-07-21" })];
  const tl = productionTimeline("2026-07-21", orders, menu);
  console.log(`  批次日 2026-07-21`);
  for (const s of tl.steps) console.log(`    ${s.date}  ${s.action}  ×${s.quantity}`);
  // 肉桂捲 lead=2 → 2026-07-19 開始
  // 原味巴斯克 lead=1 → 2026-07-20 開始
  // 出貨日 → 2026-07-21
  const dates = [...new Set(tl.steps.map((s) => s.date))].sort();
  assert(dates.includes("2026-07-19") && dates.includes("2026-07-20") && dates.includes("2026-07-21"), "應含 07-19 / 20 / 21");
  console.log(`  ✅ 時程回推正確\n`);
}

console.log("═══════════════════════════════════════════");
console.log("  M6 排程系統 5 cases 全通過 ✅");
console.log("═══════════════════════════════════════════");

function assert(cond, msg) {
  if (!cond) {
    console.error(`  🚨 ASSERT FAIL: ${msg}`);
    process.exit(1);
  }
}
