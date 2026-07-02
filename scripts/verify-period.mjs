/**
 * period.ts filterByPeriod + periodBounds + summarizeByPeriod 驗證
 */

// vanilla 實作
function pad(n) { return String(n).padStart(2, "0"); }
function lastDay(y, m) { return pad(new Date(y, m, 0).getDate()); }
function periodBounds(p) {
  if (p.type === "all") return null;
  const y = p.year;
  if (p.type === "year") return { start: `${y}-01-01`, end: `${y}-12-31` };
  if (p.type === "quarter") {
    const sm = (p.quarter - 1) * 3 + 1, em = sm + 2;
    return { start: `${y}-${pad(sm)}-01`, end: `${y}-${pad(em)}-${lastDay(y, em)}` };
  }
  return { start: `${y}-${pad(p.month)}-01`, end: `${y}-${pad(p.month)}-${lastDay(y, p.month)}` };
}
function filterByPeriod(orders, period) {
  const b = periodBounds(period);
  if (!b) return orders.filter((o) => !!o.batchDate);
  return orders.filter((o) => o.batchDate && o.batchDate >= b.start && o.batchDate <= b.end);
}
function periodLabel(p) {
  if (p.type === "all") return "all";
  if (p.type === "year") return String(p.year);
  if (p.type === "quarter") return `${p.year}-Q${p.quarter}`;
  return `${p.year}-${pad(p.month)}`;
}

const mk = (id, date) => ({ id, batchDate: date, status: "confirmed", revenue: { grossTotal: 100 }, labelCount: 1, channel: "賣貨便" });

console.log("═══════════════════════════════════════════");
console.log("  期間篩選驗證");
console.log("═══════════════════════════════════════════\n");

const orders = [
  mk("A", "2026-06-15"),
  mk("B", "2026-07-07"),
  mk("C", "2026-07-14"),
  mk("D", "2026-08-05"),
  mk("E", "2026-11-20"),
  mk("F", "2027-01-10"),
  mk("G", null), // 無 batchDate
];

// Case 1: 全部
{
  const r = filterByPeriod(orders, { type: "all" });
  console.log(`Case 1 all: ${r.length} 筆（應 6、排除 null batchDate）`);
  assert(r.length === 6, "all 應排除 null batchDate");
}

// Case 2: 2026-07 月
{
  const r = filterByPeriod(orders, { type: "month", year: 2026, month: 7 });
  console.log(`Case 2 2026-07: ${r.length} 筆（應 2: B C）`);
  assert(r.length === 2 && r.every((o) => o.id === "B" || o.id === "C"), "應只 B C");
}

// Case 3: 2026-Q3
{
  const r = filterByPeriod(orders, { type: "quarter", year: 2026, quarter: 3 });
  console.log(`Case 3 2026-Q3: ${r.length} 筆（應 3: B C D）`);
  assert(r.length === 3, "Q3 應 3 筆");
}

// Case 4: 2026 年
{
  const r = filterByPeriod(orders, { type: "year", year: 2026 });
  console.log(`Case 4 2026: ${r.length} 筆（應 5: A B C D E）`);
  assert(r.length === 5, "2026 年應 5 筆");
}

// Case 5: 2027 年
{
  const r = filterByPeriod(orders, { type: "year", year: 2027 });
  console.log(`Case 5 2027: ${r.length} 筆（應 1: F）`);
  assert(r.length === 1 && r[0].id === "F", "2027 應只 F");
}

// Case 6: 檔名 label
console.log("\nCase 6 filenames:");
console.log(`  all       → ${periodLabel({ type: "all" })}`);
console.log(`  2026 年   → ${periodLabel({ type: "year", year: 2026 })}`);
console.log(`  2026 Q3   → ${periodLabel({ type: "quarter", year: 2026, quarter: 3 })}`);
console.log(`  2026 7 月 → ${periodLabel({ type: "month", year: 2026, month: 7 })}`);
assert(periodLabel({ type: "month", year: 2026, month: 7 }) === "2026-07", "月標籤格式");
assert(periodLabel({ type: "quarter", year: 2026, quarter: 3 }) === "2026-Q3", "季標籤格式");

console.log("\n═══════════════════════════════════════════");
console.log("  期間篩選 6 cases 全通過 ✅");
console.log("═══════════════════════════════════════════");

function assert(cond, msg) {
  if (!cond) { console.error(`  🚨 ${msg}`); process.exit(1); }
}
