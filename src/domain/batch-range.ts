/**
 * batch-range.ts · 出貨批次 range 計算
 *
 * Yen 2026-07-03：一個批次的單位 = 從上一個 shipping 之後 → 這週工作日 → 到最後 shipping
 *   可含上週六日的工作日（跨週）· rest 跳過但繼續掃
 *
 * 演算法：從 anchor（本週最後 ship）往前掃、狀態機：
 *   sawWork=false: 遇 ship 納入（連續 ship 段）· 遇 work 納入 + sawWork=true · 遇 rest 跳過
 *   sawWork=true:  遇 ship break（前一批 anchor）· 遇 work 納入 · 遇 rest 跳過
 *
 * 共用給 SchedulePage / WorksheetPage / LabelsPage
 */
export type DayType = "ship" | "work" | "rest";

/** 計算 anchor 為 rangeAnchor 那批的完整 range ISO 陣列（升序、含 anchor） */
export function computeBatchRange(
  anchorISO: string,
  dayTypeOf: (iso: string) => DayType,
  maxLookback = 30
): string[] {
  if (!anchorISO) return [];
  const range: string[] = [anchorISO];
  let sawWork = false;
  const d = new Date(anchorISO);
  for (let i = 1; i < maxLookback; i++) {
    d.setDate(d.getDate() - 1);
    const iso = toISO(d);
    const t = dayTypeOf(iso);
    if (t === "ship") {
      if (sawWork) break;
      range.unshift(iso);
      continue;
    }
    if (t === "work") {
      range.unshift(iso);
      sawWork = true;
      continue;
    }
    // rest: 跳過但繼續
  }
  return range;
}

/** 在指定 week ISO 陣列中找「本週最後 shipping day」為 anchor · 沒有則 null */
export function findWeekAnchor(
  weekISO: string[],
  dayTypeOf: (iso: string) => DayType
): string | null {
  const ships = weekISO.filter((iso) => dayTypeOf(iso) === "ship");
  return ships.length === 0 ? null : ships[ships.length - 1]!;
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
