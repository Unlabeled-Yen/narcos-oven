import type { PageProps } from "./types";
import { PageStub } from "./PageStub";

// P5 subagent：出貨標籤（熱感紙預覽、故意淺色對比）。接 label-data/label-renderer。
export function LabelsPage(_props: PageProps) {
  return (
    <PageStub
      caption="LABELS · 熱感紙出貨標籤"
      title="SHIP LABELS"
      phase="P5"
      note="淺色熱感紙預覽 + FRAGILE 印章 + 尺寸切換 + 印出即凍結（憲章 #10）"
    />
  );
}
