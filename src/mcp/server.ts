/**
 * narcos-oven MCP server (stdio transport)
 *
 * 給雇主的 Claude Code 掛載使用。
 *
 * 使用：
 *   雇主在 ~/.claude/claude_desktop_config.json 加：
 *   {
 *     "mcpServers": {
 *       "narcos-oven": {
 *         "command": "npx",
 *         "args": ["tsx", "/Users/xxx/Desktop/Yen/Develop/narcos-oven/src/mcp/server.ts"]
 *       }
 *     }
 *   }
 *
 * 資料來源：
 *   - Menu: data/menu.yaml (SoT)
 *   - 訂單狀態: data/state.json (由 Web app 匯出、每次更新後手動同步)
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadMenuFromDisk, loadStateSnapshot } from "./state-io";
import * as tools from "./tools";
import type { Period } from "../domain/period";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const MENU_PATH = join(ROOT, "data", "menu.yaml");
const STATE_PATH = join(ROOT, "data", "state.json");

const server = new Server(
  { name: "narcos-oven", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ---------- Tool 定義 ----------

const TOOL_DEFS = [
  {
    name: "narcos_get_pending_batches",
    description:
      "找出所有需要雇主排出爐日的訂單（assignment_source=pending 且 status=confirmed）。回傳 count + orders 清單。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "narcos_query_batch",
    description:
      "查詢某個出爐日（batchDate）的完整資訊：訂單數、總營收、標籤總數、通路分佈、各原子(atom)出爐量。",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "出爐日 YYYY-MM-DD，例如 2026-07-07",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "narcos_get_bom",
    description:
      "取得某批次的備料清單（原物料需求）。v1 因雇主未提供 raw_material_recipe、回傳 atom fallback 級數量。",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "出爐日 YYYY-MM-DD" },
      },
      required: ["date"],
    },
  },
  {
    name: "narcos_get_timeline",
    description:
      "取得某批次的製作時程回推。依 menu.yaml product_lead_time、算出「哪天要開始做什麼」的行事曆。",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "出爐日 YYYY-MM-DD" },
      },
      required: ["date"],
    },
  },
  {
    name: "narcos_period_summary",
    description:
      "期間摘要：月報看日、季報/年報看月粒度。回傳每個粒度的訂單數、營收、標籤數、通路分佈。",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["month", "quarter", "year", "all"],
          description: "期間類型",
        },
        year: { type: "number", description: "年份，type=all 時不需要" },
        month: { type: "number", description: "月份 1-12，type=month 時必填" },
        quarter: { type: "number", description: "季度 1-4，type=quarter 時必填" },
      },
      required: ["type"],
    },
  },
  {
    name: "narcos_get_payout",
    description:
      "分潤統計：品牌 50% / 主廚 30% / 行銷 20% 拆帳。可加 period filter。",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["month", "quarter", "year", "all"] },
        year: { type: "number" },
        month: { type: "number" },
        quarter: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "narcos_search_orders",
    description:
      "以姓名 / IG 帳號 / 電話 / 訂單編號 substring 搜尋歷史訂單（回頭客分析）。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜尋字串（姓名/IG/電話/訂單編號的一部分）",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "narcos_get_disappeared_pending",
    description:
      "取得目前所有「消失待決議」訂單（憲章 #9）。雇主需逐一標記為已出貨/已取消/暫留。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "narcos_suggest_next_schedule",
    description:
      "系統對所有 assignment_source=pending 訂單的排程建議（read-only view）。使用「下次週二」規則 + 產能檢核。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "narcos_release_status",
    description:
      "檢查憲章 gate 狀態：是否可以產出 Excel/PDF。若消失/變動桶未清空 → can_release=false 並列出 blockers。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "narcos_state_info",
    description:
      "查看目前載入的 state.json 資訊：訂單總數、匯入次數、最近匯出時間。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

// ---------- Handlers ----------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFS,
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;

  // 每次都重新載入（保持與 web app 匯出同步）
  const menu = loadMenuFromDisk(MENU_PATH);
  const state = loadStateSnapshot(STATE_PATH);

  const respond = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  switch (name) {
    case "narcos_get_pending_batches":
      return respond(tools.getPendingBatches(state.orders));

    case "narcos_query_batch":
      return respond(tools.queryBatch(state.orders, String(args.date), menu));

    case "narcos_get_bom":
      return respond(tools.getBom(state.orders, String(args.date), menu));

    case "narcos_get_timeline":
      return respond(tools.getTimeline(state.orders, String(args.date), menu));

    case "narcos_period_summary": {
      const p = parsePeriod(args);
      return respond(tools.getPeriodSummary(state.orders, p));
    }

    case "narcos_get_payout": {
      const p = args.type ? parsePeriod(args) : undefined;
      return respond(tools.getPayout(state.orders, p));
    }

    case "narcos_search_orders":
      return respond(tools.searchOrders(state.orders, String(args.query)));

    case "narcos_get_disappeared_pending":
      return respond(tools.getDisappearedPending(state.orders));

    case "narcos_suggest_next_schedule":
      return respond(tools.suggestNextSchedule(state.orders, menu));

    case "narcos_release_status":
      return respond(tools.getReleaseStatus(state.orders));

    case "narcos_state_info":
      return respond({
        exported_at: state.exported_at,
        order_count: state.orders.length,
        import_run_count: state.import_runs.length,
        menu_products: Object.keys(menu.products).length,
      });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

function parsePeriod(args: Record<string, unknown>): Period {
  const type = String(args.type);
  if (type === "all") return { type: "all" };
  const year = Number(args.year);
  if (type === "year") return { type: "year", year };
  if (type === "quarter")
    return { type: "quarter", year, quarter: Number(args.quarter) as 1 | 2 | 3 | 4 };
  return { type: "month", year, month: Number(args.month) };
}

// ---------- Start ----------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout 保留給 MCP 用；狀態訊息走 stderr
  process.stderr.write("narcos-oven MCP server 已啟動\n");
}

main().catch((e) => {
  process.stderr.write(`MCP server 啟動失敗: ${e}\n`);
  process.exit(1);
});
