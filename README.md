# narcos-oven

NARCOS.sugar 肉桂捲店的出爐指揮台 web app。

整合 **賣貨便匯出** + **面交 Google Form** + **KOL 合作表**，產出：
1. 出爐統計表（品項 × 批次日期 × 通路）
2. 出貨資料總覽（每批次一張）
3. 出貨標籤（PDF / PNG）
4. 分潤統計（總營收 + 淨營收）
5. 儀表板 + Claude Code 對話介面（透過 MCP）

## 兩條專案憲章

1. **LLM 不適合的地方一定用程式/函式庫等結構性設計，讓「靜默失效機率 = 0%」**
2. **建立 AI native 流程或工具，把 LLM 放在最適當的位置**

詳見 [`docs/constitution.md`](docs/constitution.md)。

## 架構

```
Human ──► Web UI ──► REST API ──► Domain Logic ──► IndexedDB
                                        ▲
                                        │
Claude Code ──► MCP Server ─────────────┘
（雇主訂閱）      (tool interface)
```

- **Web UI**：拖檔上傳、待處理桶分類、菜單編輯、儀表板
- **MCP Server**：暴露 tool 給 Claude Code 呼叫（`query_orders`、`classify_pending`、`add_menu_item`...）
- **Domain Logic**：100% deterministic pipeline，不吃 LLM 輸出
- **Web app 本身無 LLM 依賴**——所有 AI 交互透過雇主訂閱的 Claude Code

## 技術棧

- Vite + React 18 + TypeScript + Tailwind
- pnpm（套件管理）
- Node v22
- SheetJS（Excel 讀寫）
- jsPDF + html2canvas（PDF 標籤）
- Dexie.js（IndexedDB）
- @modelcontextprotocol/sdk（MCP server）

## 目錄

```
narcos-oven/
├── docs/          # spec、憲章、資料分析
├── data/          # menu.yaml（品項對照表，唯一 source of truth）
├── fixtures/      # 歷史原始資料（PII、不進 git）
├── src/           # 前端 + MCP server
└── tests/
```

## 快速上手（待實作）

```bash
pnpm install
pnpm dev              # 開 web app
pnpm mcp:dev          # 開 MCP server（讓 Claude Code 連）
```
