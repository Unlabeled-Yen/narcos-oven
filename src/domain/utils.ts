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
    const cleaned = v.replace(/,/g, "").trim();
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
