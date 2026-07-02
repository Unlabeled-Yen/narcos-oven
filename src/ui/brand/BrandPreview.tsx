import { useState } from "react";
import { GrainOverlay } from "./GrainOverlay";
import { WarningTape } from "./WarningTape";
import { NarcosPill } from "./NarcosPill";
import { StatusDot } from "./StatusDot";
import { Panel } from "./Panel";
import { KpiCard } from "./KpiCard";
import { CommandBar, type NavKey, type NavItem } from "./CommandBar";
import { PageHeader, PeriodChips } from "./PageHeader";

const NAV: NavItem[] = [
  { key: "dashboard", label: "儀表板" },
  { key: "schedule", label: "排程" },
  { key: "pending", label: "待處理", badge: 17 },
  { key: "orders", label: "訂單總覽" },
  { key: "menu", label: "菜單" },
];

const PERIODS = [
  { key: "june", label: "六月" },
  { key: "8w", label: "近 8 週" },
  { key: "all", label: "全部" },
];

export function BrandPreview() {
  const [active, setActive] = useState<NavKey>("dashboard");
  const [period, setPeriod] = useState("8w");

  return (
    <div className="relative min-h-screen bg-narcos-bg font-notoTc overflow-hidden">
      <GrainOverlay />
      <div className="relative z-10 max-w-[1560px] mx-auto">
        <CommandBar
          nav={NAV}
          active={active}
          onNav={setActive}
          syncLabel="SYNC 07/03 09:12"
          right={
            <span className="font-notoTc font-black text-[12px] text-[#111] bg-narcos-ink px-4 py-2 cursor-pointer inline-flex items-center gap-[7px]">
              ＋ 拖檔上傳
            </span>
          }
        />

        <WarningTape />

        <PageHeader
          caption="BRAND PREVIEW · P0 底層驗證"
          title="OVEN CENTRAL"
          right={<PeriodChips options={PERIODS} active={period} onChange={setPeriod} />}
        />

        <section className="px-6 py-4">
          <div className="font-mono text-[11px] text-narcos-mut3 tracking-wideCaps mb-3">
            KPI CARDS · 6 種 accent
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <KpiCard
              label="本批出爐 · 07/07"
              accent="acc"
              footer="+31 蘋果 · +12 巴斯克 · +7 磅"
            >
              <div className="flex items-baseline gap-[7px]">
                <span className="font-anton text-[42px] text-narcos-ink leading-[.85]">170</span>
                <span className="font-notoTc font-black text-[14px] text-narcos-mut">顆肉桂捲</span>
              </div>
            </KpiCard>
            <KpiCard label="CONFIRMED" accent="green" footer="主軌通過">
              <div className="font-anton text-[42px] text-narcos-ink leading-[.85]">88</div>
            </KpiCard>
            <KpiCard label="待處理桶" accent="orange" footer="標籤未定">
              <div className="font-anton text-[42px] text-narcos-orange leading-[.85]">17</div>
            </KpiCard>
            <KpiCard label="消失待拍板" accent="green" footer="✓ 可產出">
              <div className="font-anton text-[42px] text-narcos-ink leading-[.85]">0</div>
            </KpiCard>
            <KpiCard label="冷藏批次" accent="cyan" footer="週日烤磅">
              <div className="font-anton text-[42px] text-narcos-cyan leading-[.85]">3</div>
            </KpiCard>
            <KpiCard label="KOL 帶單" accent="purple" footer="ROI 5.3×">
              <div className="font-anton text-[42px] text-narcos-purple leading-[.85]">42</div>
            </KpiCard>
          </div>
        </section>

        <section className="px-6 py-4">
          <div className="font-mono text-[11px] text-narcos-mut3 tracking-wideCaps mb-3">
            PANEL + STATUS DOTS + WARNING TAPE (sm/md)
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
            <Panel>
              <div className="font-notoTc font-black text-[17px] text-narcos-ink mb-4">
                狀態燈盤
              </div>
              <div className="flex flex-col gap-[11px]">
                {(["green", "orange", "red", "cyan", "acc"] as const).map((c) => (
                  <div key={c} className="flex items-center gap-[10px]">
                    <StatusDot color={c} />
                    <span className="font-notoTc font-bold text-[13px] text-narcos-ink3">
                      color = {c}
                    </span>
                    <StatusDot color={c} blink={false} />
                    <span className="font-mono text-[11px] text-narcos-mut2">no-blink</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel>
              <div className="font-notoTc font-black text-[17px] text-narcos-ink mb-4">
                警示膠帶
              </div>
              <div className="font-mono text-[10px] text-narcos-mut3 mb-2">size = md (16/32px)</div>
              <WarningTape size="md" />
              <div className="font-mono text-[10px] text-narcos-mut3 mt-4 mb-2">size = sm (14/28px)</div>
              <WarningTape size="sm" />
              <div className="mt-6 pt-4 border-t border-narcos-line">
                <div className="font-mono text-[10px] text-narcos-mut3 mb-2">NARCOS pill 獨立</div>
                <NarcosPill />
              </div>
            </Panel>
          </div>
        </section>

        <section className="px-6 py-4 pb-16">
          <div className="font-mono text-[11px] text-narcos-mut3 tracking-wideCaps mb-3">
            排版字重驗證
          </div>
          <Panel>
            <div className="font-anton text-[64px] text-narcos-ink leading-none">
              ANTON 64
            </div>
            <div className="font-notoTc font-black text-[24px] text-narcos-ink mt-2">
              Noto Sans TC 900 · 品牌超粗黑
            </div>
            <div className="font-notoTc font-bold text-[16px] text-narcos-ink3 mt-1">
              Noto Sans TC 700 · 訊息用
            </div>
            <div className="font-notoTc font-medium text-[14px] text-narcos-mut mt-1">
              Noto Sans TC 500 · 內文用
            </div>
            <div className="font-mono text-[13px] text-narcos-ink3 mt-2">
              Space Mono 400 · CM2606190394389 · 07/07 · $41,600
            </div>
            <div className="font-mono font-bold text-[13px] text-[color:var(--acc,#F5D400)] mt-1">
              Space Mono 700 · 主色 var(--acc)
            </div>
          </Panel>
        </section>

        <WarningTape size="sm" />
        <div className="px-6 py-4 font-mono text-[11px] text-narcos-mut2">
          BRAND PREVIEW · 開 <span className="text-[color:var(--acc,#F5D400)]">#brand</span> 進來看、拿掉 hash 回主流程
        </div>
      </div>
    </div>
  );
}
