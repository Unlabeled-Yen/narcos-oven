/**
 * menu-lint.ts · Menu 靜態檢查 · 啟動時發現 alias/signature 衝突
 *
 * Yen 2026-07-04 · 根治靜默 match 失效第二層防禦：
 *   - alias exact 衝突：同一字串存在於多個 SKU
 *   - signature 反向不唯一：SKU 的 display_name / alias 反向 lookup 得到別的 SKU
 *   - shadowing：alias A 是 alias B 的子字串（可能造成子字串誤命中）
 *
 * App 啟動時跑一次 · console.warn 全部 · dev mode 可 loud modal
 */
import type { Menu } from "./models";
import { lookupSkuStrict } from "./menu-lookup";

export type LintCode =
  | "ALIAS_DUPLICATE"     // 同一 alias 字串存在於多個 SKU
  | "REVERSE_LOOKUP_FAIL" // display_name / alias 反向 lookup 拿到別的 SKU
  | "REVERSE_LOOKUP_AMBIGUOUS" // 反向 lookup ambiguous
  | "ALIAS_SHADOWING";    // alias A 是 alias B 子字串（不同 SKU）

export type LintWarning = {
  code: LintCode;
  severity: "warn" | "critical";
  message: string;
  affects: string[];
};

export function lintMenu(menu: Menu): LintWarning[] {
  const warnings: LintWarning[] = [];

  // 1 · Alias exact 衝突（同一字串多個 SKU）
  const aliasMap = new Map<string, string[]>();
  for (const [skuId, p] of Object.entries(menu.products)) {
    const keys = [...p.aliases, p.display_name];
    for (const a of keys) {
      const arr = aliasMap.get(a) ?? [];
      arr.push(skuId);
      aliasMap.set(a, arr);
    }
  }
  for (const [alias, skus] of aliasMap) {
    if (skus.length > 1) {
      warnings.push({
        code: "ALIAS_DUPLICATE",
        severity: "critical",
        message: `alias「${alias}」同時存在於 ${skus.length} 個 SKU：${skus.join(", ")}`,
        affects: skus,
      });
    }
  }

  // 2 · 反向 lookup 檢查 · 每個 SKU 的 display_name + alias 都試著 lookup 回自己
  for (const [skuId, p] of Object.entries(menu.products)) {
    const testStrings = [p.display_name, ...p.aliases];
    for (const raw of testStrings) {
      const r = lookupSkuStrict(raw, menu);
      if (r.kind === "ambiguous") {
        warnings.push({
          code: "REVERSE_LOOKUP_AMBIGUOUS",
          severity: "critical",
          message: `SKU「${skuId}」的字串「${raw}」lookup ambiguous · ${r.reason} · 候選 ${r.candidates.join(", ")}`,
          affects: r.candidates,
        });
      } else if (r.kind === "found" && r.skuId !== skuId) {
        warnings.push({
          code: "REVERSE_LOOKUP_FAIL",
          severity: "critical",
          message: `SKU「${skuId}」的字串「${raw}」反向 lookup 得到「${r.skuId}」（不是自己）· 命中方式：${r.via}`,
          affects: [skuId, r.skuId],
        });
      }
    }
  }

  // 3 · Alias shadowing · A 是 B 子字串（不同 SKU · Step 2 signature 可能誤命中）
  const allAliases: Array<{ skuId: string; alias: string }> = [];
  for (const [skuId, p] of Object.entries(menu.products)) {
    for (const a of p.aliases) allAliases.push({ skuId, alias: a });
  }
  for (const a of allAliases) {
    for (const b of allAliases) {
      if (a.skuId === b.skuId) continue;
      if (a.alias.length >= b.alias.length) continue;
      if (b.alias.includes(a.alias)) {
        warnings.push({
          code: "ALIAS_SHADOWING",
          severity: "warn",
          message: `alias「${a.alias}」(SKU ${a.skuId}) 是「${b.alias}」(SKU ${b.skuId}) 的子字串 · signature match 時可能被 b 遮蔽 a`,
          affects: [a.skuId, b.skuId],
        });
      }
    }
  }

  return warnings;
}

/** Console 印出 lint 結果（開發輔助） */
export function logLintWarnings(warnings: LintWarning[]): void {
  if (warnings.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[menu-lint] ✓ menu.yaml 無 SKU lookup 衝突");
    return;
  }
  const critical = warnings.filter((w) => w.severity === "critical");
  const warn = warnings.filter((w) => w.severity === "warn");
  // eslint-disable-next-line no-console
  console.warn(
    `[menu-lint] ⚠ 發現 ${warnings.length} 個問題（${critical.length} critical / ${warn.length} warn）· 靜默 SKU 誤匹配風險`
  );
  for (const w of warnings) {
    const tag = w.severity === "critical" ? "🔴 CRITICAL" : "🟡 WARN";
    // eslint-disable-next-line no-console
    console.warn(`  ${tag} [${w.code}] ${w.message}`);
  }
}
