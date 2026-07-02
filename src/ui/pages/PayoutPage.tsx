import type { PageProps } from "./types";
import { PageStub } from "./PageStub";

// P2 subagent：分潤統計（總+淨並列）。抽 payout-excel.ts 的 compute 成 pure function。
export function PayoutPage(_props: PageProps) {
  return (
    <PageStub
      caption="PAYOUT · 總 + 淨並列"
      title="PROFIT SPLIT"
      phase="P2"
      note="總營收 vs 淨利瀑布 + 各通路分潤表（切換總/淨）+ 憲章 #2 對帳"
    />
  );
}
