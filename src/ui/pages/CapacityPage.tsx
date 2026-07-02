import type { PageProps } from "./types";
import { PageStub } from "./PageStub";

// P3 subagent：產能設定（menu.yaml production_capacity 讀寫）。
export function CapacityPage(_props: PageProps) {
  return (
    <PageStub
      caption="CAPACITY · 每日產能上限"
      title="CAPACITY"
      phase="P3"
      note="daily_max_by_atom 編輯 + weekly_pattern 倍率 + 週工時預算 + 前置期"
    />
  );
}
