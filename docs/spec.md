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
  channel: "賣貨便" | "面交_中壢" | "面交_台中" | "面交_其他" | "宅配" | "KOL" | "待分類"
  status:
    | "confirmed"               // 主軌走完、進出爐統計
    | "pending_payment"         // 賣貨便 c5 = 訂單成立(未付款)（雇主 confirm #3）
    | "pending_batch_date"      // 沒抓到出爐日
    | "pending_conflict_date"   // c12 vs c28 日期衝突（雇主 confirm #4）
    | "pending_channel"         // 通路不確定
    | "pending_recipient"       // 收件人資訊不足
    | "pending_amount"          // 金額對不上（防護 #2）
    | "pending_product"         // 品項找不到 SKU
    | "pending_kol_choice"      // KOL「擇一」品項待填實際選擇（雇主 confirm #7）
    | "disappeared_pending_resolution"  // M3：上次匯入沒看到、雇主待拍板（憲章 #9）
    | "change_pending_resolution"       // M3：關鍵欄位變動、雇主待拍板（憲章 #10）
    | "shipped"                 // M3：雇主拍板為已出貨、進歷史
    | "canceled"                // M3：雇主拍板為已取消、倒扣出爐量
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

  // M3 生命週期欄（憲章 #9 #10）
  first_seen_at: string          // 首次被匯入系統的時間
  last_seen_at: string           // 最近一次匯入還在的時間
  disappeared_at: string | null  // 上次匯入沒看到就標記
  disappeared_resolution:        // 雇主拍板結果
    | "shipped" | "canceled" | "kept_active" | null
  frozen_after_label_print: bool // 標籤印出後、拒絕自動變動
  changes: OrderChange[]         // 每次匯入若關鍵欄位變動就 append
}

type OrderChange = {
  imported_at: string
  import_run_id: string
  fields: Record<string, {from: unknown, to: unknown}>
  resolved: "accepted" | "rejected" | "reprint_needed" | null
}

// M3：每次「雇主拖檔進來」是一個 ImportRun
type ImportRun = {
  id: string                   // "run-2026-07-15T14:32Z"
  imported_at: string
  source_files: string[]
  diff: {
    added: string[]              // order_ids（情境 A）
    payment_confirmed: string[]  // 情境 B - 已自動更新
    fields_changed: string[]     // 情境 D - 需雇主確認
    disappeared: string[]        // 情境 C - 需雇主逐一分類
    unchanged: string[]          // 情境 E - skip
  }
  resolutions: Record<string, {  // 雇主對 disappeared / fields_changed 的分類
    order_id: string
    resolution: "shipped" | "canceled" | "kept_active" | "accept_change" | "reject_change" | "reprint"
    resolved_at: string
  }>
  fully_resolved_at: string | null   // 全處理完的時間；未 null 前 Excel/PDF 產出 disabled
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
    | "PAYMENT_NOT_CONFIRMED"        // 未付款、暫不排程
    | "MISSING_BATCH_DATE"
    | "CONFLICT_DATE_C12_C28"        // c12 選項 vs c28 備註日期衝突
    | "AMBIGUOUS_CHANNEL"
    | "UNKNOWN_PRODUCT"
    | "AMOUNT_MISMATCH"
    | "MISSING_RECIPIENT"
    | "KOL_CHOICE_UNRESOLVED"        // KOL 擇一品項待填
  humanMessage: string
  suggestion?: string
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
    │ 賣貨便：合併「訂單延續行」；提取指定出貨日；判付款狀態
    │ 面交：regex 解析 c2；checkbox 欄位轉品項數
    │ KOL：c1/c2 為新一筆邊界；判 c6 已寄出
    │
    │ 【付款 filter】賣貨便 c5 !== "付款完成..."
    │   → PendingReason(PAYMENT_NOT_CONFIRMED)   雇主 confirm #3
    │
    │ 【KOL c6 filter】c6 === True (已寄出)
    │   → 標記 shipped、不進本批出爐量        雇主 confirm #6
    ▼
[Stage 2: Menu Lookup（純字串 + signature match）]
    │ 步驟：                                     雇主 confirm #10
    │   1. 先跟 aliases[] 做 exact 字串 match
    │   2. 若無命中，跟 match_signature 做「中文字 include/exclude」判定
    │   3. 拆解 combo 為 atoms
    │
    │ 找不到 SKU → PendingReason(UNKNOWN_PRODUCT)
    │ KOL「擇一」品項 → PendingReason(KOL_CHOICE_UNRESOLVED)
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
    │ 【c28 vs c12 衝突檢查】                    雇主 confirm #4
    │   若 c28 regex 有日期 且 c12 也有出貨日 且 兩者不同
    │     → PendingReason(CONFLICT_DATE_C12_C28)
    │   若 c28 有日期但 c12 沒選 → 建議用 c28 日期進 MISSING_BATCH_DATE
    │
    │ 抓不到 → PendingReason(MISSING_BATCH_DATE)
    ▼
[Stage 5: Recipient Grouping（標籤分盒用）]
    │ key = (batch_date, recipient_name)
    │
    │ 【標籤數】                                 雇主 confirm #1
    │   賣貨便：labelCount = c22 （每箱一張）
    │   面交/KOL：labelCount = 該筆品項數
    │
    │ 標籤編號：labelCount=2 → "2-1", "2-2"
    ▼
[Stage 6a: Diff 偵測]                             甜點店隨時接單 → 每次匯入都要 diff
    │ ImportRun 開始：source_files, imported_at
    │
    │ new_ids   = 新匯出的 order_id 集合
    │ db_active = 系統中「賣貨便 & status ∈ {confirmed, pending_*, pending_payment}」
    │
    │ added        = new_ids − db_active         情境 A: 新單
    │ still_here   = new_ids ∩ db_active         情境 B/D/E 候選
    │ disappeared  = db_active − new_ids         情境 C: 消失（最危險）
    ▼
[Stage 6b: Upsert 分派]
    │ 新單（added）  → INSERT + Stage 2-5 pipeline
    │
    │ still_here 每一筆比對：
    │   ├─ c5 從未付款 → 付款   → auto-update，重跑 Stage 2-5    情境 B
    │   ├─ c5 沒變 & 關鍵欄位沒變        → skip                    情境 E idempotent
    │   └─ 關鍵欄位變動 (c12/c22/c17/c18-20/c21/c11 收件門市)
    │        → 進 「change_pending」桶                          情境 D
    │        → 【憲章 #10】絕不 auto-overwrite 已排入批次的訂單
    ▼
[Stage 6c: 消失處理]                              憲章 #9 訂單消失守恆律
    │ disappeared 每一筆 → status = "disappeared_pending_resolution"
    │                    → 進「消失待確認桶」
    │
    │ 雇主必須逐一拍板（不能靜默）：
    │   [已出貨] → status = shipped、離開 active、進歷史
    │            如已印過標籤 → 保留、繼續有效
    │   [已取消] → status = canceled、倒扣出爐量、分潤扣款
    │            如已印過標籤 → 標「已作廢」、詢問是否重印同批他單
    │   [暫留]  → 維持 active、下次匯入若再出現則恢復
    │
    │ 【憲章 #9】此桶未清空前、Excel/PDF 產出 disabled
    ▼
[Stage 6d: Persistence]
    │ orders 表 UNIQUE(order_id)、含生命週期欄
    │ import_runs 表：每次匯入的完整 diff 摘要（可回溯）
    │ change_history 表：每筆訂單的欄位變動歷程
    │
    │ 【防護 #1 總數守恆律】
    │ 【新增 #9 訂單消失守恆律】disappeared 桶必須清空才能產出
    │ 【新增 #10 資訊變動守恆律】關鍵欄位變動 flag、不 auto-overwrite
    ▼
[Stage 7: Output]
    │ 出爐統計 xlsx / 出貨總覽 xlsx / 分潤 xlsx / 標籤 PDF
    │
    │ 【分潤計算】                               雇主 confirm #5
    │   總營收 = Σc21 （含運費、含買家實付）
    │   淨營收 = 總營收 - Σ品項成本 - Σ包材 - Σ物流實付
    │   （品項成本 & 物流實付見 menu.yaml logistics_cost，v1 用預設值）
    │
    │ 【標籤 PDF】                               雇主 R2-3
    │   spec = She 既有 jpg 佈局（fixtures/2026-07-round1/@ 參考.../出貨標籤/）
    │   每頁 590×945 px 等效比例
    │   內含 3 個標籤直排、虛線分隔
    │   單一標籤 590×315 px（aspect 1.87:1）
    │   實體 mm 由印表機決定；若需精確 → 200 DPI 換算為 75×120mm 每頁
    │
    │ 產出前彈「離手前核對頁」（防護 #6）給人確認
```

---

## 4. 憲章防護對應表

| 防護 # | 名稱 | 實作位置 |
|---|---|---|
| 1 | 總數守恆律 | Stage 6d persistence 後執行 SQL count 驗證 |
| 2 | 金額對帳 | Stage 3 每筆訂單 pipeline 內執行 |
| 3 | 雙軌獨立驗證 | Output stage 前跑 `verify_stats.py` 從 raw fixture 重算一次 |
| 4 | Schema-forced LLM | 無適用（Web app 端無 LLM 呼叫） |
| 5 | Confidence gating | 無適用 |
| 6 | 離手前核對頁 | Output UI 元件 `<ReleaseGate />` |
| 7 | Regression fixture | 每批處理完自動 dump `fixtures/YYYY-MM-roundN/`；tests 每次跑一輪 |
| 8 | LLM 答案附引用 | MCP tool 返回結構強制含 `sourceOrderIds` |
| **9** | **訂單消失守恆律**（M3 新增） | Stage 6c；disappeared 桶未清空前 Excel/PDF 產出 disabled；`import_runs.disappeared_resolved` 全 true 才能繼續 |
| **10** | **資訊變動守恆律**（M3 新增） | Stage 6b；關鍵欄位 (c12/c22/c17/c18-20/c21/c11) 變動一律進 change_pending 桶、絕不 auto-overwrite；已印過標籤的訂單（`frozen_after_label_print`）拒絕變動、需雇主明確「接受並重印」 |

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
| `classify_pending(orderId, patch)` | 分類 / 修正一筆 pending |
| `refresh_payment_status(xlsx_path)` | 觸發付款 reconciliation：只跑 Stage 6 upsert、將 pending_payment → confirmed（雇主 R2-2） |
| `suggest_new_menu_item(orderName, orderPrice)` | 給 Claude Code 建議新 SKU |
| `list_menu_products(category?)` | 讀 menu |
| `compare_batches(dates[])` | 比較 N 個批次的品項/營收 |
| `get_payout(dateFrom?, dateTo?, mode: "gross" \| "net")` | 分潤 |
| `find_recipient(query)` | 用姓名/IG/phone 找歷史訂單 |

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

## 10. 尚未定案（待雇主第二輪 confirm）

10 個主要問題已在 2026-07-02 confirm 完（見 `docs/CONFIRMED-BY-BOSS.md`）。剩下這些細節動工前可 assume 預設、後補：

1. **焙茶栗子舊訂單 $880 vs 菜單 $980**：歷史調價還是資料錯？
   → v1 保留兩價：menu.yaml 用 $980（菜單當前），對帳時用 c14（訂單當時價）
2. **未付款訂單標記機制**：雇主怎麼在系統標記「已付款」？
   → v1 假設每次重新匯出賣貨便 xlsx 會刷新 c5
3. **熱感應標籤機規格**：機型、紙張尺寸？
   → v1 預設 60mm × 90mm 縱向、單張生成 PDF
4. **物流實際成本**：超商取貨、宅配、面交自取的實際店家付出金額
   → v1 用 menu.yaml `logistics_cost` 預設值（超商 $60、宅配 $130）
