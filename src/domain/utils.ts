/**
 * 憲章原則 1 的核心工具：安全 numeric cast。
 *
 * Excel 常把數字存成字串（'2' 而非 2）；直接 isinstance(int) 檢查會靜默失效。
 * 所有 numeric 欄位必經此 helper。
 *
 * @param v 任何值
 * @returns number 或 null（無法轉換時）
 */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v === "string") {
    // 剝掉：貨幣符號（半形/全形 $、¥、NT$）、千分位逗號、全形空白、
    //   trailing 「元」單位 —— 這些都是人手填的裝飾字，數字語意不變。
    //   Yen 2026-07-19：詹易臻面交單 c23="$640"（帶錢字號），原本 Number("$640")=NaN
    //   → grossTotal 掉成 0 → 金額一致亮橘燈誤報。走 strip 後 640 正確入帳。
    const cleaned = v
      .replace(/NT\$/gi, "")
      .replace(/[$＄¥,　]/g, "")
      .replace(/元\s*$/g, "")
      .trim();
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 判斷字串（trim 後）是否非空。 */
export function isNonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
