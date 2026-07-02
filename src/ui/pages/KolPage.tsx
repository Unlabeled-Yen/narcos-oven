import type { PageProps } from "./types";
import { PageStub } from "./PageStub";

// P3 subagent：KOL ROI。對應 MCP kol_roi_analysis 的 domain 計算。
export function KolPage(_props: PageProps) {
  return (
    <PageStub
      caption="KOL · ROI 分析"
      title="KOL ROI"
      phase="P3"
      note="合作/成本/帶單/ROI 明細表 + ROI 冠軍榜 + Claude Code 洞察（附 sourceOrderIds）"
    />
  );
}
