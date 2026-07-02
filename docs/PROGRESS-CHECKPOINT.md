# narcos-oven 進度 Checkpoint

_最後更新：2026-07-03、Yen 準備換 session_

---

## 🎯 一句話總結

**Phase A 全部 logic 完成 + 訂單統計 100% 收攏 + 排程 v2 完成、剩下 4 個小 gap 待補。UI 有精緻儀表板。下個 session 可從 Chrome 擴充/bookmarklet、憲章 test suite、或 gap 收尾接手。**

---

## 📊 現況全景

### ✅ 已完成 milestones（依開發順序）

| M | 內容 | 產出 |
|---|---|---|
| M0 | 資料分析 + menu.yaml | `docs/data-analysis.md` + `data/menu.yaml` |
| M1 | 賣貨便 parser | `src/parsers/seller-buy.ts` |
| M2 | 面交 + KOL parser + 多檔智慧上傳 | `src/parsers/{in-person,kol,detect}.ts` |
| M3 | 連續匯入 diff engine + 憲章 #9 #10 | `src/domain/diff.ts` + `src/ui/ImportSummaryModal.tsx` |
| M4 | Excel 產出（出爐統計/總覽/分潤） | `src/output/*.ts` + `src/ui/ExportPanel.tsx` |
| M5 | 標籤 PDF + 期間篩選（月/季/年） | `src/output/label-*.ts` + `src/domain/period.ts` |
| M6 | 排程系統 v1 | `src/domain/scheduler.ts`（v1 已被 v2 取代） |
| **M6.5** | **排程 v2：時間預算 + RC-1/2/3** | `src/domain/scheduler-v2.ts` + `production-time.ts` |
| M7 | MCP server（11 tools） | `src/mcp/*.ts` + `docs/mcp-setup.md` |
| **M100** | **A+B+C 訂單統計 100% 收攏** | 見下方 gap 表 |

### ⏳ 待做（未來 session）

- **憲章 test suite (M8)**：整合 verify-*.mjs 成 pnpm test（估 3-4 hr）
- **Chrome 擴充 / bookmarklet**：跟賣貨便介面聯通（待偵察）
- **Gap 收尾**：4 個小 gap（見下方）

---

## 🔑 兩條憲章 + 14 條防護

**兩條原則**（`memory/narcos-oven-constitution.md`）：
1. LLM 不適合的地方一定用結構化 code、靜默失效機率 = 0%
2. AI native、LLM 放對位置

**14 條防護**（sched v2 完成後）：
| # | 名稱 | 實作位置 |
|---|---|---|
| 1 | 總數守恆律 | pipeline + Excel gate |
| 2 | 金額對帳 | seller-buy.ts |
| 3 | 雙軌獨立驗證 | `scripts/verify-double-track.mjs` (M100) |
| 4 | Schema-forced LLM | 無適用（zero LLM in web app） |
| 5 | Confidence gating | 無適用 |
| 6 | 離手前核對頁 | `ImportSummaryModal.tsx` |
| 7 | Regression fixture | `fixtures/2026-07-round1/` |
| 8 | LLM 答案附引用 | MCP tools 全部返 `sourceOrderIds` |
| **9** | **訂單消失守恆律** | diff.ts + ImportSummaryModal |
| **10** | **資訊變動守恆律** | diff.ts + ImportSummaryModal |
| **11** | **排程雇主拍板守恆律** | scheduler-v2 + SchedulePanel |
| **12** | **產能超載守恆律** | scheduler-v2 (時間預算) |
| **13** | **指定日產能預留** | scheduler-v2 (strict pre-book) |
| **14** | **最低前置期** | scheduler-v2 (5 天檢查) |

---

## 🏗️ 目前架構圖

```
┌────────────────────────────────────────────┐
│  narcos-oven web app（React + Vite）        │
│  http://127.0.0.1:3000                      │
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │ 頁面組成（App.tsx 上到下）             │  │
│  │ 1. 拖檔上傳                            │  │
│  │ 2. 匯入摘要 Modal（憲章 #9 #10）        │  │
│  │ 3. 憲章守恆律 Banner                   │  │
│  │ 4. 📊 儀表板（趨勢 + TOP + 回頭率）     │  │
│  │ 5. 🗓 排程建議（strict/flexible）       │  │
│  │ 6. 📊 Excel 產出（含期間篩選）           │  │
│  │ 7. Confirmed 訂單表                    │  │
│  │ 8. 🟡 待處理桶（互動 UI 全補齊）        │  │
│  │ 9. 已出貨歷史                          │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
              │                    ▲
              │ Dexie              │ state.json 匯出
              ▼                    │
       ┌──────────────┐            │
       │  IndexedDB   │─── 讀 ───→ │
       │  orders +    │            │
       │  import_runs │            │
       └──────────────┘            │
                                    ▼
                          ┌────────────────────┐
                          │  MCP Server        │
                          │  (tsx src/mcp/     │
                          │   server.ts)       │
                          │  11 tools          │
                          └────────────────────┘
                                    ▲
                                    │ 雇主 Claude Code
                                    │
```

---

## 📁 檔案結構（重要）

```
narcos-oven/
├── data/
│   ├── menu.yaml              ← Source of truth（Yen 手改、含 21 SKU + 排程 v2 config）
│   └── state.json             ← 匯出的 db snapshot（gitignored、供 MCP 讀）
├── docs/
│   ├── PROGRESS-CHECKPOINT.md ← 本檔（下個 session 從這裡開始）
│   ├── constitution.md/spec.md（若有 → 見 memory）
│   ├── spec.md
│   ├── scheduling-spec-v2.md  ← 排程 v2 完整 spec（Yen 全 confirm）
│   ├── CONFIRMED-BY-BOSS.md
│   ├── DECISIONS-BY-YEN.md
│   ├── open-questions-for-boss.md
│   ├── data-analysis.md
│   ├── mcp-setup.md           ← Claude Code 掛載 narcos-oven MCP 教學
│   └── menu-proposal.yaml
├── src/
│   ├── domain/                ← Pure functions、無 UI 依賴
│   │   ├── models.ts          ← zod schema（Order/Menu/ImportRun/…）
│   │   ├── utils.ts           ← toNum() 憲章 helper
│   │   ├── menu.ts            ← lookupSku + explodeToAtoms
│   │   ├── batch-date.ts      ← 三通路日期抽取
│   │   ├── xlsx-tolerant.ts   ← 抗 broken !ref
│   │   ├── diff.ts            ← M3 diff engine
│   │   ├── release-gate.ts    ← 憲章 #6 #9 #10 gate
│   │   ├── scheduler.ts       ← M6 v1（已由 v2 取代）
│   │   ├── scheduler-v2.ts    ← M6.5 v2（strict/flexible + 5 天前置期）
│   │   ├── production-time.ts ← M6.5 時間預算
│   │   ├── production-timeline.ts ← 製作時程回推
│   │   ├── bom.ts             ← 備料 BOM
│   │   ├── period.ts          ← 月/季/年 篩選
│   │   └── id-hash.ts         ← M100-B1 content hash
│   ├── parsers/
│   │   ├── seller-buy.ts      ← 賣貨便
│   │   ├── in-person.ts       ← 面交（ID 已改 content hash）
│   │   ├── kol.ts             ← KOL（ID 已改 content hash）
│   │   └── detect.ts          ← 智慧檔案類型辨識
│   ├── output/
│   │   ├── stats-excel.ts     ← 出爐統計（納入未排訂單）
│   │   ├── overview-excel.ts  ← 出貨總覽
│   │   ├── payout-excel.ts    ← 分潤（總+淨並列）
│   │   ├── period-summary-excel.ts ← 期間摘要
│   │   ├── label-data.ts      ← 標籤資料抽取
│   │   ├── label-renderer.ts  ← canvas + jsPDF
│   │   ├── bundle.ts          ← ZIP 打包
│   │   └── utils.ts           ← 共用 helpers
│   ├── db/
│   │   ├── schema.ts          ← Dexie tables
│   │   ├── orders.ts          ← CRUD wrappers
│   │   └── import-runs.ts
│   ├── mcp/
│   │   ├── server.ts          ← 11 tools MCP server
│   │   ├── tools.ts           ← Tool 實作
│   │   └── state-io.ts
│   ├── ui/
│   │   ├── ImportSummaryModal.tsx ← 消失/變動桶拍板
│   │   ├── ExportPanel.tsx    ← 6 個下載按鈕 + PeriodPicker
│   │   ├── SchedulePanel.tsx  ← 排程建議 + BOM 展開
│   │   ├── DashboardPanel.tsx ← 儀表板（趨勢/TOP品項/通路/回頭率）
│   │   ├── PendingBucket.tsx  ← 待處理桶（4 種互動 UI）
│   │   ├── OrdersTable.tsx
│   │   ├── ConservationBanner.tsx
│   │   └── PeriodPicker.tsx
│   └── App.tsx                ← 主組件
├── scripts/
│   ├── analyze.py             ← 資料分析工具
│   ├── verify-m1.mjs ... verify-m7.mjs
│   ├── verify-scheduler-v2.mjs ← M6.5 排程 v2 7 cases
│   ├── verify-double-track.mjs ← 憲章 #3 雙軌
│   ├── verify-period.mjs
│   └── verify-m5.mjs
├── fixtures/
│   └── 2026-07-round1/        ← PII、gitignored
├── test-output/               ← Excel 樣本（gitignored）
├── tests/                     ← （空、待 M8）
├── .gitignore
├── package.json               ← pnpm、Node v22
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
└── index.html
```

---

## 🔓 現在 Web app 能做的事

```
拖賣貨便/面交/KOL xlsx 進去
    ↓
自動辨識檔案類型、跑 pipeline
    ↓
若有異動（消失/變動）→ 強制彈 modal 拍板
    ↓
儀表板顯示：跨批趨勢 + TOP 品項 + 通路占比 + 回頭率
    ↓
排程建議：巴斯克 strict 優先、麵包 flexible FIFO
    ↓
待處理桶互動：擇一/填日/新通路/新品項
    ↓
Excel 產出：出爐統計/出貨總覽/分潤/期間摘要 + 標籤 PDF
    ↓
匯出 state.json → 雇主 Claude Code 透過 MCP 查詢
```

---

## ⏳ 下個 Session 可以做的事（依優先度）

### 🅰 賣貨便介面聯通（Chrome 擴充/bookmarklet）

**Yen 上輪對談的方向**：想跟賣貨便介面聯通、免手動匯出/下載/拖檔。

**進度**：討論了 6 種方案、Yen 最有興趣**方案 C Chrome 擴充**、但我建議先偵察：
- Yen 到賣貨便 F12 Network、截「匯出 xlsx」按鈕的 request（URL/method/headers）
- 若 endpoint 簡單 → 用 bookmarklet 30 分鐘搞定
- 若複雜 → 開發 Chrome 擴充（4-5 hr）

### 🅱 憲章 test suite (M8)

**scope**：整合 8 個 verify-*.mjs 成 `pnpm test`（用 node --test 或 vitest）
- 每條憲章防護對應 test case
- 對抗式 test：主動嘗試打破防護
- Regression 保護

**估時**：3-4 hr

### 🅲 4 個 gap 收尾

- **G3 部分**：面交同一單重匯 timestamp 變 → ID 也變的邊界
- **G7**：新品項一鍵新增到 menu.yaml UI
- **G8**：Excel gate 加「待老闆排」警告顯示
- **G11**：已印標籤重印完整流程

**估時**：各 30-60 分鐘

### 🅳 Phase B UI 精緻化（原本 M6.5 完成後的路徑）

- 排程日曆視圖（月/週 + 拖拉調整）
- BOM 詳細頁
- 客戶 CRM 頁面（用回頭率 base 擴充）
- 產能設定管理頁

---

## 🎯 未完 confirm 項（雇主待補）

見 `docs/CONFIRMED-BY-BOSS.md` 底部：

1. 焙茶栗子舊訂單 $880 vs 菜單 $980 是歷史調價還是資料錯？
2. 未付款訂單「已付款」的標記機制？
3. 熱感應標籤機規格（機型/紙張尺寸）？
4. 物流實際成本
5. R3-2 每日產能實際值
6. R3-3 每個品項 lead_time_days
7. **R3-4 每個品項 raw_material_recipe (BOM)** ← 最重要、影響 M6 BOM 精確度

---

## 🚨 Session 交接 Reminder

**本輪重要 feedback（已寫進 memory）**：
- `feedback-narcos-oven-no-internal-terms.md`：**絕不用 c2/c4/c22 這類內部欄位索引**、只用 xlsx 中文欄名（例：「在哪邊取貨！」欄、「寄貨時間」欄、「配送數量」欄）
- `feedback-llm-boundary.md`：deterministic 主軌 + LLM 副軌
- `narcos-oven-constitution.md`：兩條憲章原則

**技術棧**：
- Node v22 + pnpm 11.3.0
- Vite + React 18 + TS + Tailwind
- Dexie 4.4 (IndexedDB)
- SheetJS 0.20.3 (xlsx)
- jsPDF 4.2 + jszip 3.10
- @modelcontextprotocol/sdk 1.29
- tsx 4.22（run MCP server）

**GitHub repo**：https://github.com/Unlabeled-Yen/narcos-oven（私有）

**啟動指令**：
```bash
cd /Users/yen/Desktop/Yen/Develop/narcos-oven
pnpm install
pnpm dev              # web app @ http://127.0.0.1:3000
npx tsx src/mcp/server.ts  # MCP server（雇主 Claude Code 掛用）
```

**Verify 所有 scripts**：
```bash
node scripts/verify-m1.mjs
node scripts/verify-m2.mjs
node scripts/verify-m3.mjs
node scripts/verify-m4.mjs
node scripts/verify-m5.mjs
node scripts/verify-m6.mjs
node scripts/verify-m7.mjs
node scripts/verify-scheduler-v2.mjs
node scripts/verify-double-track.mjs
node scripts/verify-period.mjs
```

---

## 💾 下個 session 該讀的檔案（順序）

1. **本檔** `docs/PROGRESS-CHECKPOINT.md`
2. `docs/scheduling-spec-v2.md`（排程 v2 完整 spec）
3. `docs/CONFIRMED-BY-BOSS.md`（雇主答案）
4. `docs/DECISIONS-BY-YEN.md`（Yen 的架構決策）
5. `data/menu.yaml`（Source of truth）
6. `src/domain/models.ts`（型別）

之後依需求讀對應 module。
