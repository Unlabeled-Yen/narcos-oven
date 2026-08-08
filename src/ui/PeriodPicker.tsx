/**
 * 期間選擇器：全部 / 年 / 季 / 月
 */
import { useMemo } from "react";
import type { Period } from "../domain/period";
import { getAvailablePeriods, periodLabel } from "../domain/period";
import { loadDayOverrides, makeDayTypeOf } from "../domain/day-type";
import type { Menu, Order } from "../domain/models";

export function PeriodPicker({
  orders,
  menu,
  period,
  onChange,
}: {
  orders: Order[];
  menu: Menu;
  period: Period;
  onChange: (p: Period) => void;
}) {
  // #6 2026-08-06：期間下拉一律用有效出貨日算可選年月，跟其他頁一致
  const dayTypeOf = useMemo(() => makeDayTypeOf(menu, loadDayOverrides()), [menu]);
  const avail = useMemo(() => getAvailablePeriods(orders, dayTypeOf), [orders, dayTypeOf]);
  const currentYear = new Date().getFullYear();
  const years = avail.years.length > 0 ? avail.years : [currentYear];

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-600">📅 期間：</span>
      <select
        value={period.type}
        onChange={(e) => {
          const type = e.target.value as Period["type"];
          if (type === "all") onChange({ type: "all" });
          else if (type === "year") onChange({ type: "year", year: years[years.length - 1]! });
          else if (type === "quarter") onChange({ type: "quarter", year: years[years.length - 1]!, quarter: 3 });
          else onChange({ type: "month", year: years[years.length - 1]!, month: new Date().getMonth() + 1 });
        }}
        className="px-2 py-1 border rounded"
      >
        <option value="all">全部</option>
        <option value="year">年</option>
        <option value="quarter">季</option>
        <option value="month">月</option>
      </select>

      {period.type !== "all" && (
        <select
          value={period.year}
          onChange={(e) => onChange({ ...period, year: parseInt(e.target.value, 10) } as Period)}
          className="px-2 py-1 border rounded"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      )}

      {period.type === "month" && (
        <select
          value={period.month}
          onChange={(e) => onChange({ ...period, month: parseInt(e.target.value, 10) } as Period)}
          className="px-2 py-1 border rounded"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, "0")} 月
            </option>
          ))}
        </select>
      )}

      {period.type === "quarter" && (
        <select
          value={period.quarter}
          onChange={(e) => onChange({ ...period, quarter: parseInt(e.target.value, 10) } as Period)}
          className="px-2 py-1 border rounded"
        >
          {[1, 2, 3, 4].map((q) => (
            <option key={q} value={q}>
              Q{q}
            </option>
          ))}
        </select>
      )}

      <span className="text-gray-400 text-xs">→ 標籤：{periodLabel(period)}</span>
    </div>
  );
}
