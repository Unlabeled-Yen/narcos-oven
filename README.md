# narcos-oven

NARCOS.sugar 肉桂捲店的出爐指揮台 web app。

## 🎯 目標（這個專案要為 NARCOS 做到什麼）

把老闆現在散在 **賣貨便後台匯出檔、面交 Google Form、KOL 合作表** 三邊、
手動對帳／算量／貼標籤／排出爐時程的整套流程，**收攏成一個桌上型指揮台**，
讓老闆從「一批訂單一批訂單湊 Excel」升級成「拖檔進來、直接看到今天要烤幾顆、貼哪張標、賺多少」。

具體做到五件事：

1. **一個入口收齊三源訂單**——拖檔進來自動判斷格式，重複匯入自動 diff，不再手動比對
2. **出爐排程自己算**——用時間預算模型算出「這批何時該烤、能不能塞、要不要超載警告」，替老闆做拍板前的算術
3. **標籤 / 出貨表 / 分潤 Excel 一鍵產**——把重複性文書從老闆的工時裡拿掉
4. **儀表板看趨勢**——回頭客率、品項銷量、批次營收，讓老闆「看得到生意的形狀」而不只是收單
5. **AI native 但把 LLM 放對位置**——所有帳算、對帳、產表都是 deterministic code（憲章 #1：靜默失效 = 0%）；
   LLM 只在雇主自己的 Claude Code 裡透過 MCP 讀 domain 資料（憲章 #2：AI native、放對位置），web app 本身零 LLM 依賴

一句話：**把老闆的「烤」跟「賣」之間那條斷裂的手工橋，換成一台不會靜默失效的自動化工作台。**

## 📊 進度（最後更新 2026-07-03）

**Phase A（核心 pipeline）完成 + 訂單統計 M100 收攏 + 排程 v2 上線。剩 4 個小 gap 與憲章 test suite 待補。**

已完成 milestones：

| M | 內容 |
|---|---|
| M0 | 資料分析 + `menu.yaml` 唯一 source of truth |
| M1 | 賣貨便 parser |
| M2 | 面交 + KOL parser + 多檔智慧判斷 |
| M3 | 連續匯入 diff engine（憲章 #9 #10：訂單消失 / 資訊變動守恆律） |
| M4 | Excel 產出（出爐統計 / 總覽 / 分潤） |
| M5 | 標籤 PDF + 期間篩選（月 / 季 / 年） |
| M6.5 | 排程 v2：時間預算 + RC-1/2/3（憲章 #11–14） |
| M7 | MCP server（11 tools，供雇主的 Claude Code 呼叫） |
| M100 | A+B+C 三源訂單統計 100% 收攏、雙軌獨立驗證上線 |

守恆律防護：**14 條全部落地**（見 `docs/PROGRESS-CHECKPOINT.md`）。

待做：

- **M8 憲章 test suite**：把散落的 `verify-*.mjs` 整合成 `pnpm test`（估 3–4 hr）
- **Chrome 擴充 / bookmarklet**：直接跟賣貨便後台聯通，省掉「匯出→拖檔」那一步（待偵察）
- **4 個小 gap 收尾**：見 `docs/PROGRESS-CHECKPOINT.md`

詳細 checkpoint 見 [`docs/PROGRESS-CHECKPOINT.md`](docs/PROGRESS-CHECKPOINT.md)。

---

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
