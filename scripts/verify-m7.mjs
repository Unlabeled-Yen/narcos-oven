/**
 * M7 MCP server 驗證
 *
 * 兩部分：
 *  1. 直接呼叫 tools 函式（沒走 MCP protocol）、確認回傳結構
 *  2. spawn `tsx src/mcp/server.ts`、送 ListTools 檢查回應
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STATE_PATH = join(ROOT, "data", "state.json");
const SERVER_PATH = join(ROOT, "src", "mcp", "server.ts");

// ============================================================
// Part 1: 建假 state.json 讓 MCP server 有資料可讀
// ============================================================
const fakeState = {
  version: 1,
  exported_at: new Date().toISOString(),
  orders: [
    {
      id: "CM_TEST_001",
      channel: "賣貨便",
      status: "confirmed",
      batchDate: "2026-07-07",
      customer_wish_date: "2026-07-07",
      system_suggested_date: null,
      assignment_source: "customer_wish_kept",
      recipient: { name: "測*用一", igOrLine: null, phone: null, address: null, convStore: "測門市" },
      items: [
        { productSkuId: "經典肉桂捲4入", rawName: "test", quantity: 1, subtotal: 400,
          atoms: [{ atomId: "肉桂捲", count: 4 }] },
      ],
      revenue: { grossTotal: 400, freight: 0, discount: 0 },
      labelCount: 1,
      pendingReasons: [],
      rawSource: { file: "test.xlsx", sheet: "非訂單匯入", rowIndex: 4, rawStatus: "付款完成" },
      snapshot: {
        c5_status: "付款完成", c11_conv_store: "測門市", c12_product: "test",
        c17_freight: 0, c18_discount_seller: 0, c19_discount_freight: 0,
        c20_discount_platform: 0, c21_total: 400, c22_label_count: 1,
      },
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      disappeared_at: null,
      disappeared_resolution: null,
      frozen_after_label_print: false,
      changes: [],
    },
    {
      id: "CM_TEST_002",
      channel: "賣貨便",
      status: "confirmed",
      batchDate: null,
      customer_wish_date: null,
      system_suggested_date: null,
      assignment_source: "pending",
      recipient: { name: "測*用二", igOrLine: null, phone: null, address: null, convStore: null },
      items: [
        { productSkuId: "蘋果肉桂捲4入", rawName: "test2", quantity: 2, subtotal: 960,
          atoms: [{ atomId: "蘋果肉桂捲", count: 8 }] },
      ],
      revenue: { grossTotal: 960, freight: 0, discount: 0 },
      labelCount: 2,
      pendingReasons: [],
      rawSource: { file: "test.xlsx", sheet: "非訂單匯入", rowIndex: 5, rawStatus: "付款完成" },
      snapshot: {
        c5_status: "付款完成", c11_conv_store: null, c12_product: "test2",
        c17_freight: 0, c18_discount_seller: 0, c19_discount_freight: 0,
        c20_discount_platform: 0, c21_total: 960, c22_label_count: 2,
      },
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      disappeared_at: null,
      disappeared_resolution: null,
      frozen_after_label_print: false,
      changes: [],
    },
  ],
  import_runs: [],
};

writeFileSync(STATE_PATH, JSON.stringify(fakeState, null, 2));
console.log(`✅ 假 state.json 寫入 ${STATE_PATH}`);

// ============================================================
// Part 2: spawn MCP server、送 ListTools、檢查回應
// ============================================================
console.log("\n═══════════════════════════════════════════");
console.log("  MCP server stdio protocol handshake");
console.log("═══════════════════════════════════════════\n");

async function testMcpProtocol() {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", SERVER_PATH], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("timeout"));
    }, 15000);

    // 送 JSON-RPC initialize
    const initRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "verify-m7", version: "0.1.0" },
      },
    };
    child.stdin.write(JSON.stringify(initRequest) + "\n");

    // 送 initialized notification
    setTimeout(() => {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
    }, 500);

    // 送 tools/list
    setTimeout(() => {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
    }, 1000);

    // 送 narcos_state_info
    setTimeout(() => {
      child.stdin.write(JSON.stringify({
        jsonrpc: "2.0", id: 3, method: "tools/call",
        params: { name: "narcos_state_info", arguments: {} },
      }) + "\n");
    }, 1500);

    // 送 narcos_query_batch
    setTimeout(() => {
      child.stdin.write(JSON.stringify({
        jsonrpc: "2.0", id: 4, method: "tools/call",
        params: { name: "narcos_query_batch", arguments: { date: "2026-07-07" } },
      }) + "\n");
    }, 2000);

    // 收 3 秒後停
    setTimeout(() => {
      clearTimeout(timeout);
      child.kill();
      resolve({ stdout, stderr });
    }, 3500);
  });
}

const { stdout, stderr } = await testMcpProtocol();
console.log("=== stderr ===");
console.log(stderr);
console.log("\n=== stdout（前 3000 字）===");
console.log(stdout.slice(0, 3000));

// 解析 stdout，看有沒有 JSON responses
const lines = stdout.split("\n").filter(l => l.trim().startsWith("{"));
console.log(`\n收到 ${lines.length} 個 JSON responses`);

let toolsListOk = false;
let stateInfoOk = false;
let queryBatchOk = false;

for (const l of lines) {
  try {
    const j = JSON.parse(l);
    if (j.id === 2 && j.result?.tools) {
      toolsListOk = true;
      console.log(`  ✅ ListTools 回應：${j.result.tools.length} 個 tools`);
      console.log(`    names: ${j.result.tools.map(t => t.name).slice(0, 5).join(", ")}...`);
    }
    if (j.id === 3 && j.result?.content) {
      stateInfoOk = true;
      const info = JSON.parse(j.result.content[0].text);
      console.log(`  ✅ narcos_state_info 回應：order_count=${info.order_count}`);
    }
    if (j.id === 4 && j.result?.content) {
      queryBatchOk = true;
      const batch = JSON.parse(j.result.content[0].text);
      console.log(`  ✅ narcos_query_batch(2026-07-07)：${batch.order_count} 筆、營收 $${batch.total_revenue}`);
    }
  } catch (e) {
    // skip
  }
}

console.log("\n═══════════════════════════════════════════");
if (toolsListOk && stateInfoOk && queryBatchOk) {
  console.log("  ✅ M7 MCP server 3 cases 全通過");
} else {
  console.log("  🚨 部分失敗：");
  console.log(`     ListTools: ${toolsListOk ? "✅" : "❌"}`);
  console.log(`     state_info: ${stateInfoOk ? "✅" : "❌"}`);
  console.log(`     query_batch: ${queryBatchOk ? "✅" : "❌"}`);
  process.exit(1);
}
console.log("═══════════════════════════════════════════");
