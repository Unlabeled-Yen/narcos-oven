/**
 * menu-lookup.ts · SKU lookup 統一入口 + assertion
 *
 * Yen 2026-07-04：面交蘋果肉桂捲被 hardcoded table 錯歸經典事件
 *   Root cause：match 邏輯靜默選第一個候選、不 loud 標記衝突
 *
 * 新機制 · lookupSkuStrict 回 discriminated union：
 *   - found:     唯一命中、放心用
 *   - none:      找不到、進 pending_product「未識別」
 *   - ambiguous: 多個候選、進 pending_product「衝突」· 附候選清單
 *
 * 三個 parser（賣貨便 / 面交 / KOL）都改用這個 · 靜默失效根治
 */
import type { Menu } from "./models";

export type LookupResult =
  | { kind: "found"; skuId: string; via: "alias" | "signature" }
  | { kind: "none" }
  | { kind: "ambiguous"; candidates: string[]; reason: string };

/**
 * 依 raw name 查 SKU · 命中多個時 loud fail（不再靜默選第一個）
 * @param rawName 例：賣貨便 c12 字串、面交 c17-c20 header、KOL c5 品項
 */
export function lookupSkuStrict(rawName: string, menu: Menu): LookupResult {
  const trimmed = rawName.trim();

  // Step 1 · alias / display_name exact match
  const aliasMatches: string[] = [];
  for (const [skuId, product] of Object.entries(menu.products)) {
    if (product.aliases.includes(trimmed) || product.display_name === trimmed) {
      aliasMatches.push(skuId);
    }
  }
  if (aliasMatches.length === 1) {
    return { kind: "found", skuId: aliasMatches[0]!, via: "alias" };
  }
  if (aliasMatches.length > 1) {
    return {
      kind: "ambiguous",
      candidates: aliasMatches,
      reason: `多個 SKU 都設此 alias/display_name「${trimmed}」`,
    };
  }

  // Step 2 · match_signature（include all + exclude none）
  const sigMatches: Array<{ skuId: string; score: number }> = [];
  for (const [skuId, product] of Object.entries(menu.products)) {
    const sig = product.match_signature;
    if (sig.include.length === 0) continue;
    const allInclude = sig.include.every((k) => trimmed.includes(k));
    const anyExclude = sig.exclude.some((k) => trimmed.includes(k));
    if (allInclude && !anyExclude) {
      // score = include 關鍵字總長度（越具體越優先）
      const score = sig.include.reduce((s, k) => s + k.length, 0);
      sigMatches.push({ skuId, score });
    }
  }
  if (sigMatches.length === 0) return { kind: "none" };

  sigMatches.sort((a, b) => b.score - a.score);
  const topScore = sigMatches[0]!.score;
  const tied = sigMatches.filter((m) => m.score === topScore);

  if (tied.length > 1) {
    return {
      kind: "ambiguous",
      candidates: tied.map((m) => m.skuId),
      reason: `多個 SKU 的 match_signature 同分（score ${topScore}）· 需在 menu.yaml 調整 include/exclude 讓 signature 更具體`,
    };
  }
  return { kind: "found", skuId: tied[0]!.skuId, via: "signature" };
}

/**
 * Legacy adapter · 保持向後相容
 * ambiguous 也 return null（不再靜默選第一個）· 呼叫端會走 UNKNOWN_PRODUCT
 * 但推薦直接改用 lookupSkuStrict 拿更好的 pending reason
 */
export function lookupSkuOrNull(rawName: string, menu: Menu): string | null {
  const r = lookupSkuStrict(rawName, menu);
  return r.kind === "found" ? r.skuId : null;
}
