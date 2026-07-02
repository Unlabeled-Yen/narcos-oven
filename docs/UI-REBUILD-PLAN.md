# narcos-oven UI 重建計畫（Design Handoff 執行）

_最後更新：2026-07-03，Yen 收到 Claude Design 交接包後啟動_

---

## 一句話

**現有陽春 Tailwind UI → 換成 NARCOS.sugar「倉儲控制台 DEPOT」品牌化黑底介面**、10 個畫面、憲章 14 條防護不動。分 7 phase 執行、跨 4-6 session。

---

## 交接包來源

- 原檔：`~/Downloads/Narcos Sugar 品牌參考.zip`（Yen 從 Claude Design 匯出）
- 解包後：11 個 `.dc.html` (10 功能頁 + 1 品牌方向) + `support.js` + `README.md`
- **這些 `.dc.html` 是設計參考稿、不是要複製貼上**。任務是**用 narcos-oven 現有 pattern（Vite+React 18+TS+Tailwind）重建**

---

## 兩條紅線（不可破）

1. **憲章 #1**：所有品項一律走 `menuLookup()`、**禁 hardcode 品項字串**。稿裡的數字（170 顆、41,600、5.3× 等）是示意、實作改由 domain 即時算
2. **憲章 #2**：主軌 0 LLM 不變。LLM 只在 MCP（雇主 Claude Code 側）、UI 只呈現其結構化結果附 `sourceOrderIds`（防護 #8）

---

## Design Tokens（Tailwind theme.extend）

### Colors

| 用途 | 名字 | HEX |
|---|---|---|
| 頁底 | `bg` | `#08080A` |
| 面板 | `panel` | `#0F0F12` |
| 卡片 | `card` | `#111114` |
| 軌道底 | `track` | `#161619` |
| 分隔線 | `line` | `#26262C` |
| 分隔線淡 | `line2` | `#1c1c20` |
| 隱線 | `faint` | `#3a3a40` |
| 主文字 | `ink` | `#F5F4EF` |
| 次文字 | `ink2` | `#E7E7EA` |
| 弱文字 | `ink3` | `#C9C9CF` |
| 靜音 | `mut` | `#8A8A93` |
| 靜音 2 | `mut2` | `#7A7A82` |
| 靜音 3 | `mut3` | `#6C6C74` |
| **主色** | `acc` | `#F5D400`（可切紅 `#E5352B` / 青 `#2AC7E8`） |
| 警示紅 | `red` | `#E5352B` |
| 警示橘 | `orange` | `#E5622A` |
| OK 綠 | `green` | `#43B23C` |
| 冷藏青 | `cyan` | `#2AC7E8` |
| 開麵糰紫 | `purple` | `#8557C9` |
| 狀態綠底 | `greenTint` | `#0f2410` |
| 狀態橘底 | `orangeTint` | `#2a1a10` |
| 狀態青底 | `cyanTint` | `#0d2830` |
| 狀態紫底 | `purpleTint` | `#241a35` |
| 狀態紅底 | `redTint` | `#2a1010` |
| 標籤紙 | `label` | `#F5F1E6` |
| 標籤虛線 | `labelDash` | `#b8ae95` |

### Typography

- **Anton** 400：大數字、英文大標、排名、標籤編號
- **Noto Sans TC** 500/700/900：中文（900 = 品牌超粗黑）
- **Space Mono** 400/700：數據、編號、代碼、軸標籤

### 其他

- **圓角一律 0**（銳角）；只有 NARCOS pill / 少數 status 標籤 999px
- 頁面左右 padding **24px** · grid gap **12px** · 卡片內距 **16–20px**
- **警示膠帶**：`height:9px; bg:repeating-linear-gradient(45deg,var(--acc) 0 16px,#111 16px 32px)`
- **顆粒**：feTurbulence(baseFrequency 0.85) 覆蓋、opacity ~0.05、可關
- **NARCOS logo pill**：黃底 + `skewX(-6deg)` + `box-shadow:5px 5px 0 #E5352B, 0 0 0 2px #111`
- KPI 卡左側 3px 彩邊標語意（黃/綠/橘/紅）
- 命令列 sticky top、nav active = `bg-acc text-ink`
- 三個 CSS 變數 Tweak：`--acc` 主色、`--pad` 密度、`--grain` 顆粒

---

## 10 頁 × 現況 mapping

| # | 頁 | 現況 | 難度 |
|---|---|---|---|
| 1 | 儀表板 | `DashboardPanel.tsx` ✅ | 換視覺 |
| 2 | 排程週檢視 + 拖拉 | `SchedulePanel.tsx` ⚠️ | **重寫**（HTML5 DnD） |
| 3 | 待處理桶（鍵盤優先） | `PendingBucket.tsx` ✅ | 換視覺 + 加 keydown |
| 4 | 訂單總覽 | `OrdersTable.tsx` ✅ | 換視覺 + filter chips |
| 5 | 菜單編輯 | 無 UI ❌ | **全新** + Claude Code diff |
| 6 | 分潤統計 | 只有 xlsx | 抽 domain + 新頁 |
| 7 | 出爐統計 matrix | 只有 xlsx | 抽 domain + 新頁 |
| 8 | KOL ROI | 只有 MCP tool | **全新** |
| 9 | 產能設定 | 手改 menu.yaml ❌ | **全新** |
| 10 | 出貨標籤 | `label-*.ts` ✅ | 換品牌樣式 |

---

## 7 個 Phase

| Phase | 內容 | 估時 | 主 session model | Delegate |
|---|---|---|---|---|
| **P0** 底層 | Tailwind tokens、字型、brand primitives（NarcosPill/WarningTape/GrainOverlay/StatusDot/Panel/KpiCard）、CommandBar、PageHeader、brand.css keyframes | 3-4 hr | Opus 4.8 親做 | — |
| **P1** nav + 路由 | 拆單頁 → 10 頁 nav、URL routing、active state | 2 hr | Opus 4.8 規劃 | Sonnet subagent 寫 |
| **P2** 沿用型 5 頁 | #1 儀表板 / #3 桶 / #4 總覽 / #6 分潤 / #7 出爐統計 | 8-10 hr | Opus 4.8 review | Sonnet subagent × 5 並行 |
| **P3** 全新型 3 頁 | #5 菜單編輯（含 Claude Code diff）/ #8 KOL / #9 產能設定 | 8-12 hr | Opus 4.8 review | Sonnet subagent × 3 |
| **P4** 排程拖拉排單 ★ | #2 週檢視 + HTML5 DnD + 憲章 #11 拍板 + #12 產能超載 | 4-6 hr | **Opus 4.8 親做** | — |
| **P5** 標籤品牌化 | #10 熱感紙預覽、警示膠帶、尺寸切換、jsPDF 樣式 | 3-4 hr | Opus 4.8 規劃 | Sonnet subagent |
| **P6** 憲章 UI audit | 逐頁檢查 4 條防護（#9 消失燈 / #10 標籤凍結鎖 / #11 拍板鎖 / #12 產能閘門） | 2 hr | **Opus 4.8 親做** | — |

**總估：30-40 hr、跨 4-6 session**。

---

## 模型策略（策略 B：不用手動切）

Yen 主 session 固定 **Opus 4.8**、批量重複活 Opus 用 `Agent({model: "sonnet", ...})` delegate 給 Sonnet subagent。

**為什麼 B 不是 A**：
- 手動切 model 跨 4-6 session 容易忘
- Agent tool subagent 有 context 隔離、批量活丟出去反而讓主 session 更乾淨
- 憲章 audit 這種判斷密集活 Opus 親做、品質有保證
- 成本：比純 Opus 便宜約 40-50%、比純 Sonnet 貴 30-50%、精準度 = 純 Opus

---

## 對應 domain function（絕不 hardcode、必經）

| 頁 | 呼叫 |
|---|---|
| 儀表板 | `getAll()` + 現有 `compute*` |
| 排程 | `scheduler-v2.ts` `runScheduleV2(...)` + `production-time.ts` |
| 待處理桶 | `PendingBucket.tsx` 現有 resolve 邏輯 |
| 訂單總覽 | `getAll()` + filter chips 前端算 |
| 菜單編輯 | `loadMenu(menuYamlText)` + write back yaml（新） |
| 分潤 | `payout-excel.ts` 抽出 pure function `computePayout(orders)` |
| 出爐統計 | `stats-excel.ts` 抽出 pure function `computeStatsMatrix(orders)` |
| KOL | MCP `kol_roi_analysis` 對應 domain（新抽） |
| 產能設定 | `menu.yaml` production_capacity 讀寫（新 UI） |
| 出貨標籤 | `label-data.ts` + `label-renderer.ts` |

---

## 憲章 UI 落實檢查（P6 audit checklist）

- [ ] **#1 總數守恆**：儀表板燈 + banner
- [ ] **#2 金額對帳**：分潤頁 banner 顯示 58/58 或不符
- [ ] **#3 雙軌獨立驗證**：出爐統計頁按鈕跑 `verify-double-track.mjs` 顯示結果
- [ ] **#6 離手前核對**：`ImportSummaryModal` 保留、風格套黑底
- [ ] **#8 LLM 附引用**：菜單編輯 / KOL 洞察頁顯示 sourceOrderIds
- [ ] **#9 消失守恆**：儀表板紅燈 + 「產出閘門 未清紅鎖」
- [ ] **#10 變動守恆**：標籤印出即凍結 flag、儀表板橘燈
- [ ] **#11 排程拍板**：拖拉落下 = `assignment_source="boss_scheduled"`、未拍板不進主軌
- [ ] **#12 產能超載**：排程週檢視 + 產能設定頁時間預算 gauge、超載回退
- [ ] **#13 指定日產能預留**：排程頁 strict pre-book 顯示
- [ ] **#14 最低前置期**：排程頁 5 天檢查、拖到 <5 天警告

---

## 檔案結構（重建後）

```
src/
├── ui/
│   ├── brand/                    ← ★ P0 新增
│   │   ├── GrainOverlay.tsx
│   │   ├── WarningTape.tsx
│   │   ├── NarcosPill.tsx
│   │   ├── StatusDot.tsx
│   │   ├── Panel.tsx
│   │   ├── KpiCard.tsx
│   │   ├── CommandBar.tsx        ← P0
│   │   ├── PageHeader.tsx        ← P0
│   │   ├── BrandPreview.tsx      ← P0 驗證用
│   │   └── index.ts
│   ├── pages/                    ← ★ P1 新增（10 頁）
│   │   ├── DashboardPage.tsx
│   │   ├── SchedulePage.tsx
│   │   ├── PendingPage.tsx
│   │   ├── OrdersPage.tsx
│   │   ├── MenuEditorPage.tsx
│   │   ├── PayoutPage.tsx
│   │   ├── StatsMatrixPage.tsx
│   │   ├── KolPage.tsx
│   │   ├── CapacityPage.tsx
│   │   └── LabelsPage.tsx
│   ├── DashboardPanel.tsx        ← 現有、P2 換皮
│   ├── SchedulePanel.tsx         ← 現有、P4 重寫
│   ├── PendingBucket.tsx         ← 現有、P2 換皮 + keydown
│   ├── OrdersTable.tsx           ← 現有、P2 換皮
│   ├── ImportSummaryModal.tsx    ← 現有、P2 套黑底
│   ├── ExportPanel.tsx           ← 現有、P2 換皮
│   ├── ConservationBanner.tsx    ← 現有、P2 換皮
│   └── PeriodPicker.tsx          ← 現有
├── styles/
│   └── brand.css                 ← ★ P0 新增
└── App.tsx                       ← P1 大改（路由）
```

---

## Session 交接 SOP

**下 session 開頭必讀**（順序）：
1. `docs/UI-REBUILD-PLAN.md`（本檔）
2. `docs/PROGRESS-CHECKPOINT.md`（Phase A checkpoint）
3. 交接包 `README.md`（在 `~/Downloads/Narcos Sugar 品牌參考.zip` 或解包後）
4. 當 Phase 對應的 `.dc.html` 設計稿（掃視覺）
5. `data/menu.yaml`

**每 Phase 完成後**：
- Commit 訊息前綴 `P{n}:`（例：`P2: 儀表板 + 訂單總覽換皮`）
- 更新本檔 Phase 表的「狀態」欄
- 更新 `PROGRESS-CHECKPOINT.md`

---

## 目前狀態

- [x] **P0** 底層（Opus 4.8）
- [x] **P1** nav + 路由（Opus）
- [x] **P2** 沿用型 5 頁（Sonnet subagent × 5）
- [x] **P3** 全新型 3 頁（Sonnet subagent × 3）
- [x] **P4** 排程拖拉排單（Opus 親做）
- [x] **P5** 標籤品牌化（Sonnet subagent）
- [x] **P6** 憲章 UI audit（Opus）— 見下方

### P6 audit 結論（2026-07-03）

**憲章 11 條防護全部落實 ✓**：#1 品項全經 menu（10 頁）、#2 web app 零 LLM/fetch、#3 出爐統計雙軌卡、#8 KOL 附 sourceOrderIds、#9 儀表板健康燈+待處理閘門、#10 標籤印出即凍結、#11 拖入=boss_scheduled、#12 超載二次確認+產能卡、#14 前置期警示。

**Runtime 驗證 ✓**：pnpm build 綠、10 頁在空 DB 全部 render 無 console error、空狀態安全。

**已知缺口（非憲章違反、待後續 wire）**：
1. **Excel/PDF 產出未接**：`output/{stats,overview,payout,period-summary}-excel.ts` 產檔器尚未 wire 進新頁的「產出」按鈕（僅 LabelsPage 接了 label 渲染）。新頁的產出按鈕目前是視覺。← **功能面最重要、下輪優先**
2. **ImportSummaryModal 仍舊淺色**：功能完整（#6/#9/#10 匯入閘門有效）、但視覺未品牌化。
3. **舊 panel 孤兒**：DashboardPanel/OrdersTable/PendingBucket/SchedulePanel/ExportPanel/ConservationBanner 不再被 shell render、留在 repo 當 dead code（可刪或當 compute 參考）。
4. **未用真實資料截圖驗證**：dev DB 空、只驗了空狀態不崩；populated data 路徑（Math/排序/矩陣熱區）待 import 真 xlsx 後再看。
