# narcos-oven MCP Server 設定教學

_目的：讓雇主的 **Claude Code** 能直接查詢 narcos-oven 的訂單資料。_
_例如：「幫我看 7/7 出爐狀況」「哪些訂單還沒排出爐日？」「李*軒 這半年下了幾次單？」_

---

## 概念圖

```
┌─────────────────────┐        ┌──────────────────────┐
│  Web app            │        │  Claude Code         │
│  (雇主拖檔上傳)      │        │  (雇主用來對話問問題) │
└──────────┬──────────┘        └──────────┬───────────┘
           │                                │
           │ 匯出 state.json                │ MCP stdio
           ▼                                ▼
   ┌──────────────────────────────────────────┐
   │  narcos-oven MCP server                  │
   │  (node process、tsx 執行)                 │
   │                                          │
   │  讀取 data/state.json + data/menu.yaml   │
   │  提供 11 個查詢 tool                      │
   └──────────────────────────────────────────┘
```

---

## Step 1：一次性設定

**確認 tsx 已安裝**（本專案已有）：

```bash
cd /Users/xxx/Desktop/Yen/Develop/narcos-oven
pnpm install     # 已裝過就 skip
```

**打開 Claude Code 設定檔**（macOS）：

```
~/.claude/claude_desktop_config.json
```

加入 narcos-oven MCP server：

```json
{
  "mcpServers": {
    "narcos-oven": {
      "command": "npx",
      "args": [
        "tsx",
        "/Users/xxx/Desktop/Yen/Develop/narcos-oven/src/mcp/server.ts"
      ]
    }
  }
}
```

⚠️ 把 `/Users/xxx/Desktop/Yen/Develop/narcos-oven` 換成你的實際路徑。

**重啟 Claude Code**。

---

## Step 2：每次匯入新資料後、匯出 state.json

Web app 有一個 **「💾 匯出 state.json」** 按鈕在「📊 產出 Excel」區塊底部。

點下去 → 下載 `state.json` → 把它放到：

```
/Users/xxx/Desktop/Yen/Develop/narcos-oven/data/state.json
```

⚠️ 這個檔案含客戶 PII（姓名、電話、地址），**絕對不會進 git**（已在 `.gitignore`）。

---

## Step 3：在 Claude Code 開始問問題

打開 Claude Code、告訴它：

> 我剛剛更新了 narcos-oven 的 state.json、可以查最新資料了。7/7 那批出爐狀況怎樣？

Claude Code 就會呼叫 `narcos_query_batch(date="2026-07-07")` 給你 report。

---

## 可用 tools 清單（11 個）

| Tool | 用途 | 需要參數 |
|---|---|---|
| `narcos_state_info` | 目前載入資料的統計（訂單數、匯入次數、匯出時間） | 無 |
| `narcos_get_pending_batches` | 待排出爐日的訂單清單 | 無 |
| `narcos_query_batch` | 某天的完整批次資訊 | `date` (YYYY-MM-DD) |
| `narcos_get_bom` | 某批次備料清單 | `date` |
| `narcos_get_timeline` | 某批次製作時程回推 | `date` |
| `narcos_period_summary` | 月/季/年摘要 | `type` (`month`/`quarter`/`year`/`all`) + `year` + `month`/`quarter` |
| `narcos_get_payout` | 分潤統計（50/30/20 拆帳） | 可選 period |
| `narcos_search_orders` | 姓名/IG/電話搜尋 | `query` |
| `narcos_get_disappeared_pending` | 消失待決議清單（憲章 #9） | 無 |
| `narcos_suggest_next_schedule` | 系統對 pending 訂單的排程建議（read-only view） | 無 |
| `narcos_release_status` | 憲章 gate 狀態（能不能產出 Excel） | 無 |

---

## 對話範例

**「Q1 那三個月一共賺了多少？」**
```
Claude Code → narcos_get_payout(type="quarter", year=2026, quarter=1)
→ 總營收 X、品牌拿 X*0.5、主廚 X*0.3、行銷 X*0.2
```

**「7/7 那天我要準備哪些原物料？」**
```
Claude Code → narcos_get_bom(date="2026-07-07")
→ 肉桂捲 120 顆、蘋果肉桂捲 15 顆、原味巴斯克 3 顆 ...
```

**「這個李*軒之前買過什麼？」**
```
Claude Code → narcos_search_orders(query="李*軒")
→ 3 筆歷史訂單、各批次日、各金額
```

**「有沒有訂單卡住還沒排？」**
```
Claude Code → narcos_get_pending_batches
→ 42 筆待排、其中 8 筆客人希望 7/7、其他 34 筆沒指定
```

---

## 憲章保障

- **#8 LLM 答案附引用**：每個 tool 回傳都含 `sourceOrderIds` 陣列、Claude Code 可以「你怎麼算出來的？」你就能看到底是哪些訂單
- **主軌零 LLM**：MCP 是**唯一** LLM 進場點、Web app 端 100% deterministic
- **PII 保護**：state.json 在 .gitignore；MCP server 只在你本機執行；不會外洩

---

## Troubleshooting

**Q: Claude Code 說「narcos-oven」server 連不上？**
- 確認 `~/.claude/claude_desktop_config.json` 的路徑正確
- 確認 `pnpm install` 跑過、`node_modules/tsx` 存在
- 手動測試：`cd narcos-oven && npx tsx src/mcp/server.ts` 若出現 "narcos-oven MCP server 已啟動" 表示 OK

**Q: 查詢結果是空的？**
- 確認 `data/state.json` 存在且不是空的
- Web app 拖檔進去後、點「💾 匯出 state.json」

**Q: state.json 更新後、Claude Code 還是舊資料？**
- MCP server **每次呼叫 tool 都重新讀檔**、應該即時反映
- 若還不行、重啟 Claude Code

---

## 進階：整合到 workflow

雇主可以在 Claude Code 建立 saved conversation：
```
你是 NARCOS.sugar 老闆的助理。每次對話開始、
先呼叫 narcos_state_info 確認資料時間、
再呼叫 narcos_get_pending_batches 看看有沒有等排的訂單。
然後根據使用者問題查詢對應 tool。
```

這樣每次打開就自動 briefing。
