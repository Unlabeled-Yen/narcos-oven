import type { PageProps } from "./types";
import { PageStub } from "./PageStub";

// P3 subagent：菜單編輯（menu.yaml 唯一真相）+ Claude Code 建議新 SKU diff。
export function MenuEditorPage(_props: PageProps) {
  return (
    <PageStub
      caption="MENU · menu.yaml 唯一真相"
      title="MENU EDITOR"
      phase="P3"
      note="SKU 清單 + 編輯器（contains/match_signature/aliases）+ Claude Code diff"
    />
  );
}
