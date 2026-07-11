import { useCallback, useEffect, useRef, useState } from "react";
import type { Menu, Order } from "../domain/models";
import { GrainOverlay } from "./brand/GrainOverlay";
import { WarningTape } from "./brand/WarningTape";
import { CommandBar, type NavKey, type NavItem } from "./brand/CommandBar";
import { GoogleSheetSyncModal } from "./GoogleSheetSyncModal";
import type { PageProps } from "./pages/types";

import { DashboardPage } from "./pages/DashboardPage";
import { SchedulePage } from "./pages/SchedulePage";
import { PendingPage } from "./pages/PendingPage";
import { OrdersPage } from "./pages/OrdersPage";
import { MenuEditorPage } from "./pages/MenuEditorPage";
import { PayoutPage } from "./pages/PayoutPage";
import { StatsMatrixPage } from "./pages/StatsMatrixPage";
import { KolPage } from "./pages/KolPage";
import { LabelsPage } from "./pages/LabelsPage";
import { WorksheetPage } from "./pages/WorksheetPage";
import { ManualOrderPage } from "./pages/ManualOrderPage";
import { PrintLabelsPage } from "./pages/PrintLabelsPage";
import { ShopsPage } from "./pages/ShopsPage";
import { ShopPayoutPage } from "./pages/ShopPayoutPage";

// capacity page 已依 Yen 決策拿掉（不需工時計算、不需產能上限）
// NavKey.capacity 若被 hash routing 誤觸、fallback 到 dashboard
const PAGES: Record<Exclude<NavKey, "capacity">, (p: PageProps) => JSX.Element> = {
  dashboard: DashboardPage,
  schedule: SchedulePage,
  pending: PendingPage,
  orders: OrdersPage,
  menu: MenuEditorPage,
  payout: PayoutPage,
  stats: StatsMatrixPage,
  kol: KolPage,
  labels: LabelsPage,
  worksheet: WorksheetPage,
  manual: ManualOrderPage,
  "print-labels": PrintLabelsPage,
  shops: ShopsPage,
  "shop-payout": ShopPayoutPage,
};

const ALL_KEYS = Object.keys(PAGES) as NavKey[];

function keyFromHash(): NavKey {
  const m = /^#\/([a-z-]+)$/.exec(window.location.hash);
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
  onSheetSync: (sheetUrlOrId: string) => Promise<{ orderCount: number }>;
  error?: string | null;
};

export function AppShell({
  orders,
  menu,
  refreshOrders,
  pendingCount,
  syncLabel,
  onFiles,
  onSheetSync,
  error,
}: Props) {
  const [active, setActive] = useState<NavKey>(keyFromHash);
  const [sheetSyncOpen, setSheetSyncOpen] = useState(false);
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
    { key: "manual", label: "手打單" },
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
      { key: "shop-payout", label: "駐店對帳" },
    ],
    schedule: [
      { key: "schedule", label: "排程系統" },
      { key: "worksheet", label: "當週工單" },
      { key: "labels", label: "出貨明細" },
      { key: "print-labels", label: "印標籤" },
    ],
    menu: [
      { key: "menu", label: "品項" },
      { key: "shops", label: "駐店店家" },
    ],
  };
  // 次頁 → 所屬主項
  const GROUP_OF: Partial<Record<NavKey, NavKey>> = {
    dashboard: "dashboard", payout: "dashboard", stats: "dashboard", kol: "dashboard", "shop-payout": "dashboard",
    schedule: "schedule", worksheet: "schedule", labels: "schedule", "print-labels": "schedule",
    menu: "menu", shops: "menu",
  };
  const activeGroup = GROUP_OF[active] ?? active;
  const subItems = SUBNAV[activeGroup] ?? null;

  // capacity 已停用、fallback 回 dashboard 避免 hash 誤觸崩掉
  const ActivePage = active === "capacity" ? PAGES.dashboard : PAGES[active as Exclude<NavKey, "capacity">];
  const pageProps: PageProps = {
    orders,
    menu,
    refreshOrders,
    navigate,
    active,
    onUploadClick,
  };

  // Yen 2026-07-04：只在「檔案拖曳」時 preventDefault
  //   舊法無條件 preventDefault → 訂單卡拖曳到 AppShell 也被 accept
  //   → dropEffect="move" 而非 "none" → SchedulePage 的 onDragEnd 判斷失敗
  //   → 「拖到 nav / 外框退回 pending」功能失效
  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const onDragOverRoot = (e: React.DragEvent) => {
    if (isFileDrag(e)) e.preventDefault();
  };
  const onDrop = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
  };

  return (
    <div
      className="relative h-screen flex flex-col bg-narcos-bg font-notoTc overflow-hidden"
      onDragOver={onDragOverRoot}
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
      <div className="relative z-10 mx-auto w-full flex-1 min-h-0 flex flex-col" style={{ maxWidth: 1560 }}>
        <CommandBar
          nav={nav}
          active={activeGroup}
          onNav={navigate}
          syncLabel={syncLabel}
          right={
            <div className="flex items-center" style={{ gap: 6 }}>
              <button
                type="button"
                onClick={() => setSheetSyncOpen(true)}
                title="連線 Google Sheet · 拉最新面交問卷回覆"
                className="font-notoTc font-black text-[12px] px-4 py-2 cursor-pointer inline-flex items-center gap-[7px]"
                style={{ color: "#111", background: "#43B23C" }}
              >
                🔗 Sheet 同步
              </button>
              <button
                type="button"
                onClick={onUploadClick}
                className="font-notoTc font-black text-[12px] text-[#111] bg-narcos-ink px-4 py-2 cursor-pointer inline-flex items-center gap-[7px]"
              >
                ＋ 拖檔上傳
              </button>
            </div>
          }
        />
        {sheetSyncOpen && (
          <GoogleSheetSyncModal
            onClose={() => setSheetSyncOpen(false)}
            onSync={onSheetSync}
          />
        )}
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
          <div className="mx-6 mt-4 bg-narcos-redTint border border-narcos-red p-3 font-mono text-[12px] text-narcos-red flex-none">
            {error}
          </div>
        )}

        {/* 內容區：填滿剩餘視窗高、由各頁自控內部滾動（header/nav 永遠固定） */}
        <main className="flex-1 min-h-0 overflow-hidden">
          <ActivePage {...pageProps} />
        </main>
      </div>
    </div>
  );
}
