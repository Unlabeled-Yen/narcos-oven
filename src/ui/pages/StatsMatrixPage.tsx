import type { PageProps } from "./types";
import { PageStub } from "./PageStub";

// P2 subagent：出爐統計表（品項×批次×合計 樞紐）。抽 stats-excel.ts 的 compute 成 pure function。
export function StatsMatrixPage(_props: PageProps) {
  return (
    <PageStub
      caption="PRODUCTION · 品項 × 批次 樞紐"
      title="OVEN MATRIX"
      phase="P2"
      note="atom × 批次矩陣 + 熱區 highlight + 批次總顆列 + 憲章 #3 雙軌驗證"
    />
  );
}
