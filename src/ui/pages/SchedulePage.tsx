import type { PageProps } from "./types";
import { PageStub } from "./PageStub";

// P4（Opus 親做）：週檢視 + HTML5 拖拉排單 + 憲章 #11/#12/#14。
export function SchedulePage(_props: PageProps) {
  return (
    <PageStub
      caption="SCHEDULE · 出貨日回推備料"
      title="WEEK GRID"
      phase="P4"
      note="7 欄週檢視 + 拖拉排單 + assignment_source=boss_scheduled"
    />
  );
}
