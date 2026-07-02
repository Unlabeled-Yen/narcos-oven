# narcos-oven 架構規格 v0

_目的：把四輪需求訪談 + 憲章原則 + 資料分析結果凝結成可動工的藍圖。_
_對象：Yen（作為 AI 導入 builder）+ 未來實作 code 的 Claude Code / Agent。_
_修改守則：任何架構變更前先 review 憲章原則、不能違反「靜默失效機率 = 0%」。_

---

## 0. 憲章 anchor

兩條原則貫穿整份 spec：

1. **LLM 不適合的地方一定用結構化 code，靜默失效機率 = 0%**
2. **AI native：LLM 放最適位置**（本專案定位為 Claude Code 側，Web app 端零 LLM）

詳見 `~/.claude/projects/-Users-yen-Desktop-ruflo-test/memory/narcos-oven-constitution.md`。

---

## 1. 高階架構

```
┌────────────────────────────────────────────────────────────┐
│                   雇主的 macOS                              │
│                                                             │
│  ┌─────────────────┐        ┌────────────────────┐        │
│  │  Web UI          │        │  Claude Code       │        │
│  │  (Vite React)    │        │  (雇主訂閱)         │        │
│  │  拖檔上傳、待處理  │        │  對話式問答         │        │
│  │  儀表板、菜單編輯 │        │  排出爐日、寫報告   │        │
│  └────────┬────────┘        └──────────┬─────────┘        │
│           │                             │                   │
│           │ HTTP (localhost:3000)       │ MCP (stdio)       │
│           │                             │                   │
│           ▼                             ▼                   │
│  ┌────────────────────────────────────────────────┐        │
│  │      narcos-oven server (Node v22)              │        │
│  │  ┌──────────────┐  ┌────────────────────────┐  │        │
│  │  │  REST API    │  │  MCP Server            │  │        │
│  │  │  (Fastify)   │  │  (@mcp/sdk stdio)      │  │        │
│  │  └──────┬───────┘  └──────────┬─────────────┘  │        │
│  │         │                      │                │        │
│  │         └──────────┬───────────┘                │        │
│  │                    ▼                            │        │
│  │     ┌───────────────────────────────┐          │        │
│  │     │   Domain logic (100% pure)    │          │        │
│  │     │  parsers / menu lookup /       │          │        │
│  │     │  batch aggregator /            │          │        │
│  │     │  label renderer                │          │        │
│  │     └──────────────┬────────────────┘          │        │
│  │                    ▼                            │        │
│  │     ┌───────────────────────────────┐          │        │
│  │     │  SQLite (better-sqlite3)      │          │        │
│  │     │  data/narcos.sqlite            │          │        │
│  │     └───────────────────────────────┘          │        │
│  └────────────────────────────────────────────────┘        │
└────────────────────────────────────────────────────────────┘

data/menu.yaml ── source of truth (Yen 手改 / Claude Code 建議)
```

### 為什麼是 fullstack Node（不是純前端 SPA）

原本規劃「純前端 SheetJS + IndexedDB」，改為 Node fullstack 因為：
1. **MCP server 必須是 Node/Python 處理程序**（IndexedDB 只在瀏覽器內）
2. **SQLite 比 IndexedDB 更適合跨批查詢**（SQL 直查、Claude Code 也能透過 MCP 執行 SQL）
3. **Web UI 和 Claude Code 共用同一個 domain logic**——一份 code，兩個 interface

### 為什麼 SQLite（不是 IndexedDB）

- 檔案就是資料庫（`data/narcos.sqlite`）——可 backup、可 diff（配 sqldiff）
- MCP tool 可以直接跑 SQL
- 「總數守恆律」「金額對帳」用 SQL 一條 query 就能算
- v2 給雇主時，這檔可拷貝

---

## 2. Domain 資料模型

TypeScript pseudo-code（正式定義用 zod schema、下面章節列）。

```ts
// menu.yaml 反序列化後
type Menu = {
  atoms: Record<AtomId, { unit: "顆" | "罐" | "包" }>
  products: Record<SkuId, Product>
}

type Product = {
  displayName: string           // 賣貨便權威原文
  category: "combo" | "single"
  aliases: string[]             // 面交/KOL/舊稱
  contains: { atom: AtomId; count: number }[]
  price: number | null          // 有時面交表獨賣的品項無賣貨便價
  cost: number | null           // 淨營收用，Yen 之後補
  seenCount: number             // 統計輔助
}

// 一筆訂單（不管從哪個通路來）
type Order = {
  id: string                    // 賣貨便 c4，或 auto-generated (in-person-001)
  channel: "賣貨便" | "面交" | "宅配" | "KOL" | "活動" | "待分類"
  status:
    | "confirmed"               // 主軌走完、進出爐統計
    | "pending_batch_date"      // 沒抓到出爐日
    | "pending_channel"         // 通路不確定
    | "pending_recipient"       // 收件人資訊不足
    | "pending_amount"          // 金額對不上（防護 #2）
    | "pending_product"         // 品項找不到 SKU
  batchDate: string | null      // "2026-07-07"
  recipient: {
    name: string | null         // 賣貨便打星「王*晨」、面交全名
    igOrLine: string | null
    phone: string | null
    address: string | null
    convStore: string | null    // 賣貨便門市
  }
  items: OrderItem[]            // 拆解後的 atoms
  revenue: {
    grossTotal: number          // 賣貨便 c21 或面交 c23
    freight: number             // 賣貨便 c17（買家付）
    discount: number            // 賣貨便 c18+c19+c20
  }
  labelCount: number            // 一單幾張標籤（c22 或計算）
  rawSource: {
    file: string                // "1.xlsx"
    sheet: string
    rowIndex: number
    rawData: object             // 原始一整列，供追溯
  }
  createdAt: string
  updatedAt: string
}

type OrderItem = {
  productSkuId: SkuId
  displayName: string           // 訂單當下的字串（可能是 alias）
  quantity: number
  atoms: { atomId: AtomId; count: number }[]  // 展開後
}

// 一次「出爐批次」
type Batch = {
  date: string                  // "2026-07-07"
  orders: Order[]               // 主軌通過的訂單
  pending: Order[]              // 待處理桶
  stats: {
    byChannel: Record<Channel, number>       // 各通路訂單數
    byAtom: Record<AtomId, number>           // 各原子出爐總量
    revenue: { gross: number; net: number | null }
  }
  createdAt: string
}

// 待處理項的原因/建議
type PendingReason = {
  orderId: string
  code:
    | "MISSING_BATCH_DATE"
    | "AMBIGUOUS_CHANNEL"
    | "UNKNOWN_PRODUCT"
    | "AMOUNT_MISMATCH"
    | "MISSING_RECIPIENT"
  humanMessage: string          // "客人 6/29 下單但沒選指定出貨日"
  suggestion?: string           // "建議歸類為 7/07 批次（同期最近排定日）"
  suggestionConfidence: number  // 0-1
}
```

---

## 3. Deterministic pipeline（主軌）

主軌 100% pure code、**不吃 LLM 輸出**。每一 stage 遇到不確定 → 進待處理桶。

```
[Input Files]
    │
    ▼
[Stage 1: Detect & Parse]
    │ 靠 sheet name / column header 判斷檔型
    │ 賣貨便：合併「訂單延續行」；提取指定出貨日
    │ 面交：regex 解析 c2；checkbox 欄位轉品項數
    │ KOL：c1/c2 為新一筆邊界
    │
    │  遇到解析失敗 → PendingReason
    ▼
[Stage 2: Menu Lookup（純字串 match）]
    │ 對 menu.yaml 的 displayName + aliases 做 exact match
    │ 拆解 combo 為 atoms
    │
    │  找不到 SKU → PendingReason(UNKNOWN_PRODUCT)
    ▼
[Stage 3: Validation（防護 #2 金額對帳）]
    │ 賣貨便：Σsubtotal + freight - discount === total ?
    │ 對不上 → PendingReason(AMOUNT_MISMATCH)
    ▼
[Stage 4: Batch Assignment]
    │ 賣貨便：c12 marker 抓出爐日
    │ 面交：c2 regex 抓日期
    │ KOL：c4 datetime or 字串日期解析
    │
    │  抓不到 → PendingReason(MISSING_BATCH_DATE)
    ▼
[Stage 5: Recipient Grouping（標籤分盒用）]
    │ key = (batch_date, recipient_name)
    │ 同 key 內多品項 → 2-1 / 2-2 / 2-3 編號
    │
    ▼
[Stage 6: Persistence]
    │ 寫進 SQLite：Order + PendingReason + Batch
    │ 觸發防護 #1（總數守恆律）：
    │   raw_input_count === Σ(confirmed) + Σ(pending)
    │
    ▼
[Stage 7: Output]
    │ 出爐統計 xlsx / 出貨總覽 xlsx / 分潤 xlsx / 標籤 PDF
    │ 產出前彈「離手前核對頁」（防護 #6）給人確認
```

---

## 4. 憲章防護對應表

| 防護 # | 名稱 | 實作位置 |
|---|---|---|
| 1 | 總數守恆律 | Stage 6 persistence 後執行 SQL count 驗證 |
| 2 | 金額對帳 | Stage 3 每筆訂單 pipeline 內執行 |
| 3 | 雙軌獨立驗證 | Output stage 前跑 `verify_stats.py` 從 raw fixture 重算一次 |
| 4 | Schema-forced LLM | 無適用（Web app 端無 LLM 呼叫） |
| 5 | Confidence gating | 無適用 |
| 6 | 離手前核對頁 | Output UI 元件 `<ReleaseGate />` |
| 7 | Regression fixture | 每批處理完自動 dump `fixtures/YYYY-MM-roundN/`；tests 每次跑一輪 |
| 8 | LLM 答案附引用 | MCP tool 返回結構強制含 `sourceOrderIds` |

---

## 5. REST API（Web UI 用）

Server：Fastify @ `localhost:3000`

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/batch/upload` | multipart 上傳 3-5 個 xlsx，返 batch preview（未 persist） |
| POST | `/api/batch/commit` | 使用者按「確認產出」，persist batch + 生成輸出 |
| GET  | `/api/batch/:date` | 讀一個 batch 的所有 orders + pending |
| GET  | `/api/pending` | 讀所有 pending（跨 batch） |
| PATCH | `/api/pending/:id/resolve` | 使用者分類/修改一筆 pending，主軌重跑該筆 |
| GET  | `/api/menu` | 讀 menu.yaml 內容 |
| PUT  | `/api/menu/products/:sku` | 更新 / 新增 product |
| GET  | `/api/stats?from&to&channel` | 儀表板 aggregate 查詢 |
| GET  | `/api/output/:date/labels.pdf` | 出貨標籤 PDF |
| GET  | `/api/output/:date/stats.xlsx` | 出爐統計 Excel |
| GET  | `/api/output/:date/overview.xlsx` | 出貨總覽 Excel |
| GET  | `/api/output/:date/payout.xlsx` | 分潤統計 Excel |
| GET  | `/api/output/:date/bundle.zip` | 打包全部 |

---

## 6. MCP Server（給 Claude Code 用）

`@modelcontextprotocol/sdk` stdio transport。雇主在 Claude Code 的 `.mcp.json` 加：

```json
{
  "mcpServers": {
    "narcos-oven": {
      "command": "node",
      "args": ["/Users/xxx/Desktop/Yen/Develop/narcos-oven/dist/mcp.js"]
    }
  }
}
```

### Tools 清單

每個 tool 返回 `{ result, sourceOrderIds?, warnings? }` 結構（防護 #8）。

| Tool | 用途 |
|---|---|
| `query_orders(dateFrom?, dateTo?, channel?, product?)` | 查詢訂單 |
| `query_batch(date)` | 讀某批次完整資料 |
| `get_batch_summary(date)` | 該批次出爐量、營收、通路分佈 |
| `list_pending(reasonCode?)` | 列出所有/特定原因的待處理 |
| `classify_pending(orderId, patch)` | 分類 / 修正一筆 pending（等同 REST PATCH） |
| `suggest_new_menu_item(orderName, orderPrice)` | 給 Claude Code 建議新 SKU（回 draft yaml block、Yen 要按確認才寫回） |
| `list_menu_products(category?)` | 讀 menu |
| `compare_batches(dates[])` | 比較 N 個批次的品項/營收 |
| `get_payout(dateFrom?, dateTo?, mode: "gross" \| "net")` | 分潤 |
| `find_recipient(query)` | 用姓名/IG/phone 找歷史訂單（回頭客分析） |

### Prompts（給 Claude Code 對話啟動用）

- `daily_batch_review` — 每次出爐前檢查該批的待處理
- `weekly_payout_report` — 每週分潤摘要草稿
- `kol_roi_analysis` — KOL 折扣碼使用效果

---

## 7. UI 頁面

Vite React + Tailwind + shadcn/ui。

| 頁面 | 路徑 | 內容 |
|---|---|---|
| **首頁 / 上傳** | `/` | 拖檔區、最近 5 批預覽 |
| **批次詳情** | `/batch/:date` | 該批訂單表、品項出爐量、營收、標籤預覽 |
| **待處理桶** | `/pending` | 一列一筆，鍵盤 J/K 上下、1-5 快速分類、Enter 確認 |
| **儀表板** | `/dashboard` | 跨批 KPI、趨勢圖、通路占比、TOP 5 品項 |
| **菜單編輯** | `/menu` | products 列表、直接編輯 YAML fields、Claude Code 建議進來的 diff review |
| **設定** | `/settings` | 資料庫路徑、輸出偏好（PDF 尺寸）、備份 |

### 待處理桶 UX（憲章 first-class citizen）

因為它是主軌的自然出口、不是 error handling，UX 設計要**輕快**：

```
┌──────────────────────────────────────────────────────┐
│  ⚠️ 待處理桶  (17 筆)              [鍵盤模式] [清空] │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ▶ CM2606190394389   c22=2                           │
│    郭*玲、嘉政二門市、蘋果肉桂捲禮盒六入               │
│    ⚠️ 訂單分 2 箱寄——出幾張標籤？                    │
│                                                       │
│    ┌─────┬─────┬───────────┬────────────┐            │
│    │ 1張 │ 2張 │ 保留待定  │ 展開看詳細 │            │
│    │ [1] │ [2] │ [3]       │ [Space]    │            │
│    └─────┴─────┴───────────┴────────────┘            │
│                                                       │
│  ▼ 下一筆: CM2606098851804   c22=2                    │
│    ...                                                │
└──────────────────────────────────────────────────────┘
```

每筆 pending 附**建議答案**（若 confidence ≥ 0.9 用預設 highlight）。

---

## 8. Milestones

| M | Deliverable | 目標時間 |
|---|---|---|
| **M0** | ✅ Skeleton + 資料分析 + menu.yaml v0 | 完成 |
| **M1** | vertical slice：拖檔 → 賣貨便 parser → menu lookup → 顯示 | 1-2 hr |
| **M2** | 完整 3 個 parsers（賣貨便 + 面交 + KOL）+ SQLite persistence | 3-4 hr |
| **M3** | 待處理桶 UI + 分類流程 | 2 hr |
| **M4** | 出爐統計 + 出貨總覽 Excel 產出 | 2 hr |
| **M5** | 標籤 PDF 產出 | 2-3 hr |
| **M6** | 分潤（總+淨並列）+ 儀表板 | 2 hr |
| **M7** | MCP server + Claude Code 整合驗證 | 3 hr |
| **M8** | 憲章防護 #1/#2/#3 test suite + regression fixture | 2 hr |

**估總工時**：18-22 hr（不含雇主 confirm 期間等待）

---

## 9. 開發規範

- 每個 domain function 必須有 unit test（防護 #7 fixture-driven）
- 所有 numeric field 必經 `toNum()` helper
- 所有跨資料源的品項字串比對必經 `menuLookup()`（**禁止 hardcode 字串**）
- Git commit 訊息中文、含目的（不只描述改了啥）
- Type-first：先寫 zod schema，再寫實作

---

## 10. 尚未定案（待雇主 confirm）

見 `docs/open-questions-for-boss.md`。動工前不能 assume 的：

- c22 標籤數量語意
- 面交 c17 焙茶命名衝突
- 未付款訂單是否進出爐量
- 標籤紙型規格

其餘可 assume 預設值先動工，之後改 config。
