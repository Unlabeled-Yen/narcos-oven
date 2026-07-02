import type { PageProps } from "./types";
import { PageStub } from "./PageStub";

// P2 subagent：整檔覆蓋。接 domain compute（DashboardPanel.tsx 的 compute* + getAll()），
// 視覺 1:1 參考 DashboardPage.demo.tsx，禁 hardcode 數字。
export function DashboardPage(_props: PageProps) {
  return (
    <PageStub
      caption="DASHBOARD · 跨批統計"
      title="OVEN CENTRAL"
      phase="P2"
      note="接 DashboardPanel 的 compute*，視覺參考 DashboardPage.demo.tsx"
    />
  );
}
