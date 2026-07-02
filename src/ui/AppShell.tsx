import { useCallback, useEffect, useRef, useState } from "react";
import type { Menu, Order } from "../domain/models";
import { GrainOverlay } from "./brand/GrainOverlay";
import { WarningTape } from "./brand/WarningTape";
import { CommandBar, type NavKey, type NavItem } from "./brand/CommandBar";
import type { PageProps } from "./pages/types";

import { DashboardPage } from "./pages/DashboardPage";
import { SchedulePage } from "./pages/SchedulePage";
import { PendingPage } from "./pages/PendingPage";
import { OrdersPage } from "./pages/OrdersPage";
import { MenuEditorPage } from "./pages/MenuEditorPage";
import { PayoutPage } from "./pages/PayoutPage";
import { StatsMatrixPage } from "./pages/StatsMatrixPage";
import { KolPage } from "./pages/KolPage";
import { CapacityPage } from "./pages/CapacityPage";
import { LabelsPage } from "./pages/LabelsPage";

const PAGES: Record<NavKey, (p: PageProps) => JSX.Element> = {
  dashboard: DashboardPage,
  schedule: SchedulePage,
  pending: PendingPage,
  orders: OrdersPage,
  menu: MenuEditorPage,
  payout: PayoutPage,
  stats: StatsMatrixPage,
  kol: KolPage,
  capacity: CapacityPage,
  labels: LabelsPage,
};

const ALL_KEYS = Object.keys(PAGES) as NavKey[];

function keyFromHash(): NavKey {
  const m = /^#\/([a-z]+)$/.exec(window.location.hash);
  const k = m?.[1] as NavKey | undefined;
  return k && ALL_KEYS.includes(k) ? k : "dashboard";
}

type Props = {
  orders: Order[];
  menu: Menu;
  refreshOrders: () => Promise<void>;
  pendingCount: number;
  syncLabel?: string;
  onFiles: (files: FileList) => void;
  error?: string | null;
};

export function AppShell({
  orders,
  menu,
  refreshOrders,
  pendingCount,
  syncLabel,
  onFiles,
  error,
}: Props) {
  const [active, setActive] = useState<NavKey>(keyFromHash);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onHash = () => setActive(keyFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((key: NavKey) => {
    window.location.hash = `#/${key}`;
    setActive(key);
  }, []);

  const onUploadClick = useCallback(() => fileInputRef.current?.click(), []);

  const nav: NavItem[] = [
    { key: "dashboard", label: "儀表板" },
    { key: "schedule", label: "排程" },
    { key: "pending", label: "待處理", badge: pendingCount },
    { key: "orders", label: "訂單總覽" },
    { key: "menu", label: "菜單" },
  ];

  // 情境子分頁：主項底下掛的次頁
  //   儀表板 → 分潤 / 出爐統計 / KOL
  //   排程   → 產能設定 / 出貨標籤
  const SUBNAV: Partial<Record<NavKey, { key: NavKey; label: string }[]>> = {
    dashboard: [
      { key: "dashboard", label: "總覽" },
      { key: "payout", label: "分潤統計" },
      { key: "stats", label: "出爐統計" },
      { key: "kol", label: "KOL ROI" },
    ],
    schedule: [
      { key: "schedule", label: "週排程" },
      { key: "capacity", label: "產能設定" },
      { key: "labels", label: "出貨標籤" },
    ],
  };
  // 次頁 → 所屬主項
  const GROUP_OF: Partial<Record<NavKey, NavKey>> = {
    dashboard: "dashboard", payout: "dashboard", stats: "dashboard", kol: "dashboard",
    schedule: "schedule", capacity: "schedule", labels: "schedule",
  };
  const activeGroup = GROUP_OF[active] ?? active;
  const subItems = SUBNAV[activeGroup] ?? null;

  const ActivePage = PAGES[active];
  const pageProps: PageProps = {
    orders,
    menu,
    refreshOrders,
    navigate,
    active,
    onUploadClick,
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
  };

  return (
    <div
      className="relative min-h-screen bg-narcos-bg font-notoTc overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <GrainOverlay />
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="relative z-10 mx-auto" style={{ maxWidth: 1560 }}>
        <CommandBar
          nav={nav}
          active={activeGroup}
          onNav={navigate}
          syncLabel={syncLabel}
          right={
            <button
              type="button"
              onClick={onUploadClick}
              className="font-notoTc font-black text-[12px] text-[#111] bg-narcos-ink px-4 py-2 cursor-pointer inline-flex items-center gap-[7px]"
            >
              ＋ 拖檔上傳
            </button>
          }
        />
        <WarningTape />

        {/* 情境子分頁列：只在有子頁的主項（儀表板 / 排程）底下出現 */}
        {subItems && (
          <div className="flex items-center gap-1 flex-wrap px-6 py-2 border-b border-narcos-line2 bg-[#0A0A0C]">
            {subItems.map((item) => {
              const isActive = item.key === active;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigate(item.key)}
                  className={`font-notoTc font-bold text-[12px] px-3 py-[5px] cursor-pointer ${
                    isActive ? "text-[#111]" : "text-narcos-mut hover:text-narcos-ink"
                  }`}
                  style={isActive ? { background: "var(--acc, #F5D400)" } : undefined}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <div className="mx-6 mt-4 bg-narcos-redTint border border-narcos-red p-3 font-mono text-[12px] text-narcos-red">
            {error}
          </div>
        )}

        <ActivePage {...pageProps} />
      </div>
    </div>
  );
}
