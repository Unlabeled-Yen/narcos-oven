import type { PageProps } from "./types";
import { PageStub } from "./PageStub";

// P2 subagent：全通路訂單台帳 + 即時篩選（通路/狀態 chips + 搜尋）+ 出貨總覽批次卡。
export function OrdersPage(_props: PageProps) {
  return (
    <PageStub
      caption="ORDERS · 全通路訂單台帳"
      title="ORDER LEDGER"
      phase="P2"
      note="搜尋 + 通路/狀態 chips + 批次卡過濾 + 金額對帳（#2）"
    />
  );
}
