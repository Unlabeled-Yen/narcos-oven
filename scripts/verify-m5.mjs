/**
 * M5 標籤資料驗證：
 * extractLabels() 純函式測試
 *
 * PDF 渲染部分需 browser canvas、Node 端不測；只測資料抽取邏輯。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load as yamlLoad } from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const menu = yamlLoad(readFileSync(join(ROOT, "data/menu.yaml"), "utf-8"));

// vanilla 版 extractLabels (copy from src/output/label-data.ts)
function extractLabels(orders, menu, filter) {
  const shorts = menu.label_short_forms ?? {};
  const labels = [];
  const targets = orders.filter((o) => {
    if (o.status !== "confirmed" && o.status !== "kol_shipped") return false;
    if (!o.batchDate) return false;
    if (filter?.batchDate && o.batchDate !== filter.batchDate) return false;
    if (filter?.channel && o.channel !== filter.channel) return false;
    return true;
  });
  for (const o of targets) {
    const rows = [];
    for (const it of o.items) {
      for (let i = 0; i < it.quantity; i++) {
        rows.push({ sku_id: it.productSkuId ?? "", raw_name: it.rawName });
      }
    }
    let warning;
    if (o.channel === "賣貨便" && o.labelCount !== rows.length) {
      warning = `c22=${o.labelCount} 但實際品項=${rows.length}`;
    }
    const total = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const shortLabel = shorts[row.sku_id] ?? row.raw_name.slice(0, 20);
      const subNumber = total > 1 ? `${total}-${i + 1}` : "";
      labels.push(buildLabel(o, subNumber, shortLabel, i + 1, total, warning));
    }
  }
  return labels;
}
function buildLabel(o, subNumber, shortLabel, index, total, warning) {
  const midLine = subNumber ? `${subNumber}  ${shortLabel.replace("\n", "  ")}` : shortLabel.replace("\n", "  ");
  if (o.channel === "賣貨便") {
    return { order_id: o.id, batch_date: o.batchDate, kind: "賣貨便",
      top_line: o.id.startsWith("CM") ? o.id.slice(-5) : o.id,
      mid_line: midLine, bottom_line: o.recipient?.convStore ?? "",
      sub_number: subNumber, index, total, warning };
  }
  if (o.channel.startsWith("面交") || o.channel === "宅配") {
    const label = o.channel === "宅配" ? "宅配"
      : o.channel === "面交_中壢" ? "中壢面交"
      : o.channel === "面交_台中" ? "台中面交"
      : "面交";
    return { order_id: o.id, batch_date: o.batchDate,
      kind: o.channel === "宅配" ? "宅配" : "面交",
      top_line: label, mid_line: midLine,
      bottom_line: o.recipient?.igOrLine ?? o.recipient?.name ?? "",
      sub_number: subNumber, index, total, warning };
  }
  if (o.channel === "KOL") {
    return { order_id: o.id, batch_date: o.batchDate, kind: "KOL",
      top_line: "KOL",
      mid_line: o.recipient?.igOrLine ? `@${o.recipient.igOrLine.replace(/^@/, "")}` : "",
      bottom_line: midLine,
      sub_number: subNumber, index, total, warning };
  }
  return { order_id: o.id, batch_date: o.batchDate, kind: "待分類",
    top_line: "待分類", mid_line: midLine, bottom_line: o.recipient?.name ?? "",
    sub_number: subNumber, index, total, warning };
}

// ============================================================
// helpers
// ============================================================
function mkOrder(id, channel, items, opts = {}) {
  return {
    id,
    channel,
    status: opts.status ?? "confirmed",
    batchDate: "batchDate" in opts ? opts.batchDate : "2026-07-14",  // 允許顯式 null
    recipient: opts.recipient ?? { name: id, igOrLine: null, phone: null, address: null, convStore: null },
    items: items.map((it) => ({ productSkuId: it.sku, rawName: it.name ?? "", quantity: it.qty, subtotal: null, atoms: [] })),
    revenue: { grossTotal: 0, freight: 0, discount: 0 },
    labelCount: opts.labelCount ?? items.reduce((s, it) => s + it.qty, 0),
  };
}

// ============================================================
// Cases
// ============================================================
console.log("═══════════════════════════════════════════");
console.log("  M5 標籤資料驗證");
console.log("═══════════════════════════════════════════\n");

// Case 1: 單品項訂單、single label、無分盒編號
console.log("Case 1: 賣貨便單品項 → 1 張標籤、無分盒編號");
{
  const orders = [
    mkOrder("CM2606159724469", "賣貨便", [
      { sku: "經典肉桂捲4入", qty: 1 },
    ], { recipient: { name: "趙*婷", convStore: "泰山門市", igOrLine: null, phone: null, address: null } }),
  ];
  const labels = extractLabels(orders, menu);
  console.log(`  labels: ${labels.length}`);
  for (const l of labels) {
    console.log(`    [${l.kind}] top=${l.top_line}  mid=${l.mid_line}  bottom=${l.bottom_line}`);
  }
  assert(labels.length === 1, "應 1 張標籤");
  assert(labels[0].sub_number === "", "單品項無分盒編號");
  assert(labels[0].top_line === "24469", "後 5 碼 24469");
  assert(labels[0].mid_line === "方型  四顆肉桂捲", "SKU short_label 應該印方型/四顆肉桂捲");
  console.log("  ✅\n");
}

// Case 2: 多品項訂單（賣貨便）
console.log("Case 2: 賣貨便雙品項 → 2 張標籤、2-1 / 2-2 分盒");
{
  const orders = [
    mkOrder("CM2606169933209", "賣貨便", [
      { sku: "焙茶栗子巴斯克", qty: 1 },
      { sku: "白玉烏龍茶巴斯克", qty: 1 },
    ], { recipient: { name: "鄭*攸", convStore: "欽天門市", igOrLine: null, phone: null, address: null }, labelCount: 2 }),
  ];
  const labels = extractLabels(orders, menu);
  console.log(`  labels: ${labels.length}`);
  for (const l of labels) {
    console.log(`    [${l.kind}] top=${l.top_line}  mid=${l.mid_line}  bottom=${l.bottom_line}`);
  }
  assert(labels.length === 2, "應 2 張標籤");
  assert(labels[0].sub_number === "2-1" && labels[1].sub_number === "2-2", "應分盒 2-1 / 2-2");
  console.log("  ✅\n");
}

// Case 3: 面交
console.log("Case 3: 中壢面交、單品項");
{
  const orders = [
    mkOrder("IP-面交.xlsx-r10", "面交_中壢", [
      { sku: "經典肉桂捲4入", qty: 1 },
    ], { recipient: { name: "陳*", igOrLine: "yancyi366", convStore: null, phone: null, address: null } }),
  ];
  const labels = extractLabels(orders, menu);
  for (const l of labels) console.log(`    [${l.kind}] top=${l.top_line}  mid=${l.mid_line}  bottom=${l.bottom_line}`);
  assert(labels[0].top_line === "中壢面交", "top 應為 中壢面交");
  assert(labels[0].bottom_line === "yancyi366", "bottom 應為 IG");
  console.log("  ✅\n");
}

// Case 4: KOL
console.log("Case 4: KOL、2 品項");
{
  const orders = [
    mkOrder("KOL-cara", "KOL", [
      { sku: "經典肉桂捲4入", qty: 1 },
      { sku: "香料堅果醬90ml", qty: 1 },
    ], { recipient: { name: "田亞于", igOrLine: "cara__tian", convStore: null, phone: null, address: null } }),
  ];
  const labels = extractLabels(orders, menu);
  console.log(`  labels: ${labels.length}`);
  for (const l of labels) console.log(`    [${l.kind}] top=${l.top_line}  mid=${l.mid_line}  bottom=${l.bottom_line}`);
  assert(labels.every((l) => l.top_line === "KOL"), "top 應為 KOL");
  assert(labels[0].mid_line === "@cara__tian", "mid 應為 @IG");
  assert(labels[0].bottom_line.includes("2-1") && labels[1].bottom_line.includes("2-2"), "bottom 應含分盒編號");
  console.log("  ✅\n");
}

// Case 5: filter by batchDate
console.log("Case 5: filter by batchDate");
{
  const orders = [
    mkOrder("A", "賣貨便", [{ sku: "經典肉桂捲4入", qty: 1 }], { batchDate: "2026-07-07" }),
    mkOrder("B", "賣貨便", [{ sku: "經典肉桂捲4入", qty: 1 }], { batchDate: "2026-07-14" }),
  ];
  const labels7 = extractLabels(orders, menu, { batchDate: "2026-07-07" });
  const labels14 = extractLabels(orders, menu, { batchDate: "2026-07-14" });
  assert(labels7.length === 1 && labels14.length === 1, "各出 1 張");
  console.log("  ✅\n");
}

// Case 6: 空訂單、pending 訂單 → 不會被抽出
console.log("Case 6: pending 訂單、無 batchDate 訂單不會被抽出");
{
  const orders = [
    mkOrder("PEND", "賣貨便", [{ sku: "經典肉桂捲4入", qty: 1 }], { status: "pending_batch_date", batchDate: null }),
    mkOrder("NODATE", "賣貨便", [{ sku: "經典肉桂捲4入", qty: 1 }], { status: "confirmed", batchDate: null }),
    mkOrder("OK", "賣貨便", [{ sku: "經典肉桂捲4入", qty: 1 }], { status: "confirmed", batchDate: "2026-07-21" }),
  ];
  const labels = extractLabels(orders, menu);
  assert(labels.length === 1 && labels[0].order_id === "OK", "只有 OK 訂單被抽");
  console.log("  ✅\n");
}

console.log("═══════════════════════════════════════════");
console.log("  M5 extractLabels 6 cases 全通過 ✅");
console.log("═══════════════════════════════════════════");

function assert(cond, msg) {
  if (!cond) {
    console.error(`  🚨 ASSERT FAIL: ${msg}`);
    process.exit(1);
  }
}
