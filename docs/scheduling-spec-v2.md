# 排程系統 v2 spec

_目的：把 M6 (v1) 的「顆數上限產能檢核」升級成「時間預算模型」+ RC-1+2+3 三大修正。_
_基礎規則來源：Yen 提供的實際生產節奏（2026-07-03）。_
_待 Yen review + confirm 才動 code。_

---

## 0. v1 → v2 差異總覽

| 面向 | v1 (M6) | v2 |
|---|---|---|
| 產能單位 | 每 atom 每日顆數上限（肉桂捲 200/天） | 每週時間預算 (24-30 hr) + 每品項時間公式 |
| 週節奏 | 只知道「下次週二」是出爐日 | 完整節奏：六日一製作、週二三寄、週四規劃、週五採買 |
| 客人 wish_date | 完全忽略、直接排下週二 | 分兩軌：巴斯克盡量配合、麵包類雇主決定 |
| 前置期 | 無檢查 | 訂單需 ≥ 5 天前置期才進下週批 |
| Pre-book | 無 | 明確指定的訂單先佔用時間預算 |
| 超載處理 | 遞進下週二 | FIFO：依訂單順序、超載延下批 |

---

## 1. 週節奏（Weekly Rhythm）

Yen 提供的實際節奏：

| 週幾 | 活動 | 用途 |
|---|---|---|
| 週六 | 🔥 製作衝刺 8-10 hr | 出爐日 |
| 週日 | 🔥 製作衝刺 8-10 hr | 出爐日 |
| 週一 | 🔥 製作衝刺 8-10 hr | 出爐日 |
| **週二** | 📦 開始包裝寄送 | **主要出貨日** |
| **週三** | 📦 極限寄送（當週目標） | **最晚出貨日** |
| 週四 | 📊 計算 + 排程下週單量 | 決策日 |
| 週五 | 🛒 採買材料 | 準備日 |

**關鍵定義**：
- **總週製作時間 = 24-30 小時**（三天 × 8-10 hr）
- **出貨日 (batchDate) = 週二** 或**週三**（客人視角）
- **實際製作日 = 出貨日前 3-4 天的週六/日/一**
- **週四之前訂購**才能進**下週批**（前置期 ≥ 5 天）

⚠️ **待 Yen confirm**：
1. **batchDate 應該記錄「週二」還是「週三」**？現有資料 (6/09, 6/16, 6/23, 7/07, 7/14) 都是週二 → 建議 v2 也以**週二**為主 batchDate、週三為 fallback。
2. 賣貨便「⚠️必填！指定出貨日 7/07（二）」的 7/07 是**到貨日還是寄出日**？

---

## 2. 產能模型：時間預算而非顆數上限

### 2.1 每品項時間公式（依 menu.yaml 全部 16 個 atom 細列）

**⚠️ Yen 2026-07-03 反映**：原本只寫「巴斯克類」沒細分口味、應該逐口味列。以下依 menu.yaml `atoms:` 段全部 16 個 atom 逐一列出。

#### 麵包類（4 個 atom）

| atom | 1 爐 | 2 爐 (Δ) | 3 爐 (Δ) | 每爐容量 |
|---|---|---|---|---|
| 肉桂捲 | **4.0 h** | **7.0 h** (+3.0) | **10.0 h** (+3.0) | 24 顆 |
| 蘋果肉桂捲 | **4.0 h** | **7.0 h** (+3.0) | 10.0 h* (+3.0) | 24 顆 |
| 焦糖蘋果肉桂麵包 | **2.5 h** | **4.0 h** (+1.5) | 5.5 h* (+1.5) | 8 顆 |

#### 磅蛋糕類（2 個 atom）

| atom | 1 爐 | 2 爐 (Δ) | 3 爐 (Δ) | 每爐容量 |
|---|---|---|---|---|
| 芝麻焙茶奶酥磅蛋糕 | **2.5 h** | 4.0 h* (+1.5) | 5.5 h* (+1.5) | 8 顆 |
| 鳳梨肉桂奶酥磅蛋糕 | **2.5 h** | 4.0 h* (+1.5) | 5.5 h* (+1.5) | 8 顆 |

#### 巴斯克類（7 個 atom、每口味獨立）⚠️ 需 Yen 提供各口味時間

| atom | 1 爐 | 2 爐 | 3 爐 | 每爐容量 |
|---|---|---|---|---|
| 原味巴斯克 | **2.0 h** | 3.5 h* | 5.0 h* | 4 顆 |
| 白玉原味巴斯克 | ??? | ??? | ??? | 4? |
| 芝麻巴斯克 | ??? | ??? | ??? | 4? |
| 白玉芝麻巴斯克 | ??? | ??? | ??? | 4? |
| **焙茶巴斯克**（純焙茶） | ??? | ??? | ??? | 4? |
| **焙茶栗子巴斯克** | ??? | ??? | ??? | 4? |
| 白玉烏龍茶巴斯克 | ??? | ??? | ??? | 4? |

**❓ Yen 需回答**：
1. **7 種口味製作時間都一樣**（都 2 hr / 1 爐、4 顆容量）嗎？
2. 還是**每口味不同**？（例：焙茶栗子要多花時間處理栗子、白玉夾餡要 +30 分鐘）
3. **烤箱容量**：一次能同時烤幾顆巴斯克？（4 顆一爐？8 顆？）

#### 香料堅果醬（3 個 atom、依容量差異）⚠️ 需 Yen 提供各容量時間

| atom | 時間 | 說明 |
|---|---|---|
| 香料堅果醬 40ml | ??? | 目前菜單無販售、但 menu 保留 |
| 香料堅果醬 90ml | ??? | 一次做 10 罐？ 20 罐？時間? |
| 香料堅果醬 240ml | ??? | 一次做 4 罐？時間? |

**Yen 提供**：`1000ml 2 hr` → 我推導：
- 90ml 一批 = 1000/90 ≈ 11 罐 → 2 hr 做 11 罐
- 240ml 一批 = 1000/240 ≈ 4 罐 → 2 hr 做 4 罐
- 這樣算對嗎？還是**不管容量、每次做一批都 2 hr**？

#### 瑕疵小脆捲（1 個 atom）
| atom | 時間 | 說明 |
|---|---|---|
| 瑕疵小脆捲 10 顆 | — | 這是**副產品**、不需獨立製作時間？ |

**Yen 確認**：瑕疵小脆捲是肉桂捲製作過程中的次級品打包、**不佔額外製作時間**、對嗎？

---

**粗字 = Yen 明確提供**、**斜體* = 我依線性斜率推導、待 Yen confirm**
**??? = 需 Yen 提供實際時間**

### 2.2 4 爐以上怎麼算？

**建議**：第 4 爐+ 每爐延續第 2/3 爐的斜率
- 肉桂捲 4 爐 = 10 + 3 = 13 h
- 焦糖 4 爐 = 5.5 + 1.5 = 7 h
- 巴斯克 4 爐 = 5.0 + 1.5 = 6.5 h

⚠️ **待 Yen confirm**：實際超過 3 爐後、時間會不會突然變慢（例如「累了」、「烤箱冷卻」）？

### 2.3 Overhead 規則

- **品項切換成本**：**40 分鐘 (0.67 hr) / 每次切換**
  - 例：先做 3 爐肉桂捲 → 切到巴斯克 → 加 0.67 hr
- **排滿 3 爐後洗模具**：**1 小時**
  - 例：4 爐肉桂捲 → 第 3 爐結束後洗模 1 hr、再做第 4 爐

### 2.4 週產能計算範例

**Case A**：本週訂單需求

```
訂單 needs:
  100 顆肉桂捲 → 5 爐 (24×5=120、餘 20 顆可分「加售」或次批)
  10 顆巴斯克  → 3 爐 (4×3=12、餘 2 顆)

時間預算:
  肉桂捲 5 爐 = 4 + 3 + 3 + 3 + 3 = 16 h + 1 hr 洗模 (排完 3 爐後) = 17 h
  切換到巴斯克 = 0.67 h
  巴斯克 3 爐  = 2 + 1.5 + 1.5 = 5 h
  ────────────────────────────
  合計 22.67 h
  
週總預算 = 24-30 h
✅ 可安排（餘 1.33-7.33 hr 給其他品項或緩衝）
```

**Case B**：超載範例

```
訂單 needs:
  200 顆肉桂捲 → 9 爐 = 4 + 3×8 + 3×(1 hr 洗模) = 31 h
  
週總預算 = 24-30 h
🚨 超載！系統應該：
  - 建議延部分訂單到下週
  - 或者提示 Yen「本週爆量、要不要加開一天製作？」
```

---

## 3. batchDate 語意重新定義

- **v2 batchDate = 客人視角的「出貨日」= 週二**（主）或**週三**（極限）
- 客戶備註「7/07（二）」代表 7/07 那個週二收到 or 寄出（待 Yen confirm）
- 現有系統 batchDate = 週二完全相容、v2 沿用即可
- 實際製作日 = batchDate - 3 天（週六）到 batchDate - 1 天（週一）

---

## 4. RC-1：客人 wish_date 優先度規則 ✅ Yen 已 confirm (2026-07-03)

**Yen 明確答**：
> 巴斯克 = strict、嘗試看看能不能優先
> 麵包 / 磅蛋糕 / 堅果醬 = 按照產能負荷和訂單順序安排

**核心洞察**：Yen 的實務上、**巴斯克 vs 麵包類**兩種品項的優先度規則不同。

### 4.1 巴斯克類 → `wish_priority: "strict"` (盡量配合)

規則：
1. 客人 wish_date 存在 → 系統**先試該日**
2. 該日時間預算足夠 → 排入、`assignment_source = customer_wish_kept`
3. 該日產能不足 → 進 pending、UI 顯示「客人希望 X、但 X 已滿、建議 Y」讓 Yen 拍板
4. Yen 通常會透過訊息跟客人協調 → UI 提供「改到 Y」或「請客人選其他」按鈕

適用 SKU：
- 原味巴斯克 / 白玉原味巴斯克
- 芝麻巴斯克 / 白玉芝麻巴斯克
- 焙茶巴斯克 / 焙茶栗子巴斯克
- 白玉烏龍茶巴斯克

### 4.2 麵包類 → `wish_priority: "flexible"` (通常照常規)

規則：
1. 客人 wish_date 存在但**不強制滿足**
2. 系統排**下個常態批**（下週二 or 依前置期規則）
3. **UI 顯示 flag**：「客人希望 X、系統排 Y、差 N 天」讓 Yen 看到、可選 [接受系統建議] / [改到 X] / [問客人]

適用 SKU：
- 肉桂捲類 4 入禮盒
- 蘋果肉桂捲類
- 三入禮盒（方型/長型）系列
- 四入/六入禮盒
- 磅蛋糕類
- 香料堅果醬

### 4.3 資料模型調整

在 `menu.yaml` 每個 product 加 `wish_priority`：

```yaml
products:
  經典肉桂捲4入:
    wish_priority: flexible
    # ...
  原味巴斯克:
    wish_priority: strict
    # ...
```

或在 category 層級預設（更簡潔）：

```yaml
category_wish_priority:
  combo: flexible          # 所有 combo (禮盒類)
  single_bread: flexible   # 單品麵包（磅蛋糕、堅果醬）
  single_basque: strict    # 巴斯克類
```

**建議用 category 版**、避免每個 SKU 重複寫。

---

## 5. RC-2：最低前置期規則

**核心規則**：訂單必須有 **≥ 5 天前置期**才能進下週批。

### 5.1 判定邏輯

```
訂購日 (order_date) → 最早可出爐日 (earliest_batchDate):
  1. earliest_batchDate = order_date + 5 天
  2. 往後找到下一個週二 = 候選 batchDate
  3. 若客人 wish_date ≥ earliest_batchDate → 用 wish_date（若 strict/flexible）
  4. 若客人 wish_date < earliest_batchDate → 太急、進 pending 讓 Yen 決定
```

### 5.2 範例

```
Case: 客人 7/3（週五）下單、指定 7/7（週二）出貨
  earliest_batchDate = 7/3 + 5 = 7/8（週三）
  客人 wish = 7/7 < 7/8 → 太急
  
  巴斯克 (strict) → pending「客人希望 7/7、但前置期不夠、建議 7/14」
  麵包 (flexible) → 排 7/14（下下週二）、UI flag「客人希望 7/7」
```

### 5.3 週四規則

**Yen 提供**：週四排下週單量、週五採買。

推導：
- 週四之前訂購（週日一二三四）→ 進**下週批**
- 週四之後訂購（週五六日）→ **本週已規劃完、進再下週**
- 這隱含 = 訂購日到下週二的距離 ≥ 5 天 ≡ 上面的 RC-2 規則

---

## 6. RC-3：Pre-book 機制

**核心規則**：客人 wish_priority=strict 且指定日的訂單、**預先佔用**該日的時間預算。

### 6.1 演算法

```
Stage 8a: 累積 pre-booked 時間
  for each order in orders:
    if order.assignment_source == "customer_wish_kept" and order.batchDate:
      # 該訂單的時間需求 (依上面 §2.1 時間公式計算)
      time_needed = calculateTimeForOrder(order, menu)
      # 累積到該 batchDate 的預算
      prebooked[order.batchDate] += time_needed

Stage 8b: 排 pending 訂單
  for each pending_order in pending:
    for each 候選日 (from 下週二 遞進):
      # 該日剩餘時間預算
      remaining = weekly_budget - prebooked[候選日] - already_scheduled[候選日]
      if 候選日時間需求 <= remaining:
        建議排入該日
        break
```

### 6.2 憲章 #13 (新增)：**指定日產能預留守恆律**

`assignment_source=customer_wish_kept` 且 `wish_priority=strict` 的訂單、**永遠優先分配時間預算**、系統絕不能因為其他訂單佔位而擠掉。

---

## 7. RC-6：超載處理（FIFO）

Yen 明確：**依訂單順序出單、超載延到下一批**。

### 7.1 演算法

```
若某週時間預算超載：
  1. 該週已排訂單按 created_at 排序（老訂單優先）
  2. 從最新 (LIFO) 訂單開始 push 到下週
  3. 直到該週時間預算 ≤ 24-30 hr
```

### 7.2 例外：Pre-booked 訂單不能被 push

`assignment_source=customer_wish_kept` 且 `wish_priority=strict` 的訂單、**受憲章 #13 保護**、絕對不被 push。

---

## 8. 資料模型變更

### 8.1 Order 新增欄位

```typescript
type Order = {
  // ...現有
  wish_priority: "strict" | "flexible" | null  // 承 product category 決定
  estimated_production_hours: number | null    // 該訂單的時間需求（依 §2.1 計算）
  // v1 系欄位保留：customer_wish_date, system_suggested_date, assignment_source
}
```

### 8.2 menu.yaml 新增段

```yaml
# 週製作時間預算
weekly_production_budget:
  total_hours: 24              # 週最小預算（Yen 提供 24-30 hr）
  total_hours_max: 30          # 週最大預算
  breakdown:
    Sat: [8, 10]               # 週六 8-10 hr
    Sun: [8, 10]
    Mon: [8, 10]

# 每品項時間公式
production_time_formula:
  肉桂捲:
    per_batch_units: 24         # 每爐 24 顆
    hours_by_batch_count:
      1: 4.0
      2: 7.0
      3: 10.0
    hours_per_additional_batch: 3.0  # 4 爐+ 每爐 +3 hr
  蘋果肉桂捲:
    per_batch_units: 24
    hours_by_batch_count: {1: 4.0, 2: 7.0, 3: 10.0}
    hours_per_additional_batch: 3.0
  # ... 其他品項
  
# Overhead 規則
overhead:
  product_switch_hours: 0.67          # 40 分鐘 = 0.67 hr
  wash_mold_after_batches: 3          # 排滿 3 爐後洗模
  wash_mold_hours: 1.0

# 品項 category → wish_priority
category_wish_priority:
  combo: flexible
  single_basque: strict
  single_bread: flexible
  single_sauce: flexible
```

⚠️ 需要為每個 product 加 `category`（例：`combo` / `single_basque` / `single_bread` / `single_sauce`）以便 lookup。

### 8.3 排程結果新型別

```typescript
type ScheduleSuggestion = {
  order_id: string
  suggested_date: string
  reason: string
  wish_priority: "strict" | "flexible" | null
  customer_wish_date: string | null      // 客人選的
  is_wish_kept: boolean                  // 有沒有滿足客人
  is_capacity_ok: boolean
  time_needed_hours: number
  capacity_used_hours: number             // 該日累積
  capacity_budget_hours: number           // 該日總預算
  overloads: { atomId: string; ... }[]
}
```

---

## 9. 憲章補丁

### 憲章 #13 (新增)：**指定日產能預留守恆律**

`assignment_source=customer_wish_kept` 且 `wish_priority=strict` 的訂單、pre-book 該日時間預算、其他訂單絕不能擠掉。

### 憲章 #12 修正：**時間預算超載守恆律**

原：某 atom 超過 daily_max → unscheduled
改：某週累積時間 > weekly budget → 依 FIFO push 到下週、或進 unscheduled 讓 Yen 介入

### 憲章 #14 (新增)：**最低前置期守恆律**

任何訂單 batchDate < order_date + 5 天、絕不能自動排入、必進 pending 讓 Yen 決定。

---

## 10. Confirm 進度

### ✅ 已 confirm (2026-07-03)
- §4 分軌策略：巴斯克 strict、麵包/磅蛋糕/堅果醬 flexible + FIFO

### ⏳ 待 Yen 逐項答覆

**10.1 資料補充**
- [ ] 蘋果 3 爐時間 = 10 hr（我推導）對嗎？
- [ ] 焦糖 3 爐時間 = 5.5 hr（我推導）對嗎？
- [ ] 磅蛋糕 2/3 爐時間 = 4 / 5.5 hr（我推導）對嗎？
- [ ] 巴斯克 2/3 爐時間 = 3.5 / 5.0 hr（我推導）對嗎？
- [ ] 4 爐+ 時間延續斜率（每爐 +3hr / +1.5hr）對嗎？還是會突然變慢？
- [ ] 巴斯克類是否**烤箱容量限制**（同時最多幾顆）？

**10.2 語意 confirm**
- [ ] batchDate = 週二為主、週三 fallback、對嗎？
- [ ] 賣貨便「指定出貨日」是**到貨日**還是**寄出日**？

**10.3 業務 confirm**
- [ ] 前置期 5 天合理嗎？還是 4 or 6？
- [ ] 超載時 FIFO push 之外、有沒有「特殊訂單保住」規則？例：金額 > $2000 保住？
- [ ] 週節奏 24-30 hr 是否有彈性？例：週四規劃時發現爆量、能否週二一起加工？

---

## 11. 實作 milestone (M6.5 或 M8)

| Step | 內容 | 估時 |
|---|---|---|
| M6.5-1 | 資料模型調整（menu.yaml + Order 新欄位 + parsers 更新） | 1 hr |
| M6.5-2 | 時間預算計算 pure function `estimateProductionHours()` | 1 hr |
| M6.5-3 | 新排程引擎 `suggestScheduleV2()`（RC-1+2+3 全套） | 2 hr |
| M6.5-4 | UI 升級 SchedulePanel 顯示新資訊 | 1.5 hr |
| M6.5-5 | verify-schedule-v2 script | 1 hr |
| M6.5-6 | 憲章 #13 #14 test cases | 0.5 hr |

**估總 7 hr**。動工前你 review + confirm 上述問題。
