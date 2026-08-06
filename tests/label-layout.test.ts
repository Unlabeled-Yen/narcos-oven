/**
 * #1 標籤 4cm×3cm 列印 — label-layout.ts 純函式驗證。
 * 見 docs/boss-issues-plan-2026-08.md 順位 3。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  labelLayout,
  pagesFor,
  truncateForLabel,
  LABEL_PRESETS,
  LABEL_PRESET_ORDER,
} from "../src/domain/label-layout.ts";
import { loadMenu } from "../src/domain/menu.ts";
import { extractLabels } from "../src/output/label-data.ts";
import { parseSellerBuy } from "../src/parsers/seller-buy.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

test("labelLayout('4x3cm') = 40mm × 30mm × 每頁 1 張，pageCss 含 size 40mm 30mm 與 margin 0", () => {
  const layout = labelLayout("4x3cm");
  assert.equal(layout.pageWidthMm, 40);
  assert.equal(layout.pageHeightMm, 30);
  assert.equal(layout.labelsPerPage, 1);
  assert.match(layout.pageCss, /size:\s*40mm\s+30mm/);
  assert.match(layout.pageCss, /margin:\s*0/);
});

test("XP-P3301B 約束：所有 preset 的字級 ≥ minFontPt(8)、字重 ≥ minFontWeight(600)", () => {
  for (const key of LABEL_PRESET_ORDER) {
    const layout = LABEL_PRESETS[key];
    for (const [line, pt] of Object.entries(layout.fontPt)) {
      assert.ok(
        pt >= layout.minFontPt,
        `${key} 的 ${line} 字級 ${pt}pt 小於下限 ${layout.minFontPt}pt`
      );
    }
    assert.ok(layout.minFontWeight >= 600, `${key} 的最低字重應 ≥ 600`);
  }
});

test("XP-P3301B 約束：4x3cm 安全邊 ≥ 1.5mm", () => {
  const layout = labelLayout("4x3cm");
  assert.ok(layout.safetyMarginMm >= 1.5);
});

test("未知 preset → 明確報錯（不是靜默回退到某個預設）", () => {
  // @ts-expect-error 刻意傳非法值測執行期防護
  assert.throws(() => labelLayout("9x9mm"), /未知標籤尺寸/);
});

test("頁數守恆：N 張標籤 → 恰 N 頁（一標一頁）", () => {
  const layout = labelLayout("4x3cm");
  assert.equal(pagesFor(0, layout), 0);
  assert.equal(pagesFor(1, layout), 1);
  assert.equal(pagesFor(5, layout), 5);
  assert.equal(pagesFor(37, layout), 37);
});

test("truncateForLabel：未超長字串原樣返回", () => {
  assert.equal(truncateForLabel("肉桂捲", 10), "肉桂捲");
  assert.equal(truncateForLabel("", 10), "");
});

test("truncateForLabel：超長字串補「…」且不超過 maxChars", () => {
  const long = "這是一個故意寫得非常非常長的品項名稱用來測試截斷邏輯是否正確運作";
  const result = truncateForLabel(long, 12);
  assert.ok(result.length <= 12, `截斷後長度 ${result.length} 超過上限 12`);
  assert.ok(result.endsWith("…"));
});

test("truncateForLabel 對抗測項：maxChars 極小值（≤1）也不崩潰、回傳單一刪節號", () => {
  assert.equal(truncateForLabel("肉桂捲", 1), "…");
  assert.equal(truncateForLabel("肉桂捲", 0), "…");
});

test("三個 preset 的 maxChars 都在合理範圍內、且 4x3cm 是三者中最保守（最小）的", () => {
  const small = LABEL_PRESETS["4x3cm"];
  const mid = LABEL_PRESETS["60x90mm"];
  const big = LABEL_PRESETS["75x120mm"];
  assert.ok(small.maxChars.mid <= mid.maxChars.mid);
  assert.ok(mid.maxChars.mid <= big.maxChars.mid);
});

test("整合：真實 fixture 展開的標籤數，經 pagesFor 算出的頁數 = 標籤陣列長度", () => {
  const menu = loadMenu(readFileSync(join(ROOT, "data/menu.yaml"), "utf-8"));
  const buf = readFileSync(join(ROOT, "fixtures/2026-07-round1/1.xlsx"));
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const { orders } = parseSellerBuy(arrayBuffer, "1.xlsx", menu);
  // fixture 沒有 batchDate（尚未排程），extractLabels 要求 batchDate 才收——
  // 手動補一個批次日期讓這條路徑有東西可展開，驗證的是 pagesFor 跟真實
  // extractLabels 輸出對得起來，不是 parser 本身的行為（那是黃金值基準的事）。
  const withBatch = orders
    .filter((o) => o.status === "confirmed")
    .slice(0, 5)
    .map((o) => ({ ...o, batchDate: "2026-08-11" }));
  const labels = extractLabels(withBatch, menu, { batchDate: "2026-08-11" });
  const layout = labelLayout("4x3cm");
  assert.equal(pagesFor(labels.length, layout), labels.length);
});
