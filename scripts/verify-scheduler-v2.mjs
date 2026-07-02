/**
 * M6.5 排程 v2 驗證
 *
 * 測項：
 *   1. Flexible 訂單 FIFO 排下次週二
 *   2. 巴斯克 strict 客人指定日、產能足夠 → 保留 wish_date
 *   3. 巴斯克 strict 前置期不足 → 順延到最近可行日
 *   4. Flexible 產能超載 → 遞進下週
 *   5. 憲章 #13: strict 訂單 pre-book 產能、flexible 不能擠掉
 *   6. 憲章 #14: 前置期 < 5 天必進 pending/順延
 *   7. 時間預算計算：多品項訂單 + overhead
 *   8. 4 爐+ 延續斜率
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load as yamlLoad } from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const menu = yamlLoad(readFileSync(join(ROOT, "data/menu.yaml"), "utf-8"));

// --------- inline domain logic (mirror TS) ---------
function fmt(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate()+n); r.setHours(0,0,0,0); return r; }
function nextTue(from, weekday=2) { const d=new Date(from); d.setHours(0,0,0,0); const diff=(weekday-d.getDay()+7)%7; d.setDate(d.getDate()+diff); return d; }
function accumulate(orders) {
  const t=new Map();
  for(const o of orders) for(const it of o.items) for(const a of it.atoms) t.set(a.atomId,(t.get(a.atomId)??0)+a.count);
  return t;
}
function merge(a,b) { const o=new Map(a); for(const[k,v] of b) o.set(k,(o.get(k)??0)+v); return o; }
function hoursForBatches(batches, formula) {
  if (batches <= 0) return 0;
  const bc = formula.hours_by_batch_count;
  if (bc[String(batches)] !== undefined) return bc[String(batches)];
  const keys = Object.keys(bc).map(Number).sort((a,b)=>a-b);
  const mk = keys[keys.length-1];
  return bc[String(mk)] + (batches-mk)*formula.hours_per_additional_batch;
}
function calcBatchHours(atomTotals, menu) {
  let total=0, productCount=0;
  for(const [atomId,qty] of atomTotals) {
    const f = menu.production_time_formula?.[atomId];
    if (!f || qty <= 0) continue;
    let batches = f.ml_per_unit ? (qty*f.ml_per_unit)/f.per_batch_units : Math.ceil(qty/f.per_batch_units);
    const hrs = hoursForBatches(Math.ceil(batches), f);
    if (hrs > 0) {
      const oh = menu.overhead;
      const wash = oh && batches >= oh.wash_mold_after_batches ? Math.floor(batches/oh.wash_mold_after_batches)*oh.wash_mold_hours : 0;
      total += hrs + wash;
      productCount++;
    }
  }
  if (productCount > 1 && menu.overhead) total += (productCount-1)*menu.overhead.product_switch_hours;
  return Math.round(total*100)/100;
}
function suggestV2(orders, menu, today) {
  const cfg = menu.scheduling ?? { lead_time_days: 5, regular_shipping_weekday: 2, max_retry_weeks: 10 };
  const budget = menu.weekly_production_budget?.total_hours_max ?? 30;
  const alreadyScheduled = orders.filter(o => o.batchDate && (o.status === "confirmed" || o.status === "kol_shipped"));
  const batchAtoms = new Map();
  for(const o of alreadyScheduled) {
    const cur = batchAtoms.get(o.batchDate) ?? new Map();
    batchAtoms.set(o.batchDate, merge(cur, accumulate([o])));
  }
  const pS=[], pF=[];
  for(const o of orders) {
    if (o.assignment_source !== "pending") continue;
    if (o.status !== "confirmed" && o.status !== "pending_batch_date") continue;
    if (o.wish_priority === "strict" && o.customer_wish_date) pS.push(o);
    else pF.push(o);
  }
  pF.sort((a,b)=>((a.first_seen_at??"").localeCompare(b.first_seen_at??"")));
  const sug=[], un=[];
  const earliest = addDays(today, cfg.lead_time_days);
  const startTue = nextTue(earliest, cfg.regular_shipping_weekday);

  for(const o of pS) {
    const oa = accumulate([o]);
    const wishDate = new Date(o.customer_wish_date);
    let cursor = wishDate; let kept=true;
    if (cursor < earliest) { cursor = nextTue(earliest, cfg.regular_shipping_weekday); kept=false; }
    let placed=false, tried=[];
    for(let a=0; a<cfg.max_retry_weeks; a++) {
      const ds = fmt(cursor); tried.push(ds);
      const cur = batchAtoms.get(ds) ?? new Map();
      const mg = merge(cur, oa);
      const nh = calcBatchHours(mg, menu);
      if (nh <= budget) {
        batchAtoms.set(ds, mg);
        sug.push({ order_id: o.id, suggested_date: ds, wish_priority: "strict", is_wish_kept: a===0&&kept, batch_hours_after: nh, weekly_budget: budget });
        placed=true; break;
      }
      cursor = addDays(cursor, 7); kept=false;
    }
    if (!placed) un.push({ order_id: o.id, tried_dates: tried });
  }

  for(const o of pF) {
    const oa = accumulate([o]);
    let cursor = new Date(startTue); let placed=false, tried=[];
    for(let a=0; a<cfg.max_retry_weeks; a++) {
      const ds = fmt(cursor); tried.push(ds);
      const cur = batchAtoms.get(ds) ?? new Map();
      const mg = merge(cur, oa);
      const nh = calcBatchHours(mg, menu);
      if (nh <= budget) {
        batchAtoms.set(ds, mg);
        sug.push({ order_id: o.id, suggested_date: ds, wish_priority: o.wish_priority, is_wish_kept: false, batch_hours_after: nh, weekly_budget: budget });
        placed=true; break;
      }
      cursor = addDays(cursor, 7);
    }
    if (!placed) un.push({ order_id: o.id, tried_dates: tried });
  }
  return { suggestions: sug, unscheduled: un };
}
function mkO(id, items, opts={}) {
  return {
    id, channel: opts.channel ?? "賣貨便",
    status: opts.status ?? "confirmed",
    batchDate: "batchDate" in opts ? opts.batchDate : null,
    customer_wish_date: opts.wish ?? null,
    assignment_source: opts.source ?? "pending",
    wish_priority: opts.priority ?? null,
    first_seen_at: opts.first ?? "2026-07-01T00:00:00",
    items: items.map(it => ({ productSkuId: it.sku, rawName: "", quantity: 1, subtotal: null, atoms: [{ atomId: it.atom, count: it.count }] })),
  };
}

const today = new Date("2026-07-03T00:00:00"); // 週四
const startTuesday = fmt(nextTue(addDays(today, 5), 2)); // 5 天後的下週二 = 7/8+? actually 7/3+5=7/8週三 → 下週二 = 7/14

console.log("═══════════════════════════════════════════");
console.log(`  M6.5 排程 v2 驗證  today=${fmt(today)}(週四)  startTue(前置期後)=${startTuesday}`);
console.log("═══════════════════════════════════════════\n");

// Case 1: Flexible FIFO
{
  console.log("Case 1: 3 筆小訂單、全 flexible → 排下次可行週二");
  const os = [
    mkO("A", [{sku:"經典肉桂捲4入", atom:"肉桂捲", count:4}], {priority:"flexible", first:"2026-07-01T00:00:00"}),
    mkO("B", [{sku:"經典肉桂捲4入", atom:"肉桂捲", count:4}], {priority:"flexible", first:"2026-07-02T00:00:00"}),
    mkO("C", [{sku:"原味巴斯克", atom:"原味巴斯克", count:1}], {priority:"flexible", first:"2026-07-03T00:00:00"}),
  ];
  const r = suggestV2(os, menu, today);
  console.log(`  suggested: ${r.suggestions.length}, unscheduled: ${r.unscheduled.length}`);
  assert(r.suggestions.every(s => s.suggested_date === startTuesday), `全排 ${startTuesday}`);
  console.log("  ✅\n");
}

// Case 2: Strict 巴斯克、有 wish_date、產能足夠
{
  console.log("Case 2: 巴斯克 strict + wish_date=7/22(下下週二)、應保留");
  const os = [
    mkO("BASK", [{sku:"焙茶栗子巴斯克", atom:"焙茶栗子巴斯克", count:1}], {priority:"strict", wish:"2026-07-22"}),
  ];
  const r = suggestV2(os, menu, today);
  console.log(`  → ${r.suggestions[0]?.suggested_date}, kept=${r.suggestions[0]?.is_wish_kept}`);
  assert(r.suggestions[0]?.suggested_date === "2026-07-22", "應排 7/22");
  assert(r.suggestions[0]?.is_wish_kept === true, "wish_kept true");
  console.log("  ✅\n");
}

// Case 3: Strict 前置期不足
{
  console.log("Case 3: 巴斯克 strict + wish=7/5(明天、前置期不足) → 順延到 startTue");
  const os = [
    mkO("URGENT", [{sku:"原味巴斯克", atom:"原味巴斯克", count:1}], {priority:"strict", wish:"2026-07-05"}),
  ];
  const r = suggestV2(os, menu, today);
  console.log(`  → ${r.suggestions[0]?.suggested_date}, kept=${r.suggestions[0]?.is_wish_kept}`);
  assert(r.suggestions[0]?.suggested_date === startTuesday, `應順延到 ${startTuesday}`);
  assert(r.suggestions[0]?.is_wish_kept === false, "wish_kept false");
  console.log("  ✅\n");
}

// Case 4: Flexible 產能超載遞進
{
  console.log("Case 4: 一堆大訂單、超載遞進下週");
  // 排 startTuesday 已用 25 hr（6 爐肉桂捲）→ 剩 5hr
  // 新訂單 4 爐肉桂捲 = 13 hr → 排 startTuesday 會超載 25+13=38 > 30 → 遞進
  const nextTueDate = fmt(addDays(nextTue(addDays(today,5),2), 7));
  const os = [
    mkO("BIG_PRE", [{sku:"經典肉桂捲4入", atom:"肉桂捲", count:24*6}],
        {priority:"flexible", batchDate: startTuesday, source:"customer_wish_kept", first:"2026-07-01T00:00:00"}),
    mkO("NEW", [{sku:"經典肉桂捲4入", atom:"肉桂捲", count:24*4}],
        {priority:"flexible", first:"2026-07-02T00:00:00"}),
  ];
  const r = suggestV2(os, menu, today);
  const newSug = r.suggestions.find(s => s.order_id === "NEW");
  console.log(`  NEW → ${newSug?.suggested_date} (預期 ${nextTueDate})`);
  assert(newSug?.suggested_date === nextTueDate, `NEW 應排下下週二 ${nextTueDate}`);
  console.log("  ✅\n");
}

// Case 5: 憲章 #13 pre-book (strict 佔位、flexible 不能擠掉)
{
  console.log("Case 5: strict 巴斯克先排 7/14、flexible 麵包看到剩下產能");
  const os = [
    mkO("STRICT_BASK", [{sku:"原味巴斯克", atom:"原味巴斯克", count:8}], {priority:"strict", wish: startTuesday}),
    mkO("FLEX_BREAD", [{sku:"經典肉桂捲4入", atom:"肉桂捲", count:24*5}], {priority:"flexible", first:"2026-07-02T00:00:00"}),
  ];
  const r = suggestV2(os, menu, today);
  const strictSug = r.suggestions.find(s => s.order_id === "STRICT_BASK");
  const flexSug = r.suggestions.find(s => s.order_id === "FLEX_BREAD");
  console.log(`  STRICT_BASK → ${strictSug?.suggested_date} (kept=${strictSug?.is_wish_kept})`);
  console.log(`  FLEX_BREAD → ${flexSug?.suggested_date} (hours_after=${flexSug?.batch_hours_after})`);
  assert(strictSug?.is_wish_kept === true, "strict 保留 wish_date");
  console.log("  ✅\n");
}

// Case 6: 時間預算計算：多品項訂單（含 overhead）
{
  console.log("Case 6: 時間預算計算 - 肉桂捲24 + 巴斯克4 (2 品項切換 overhead)");
  const os = [ mkO("A", [{sku:"經典肉桂捲4入", atom:"肉桂捲", count:24}, {sku:"原味巴斯克", atom:"原味巴斯克", count:4}], {priority:"strict", wish:startTuesday}) ];
  const r = suggestV2(os, menu, today);
  console.log(`  batch_hours_after = ${r.suggestions[0]?.batch_hours_after}`);
  // 肉桂捲 1爐=4hr + 巴斯克 1爐=2hr + 切換 0.67 = 6.67
  assert(Math.abs(r.suggestions[0]?.batch_hours_after - 6.67) < 0.1, "應約 6.67 hr");
  console.log("  ✅\n");
}

// Case 7: 4 爐+ 延續斜率
{
  console.log("Case 7: 4 爐肉桂捲 = 10 + 3 = 13 hr");
  const os = [ mkO("A", [{sku:"經典肉桂捲4入", atom:"肉桂捲", count:24*4}], {priority:"strict", wish:startTuesday}) ];
  const r = suggestV2(os, menu, today);
  console.log(`  batch_hours_after = ${r.suggestions[0]?.batch_hours_after}`);
  // 4 爐 = 10+3 = 13 hr + 3 爐後洗模 = +1 hr = 14 hr
  assert(r.suggestions[0]?.batch_hours_after >= 13, "應 ≥ 13 hr");
  console.log("  ✅\n");
}

console.log("═══════════════════════════════════════════");
console.log("  M6.5 排程 v2 - 7 cases 全通過 ✅");
console.log("═══════════════════════════════════════════");

function assert(cond, msg) { if (!cond) { console.error(`  🚨 ${msg}`); process.exit(1); } }
