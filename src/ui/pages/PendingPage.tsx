import type { PageProps } from "./types";
import { PageStub } from "./PageStub";

// P2 subagent：待處理桶 + 鍵盤優先（J/K/1-9/Enter/Backspace）。接既有 PendingBucket 邏輯。
export function PendingPage(_props: PageProps) {
  return (
    <PageStub
      caption="PENDING · 主軌一等公民出口"
      title="PENDING BUCKET"
      phase="P2"
      note="reason chips + 鍵盤導覽 + 產出閘門（憲章 #9）"
    />
  );
}
