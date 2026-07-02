/**
 * DashboardPage — 視覺還原版（P0 proof / P2 待接 domain）
 *
 * ⚠️ 本檔所有數字為「設計稿示意值」、集中在 DEMO 常數。
 *    P2 會改由 domain function 即時算出（getAll() + compute*），
 *    絕不 hardcode 進主軌（憲章 #1）。此檔僅供 Yen 確認視覺 1:1。
 */
import { useState } from "react";
import { GrainOverlay } from "../brand/GrainOverlay";
import { WarningTape } from "../brand/WarningTape";
import { CommandBar, type NavKey, type NavItem } from "../brand/CommandBar";
import { PageHeader, PeriodChips } from "../brand/PageHeader";

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

// ── DEMO 示意值（P2 換 domain）─────────────────────────────
const OVEN_TREND = [
  { label: "6/09", v: 210, h: 118, hot: false },
  { label: "6/16", v: 245, h: 138, hot: false },
  { label: "6/23", v: 180, h: 100, hot: false },
  { label: "7/07", v: 320, h: 190, hot: true },
  { label: "7/14", v: 260, h: 150, hot: false },
];
const TOP_ITEMS = [
  { name: "經典肉桂捲 四入", n: 28, w: 100, lead: true },
  { name: "方型三入 焦糖蘋果", n: 10, w: 36 },
  { name: "無敵組盒 肉桂×3蘋果×2", n: 7, w: 25 },
  { name: "原味巴斯克", n: 5, w: 18 },
  { name: "芝麻巴斯克", n: 3, w: 11 },
  { name: "香料堅果醬 90ml", n: 3, w: 11 },
  { name: "蘋果肉桂捲 四入", n: 3, w: 11 },
  { name: "經典六入 含醬", n: 3, w: 11 },
  { name: "白玉烏龍茶巴斯克", n: 2, w: 7 },
  { name: "焙茶栗子巴斯克", n: 1, w: 4 },
];
const ATOMS = [
  { name: "肉桂捲", v: "512 顆", w: 100, lead: true },
  { name: "蘋果肉桂捲", v: "96 顆", w: 19 },
  { name: "焦糖蘋果麵包", v: "44 顆", w: 9 },
  { name: "香料堅果醬", v: "41 罐", w: 8 },
  { name: "原味巴斯克", v: "32 顆", w: 6 },
  { name: "磅蛋糕（合）", v: "30 顆", w: 6 },
  { name: "芝麻巴斯克", v: "21 顆", w: 4 },
  { name: "烏龍/焙茶類", v: "20 顆", w: 4 },
];
const HEALTH = [
  { name: "金額對帳 #2", val: "58/58 ✓", color: "#43B23C" },
  { name: "總數守恆 #1", val: "一致", color: "#43B23C" },
  { name: "消失守恆 #9", val: "0 待拍板", color: "#43B23C" },
  { name: "變動守恆 #10", val: "17 待確認", color: "#E5622A" },
];
// ───────────────────────────────────────────────────────────

const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
};

export function DashboardDemo() {
  const [active, setActive] = useState<NavKey>("dashboard");
  const [period, setPeriod] = useState("8w");

  return (
    <div className="relative min-h-screen bg-narcos-bg overflow-hidden" style={{ fontFamily: F.tc }}>
      <GrainOverlay />
      <div className="relative z-10 mx-auto" style={{ maxWidth: 1560 }}>
        <CommandBar
          nav={NAV}
          active={active}
          onNav={setActive}
          syncLabel="SYNC 07/03 09:12"
          right={
            <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 12, color: "#111", background: "#F5F4EF", padding: "8px 16px", cursor: "pointer" }}>
              ＋ 拖檔上傳
            </span>
          }
        />
        <WarningTape />

        <PageHeader
          caption="DASHBOARD · 跨批統計"
          title="OVEN CENTRAL"
          right={<PeriodChips options={PERIODS} active={period} onChange={setPeriod} />}
        />

        {/* KPI ROW */}
        <div className="grid gap-3 px-6 py-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
          <Kpi accent="#F5D400" label="本批出爐 · 07/07" foot="+31 蘋果 · +12 巴斯克 · +7 磅">
            <span style={{ fontFamily: F.anton, fontSize: 42, color: "#F5F4EF", lineHeight: 0.85 }}>170</span>
            <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 14, color: "#8A8A93", marginLeft: 7 }}>顆肉桂捲</span>
          </Kpi>
          <Kpi label="活躍訂單" foot="賣貨便58 面交22 KOL25">
            <span style={{ fontFamily: F.anton, fontSize: 42, color: "#F5F4EF", lineHeight: 0.85 }}>105</span>
          </Kpi>
          <Kpi accent="#43B23C" labelColor="#43B23C" label="CONFIRMED" foot="主軌通過">
            <span style={{ fontFamily: F.anton, fontSize: 42, color: "#F5F4EF", lineHeight: 0.85 }}>88</span>
          </Kpi>
          <Kpi accent="#E5622A" labelColor="#E5622A" label="待處理桶" foot="標籤未定">
            <span style={{ fontFamily: F.anton, fontSize: 42, color: "#E5622A", lineHeight: 0.85 }}>17</span>
          </Kpi>
          <Kpi accent="#43B23C" labelColor="#43B23C" label="消失待拍板" foot="✓ 可產出" footColor="#43B23C">
            <span style={{ fontFamily: F.anton, fontSize: 42, color: "#F5F4EF", lineHeight: 0.85 }}>0</span>
          </Kpi>
          <Kpi label="六月 GMV" foot="▲ 對帳 58/58 一致" footColor="#43B23C">
            <span style={{ fontFamily: F.mono, fontSize: 14, color: "#8A8A93" }}>NT$</span>
            <span style={{ fontFamily: F.anton, fontSize: 36, color: "#F5F4EF", lineHeight: 0.85, marginLeft: 4 }}>41,600</span>
          </Kpi>
        </div>

        {/* 趨勢兩欄 */}
        <div className="grid gap-3 px-6 py-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))" }}>
          <PanelBox>
            <PanelHead title="出爐量趨勢" sub="總顆 / 批" right={<span style={{ fontFamily: F.mono, fontSize: 11, color: "#F5D400" }}>● 週二出爐</span>} />
            <div className="flex items-end gap-4" style={{ height: 190 }}>
              {OVEN_TREND.map((b) => (
                <div key={b.label} className="flex-1 flex flex-col items-center gap-2">
                  <span style={{ fontFamily: F.mono, fontSize: b.hot ? 13 : 12, color: b.hot ? "#F5D400" : "#8A8A93", fontWeight: b.hot ? 700 : 400 }}>{b.v}</span>
                  <div style={{ width: "100%", height: b.h, background: b.hot ? "#F5D400" : "#2E2E34" }} />
                  <span style={{ fontFamily: F.mono, fontSize: 11, color: b.hot ? "#F5D400" : "#6C6C74" }}>{b.label}</span>
                </div>
              ))}
            </div>
          </PanelBox>
          <PanelBox>
            <PanelHead title="月營收趨勢" sub="NT$ · 含運" right={<span style={{ fontFamily: F.mono, fontSize: 11, color: "#43B23C" }}>▲ +19.5%</span>} />
            <div className="flex items-end gap-6" style={{ height: 190 }}>
              <Bar label="5月" v="34.8k" h={130} />
              <Bar label="6月" v="41.6k" h={158} color="#2AC7E8" hot />
              <Bar label="7月*" v="18.9k" h={72} hatch />
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", marginTop: 10, textAlign: "right" }}>* 7月至今 · 進行中</div>
          </PanelBox>
        </div>

        {/* 通路 + 回頭 + 健康 */}
        <div className="grid gap-3 px-6 py-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
          <PanelBox>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: "#F5F4EF", marginBottom: 16 }}>通路占比</div>
            <div className="flex" style={{ height: 28, marginBottom: 16 }}>
              <div style={{ width: "55%", background: "#F5D400" }} />
              <div style={{ width: "24%", background: "#8557C9" }} />
              <div style={{ width: "14%", background: "#43B23C" }} />
              <div style={{ width: "4%", background: "#2AC7E8" }} />
              <div style={{ width: "3%", background: "#E5352B" }} />
            </div>
            {[
              ["#F5D400", "賣貨便", "58 · 55%"],
              ["#8557C9", "KOL", "25 · 24%"],
              ["#43B23C", "面交", "15 · 14%"],
              ["#2AC7E8", "宅配", "4 · 4%"],
              ["#E5352B", "待分類", "3 · 3%"],
            ].map(([c, n, v]) => (
              <div key={n} className="flex items-center gap-2" style={{ fontFamily: F.mono, fontSize: 12, marginBottom: 8 }}>
                <span style={{ width: 9, height: 9, background: c }} />
                <span style={{ flex: 1, color: "#C9C9CF" }}>{n}</span>
                <span style={{ color: "#7A7A82" }}>{v}</span>
              </div>
            ))}
          </PanelBox>
          <PanelBox>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: "#F5F4EF", marginBottom: 16 }}>客戶回頭率</div>
            <div className="flex items-baseline gap-[10px]">
              <span style={{ fontFamily: F.anton, fontSize: 52, color: "#2AC7E8", lineHeight: 0.85 }}>19%</span>
              <span style={{ fontFamily: F.mono, fontSize: 11, color: "#7A7A82" }}>14 / 72 位</span>
            </div>
            <div style={{ height: 1, background: "#26262C", margin: "16px 0" }} />
            <div style={{ fontFamily: F.mono, fontSize: 10, color: "#6C6C74", letterSpacing: ".1em", marginBottom: 10 }}>TOP 回頭客</div>
            {[["郭*玲", "3 單"], ["@be.sunshine", "3 單"], ["王*晨", "2 單"]].map(([n, v]) => (
              <div key={n} className="flex justify-between" style={{ fontFamily: F.mono, fontSize: 12, marginBottom: 7 }}>
                <span style={{ color: "#C9C9CF" }}>{n}</span>
                <span style={{ color: "#7A7A82" }}>{v}</span>
              </div>
            ))}
          </PanelBox>
          <PanelBox>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: "#F5F4EF", marginBottom: 16 }}>
              資料健康度 <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 11, color: "#6C6C74" }}>憲章防護</span>
            </div>
            {HEALTH.map((h) => (
              <div key={h.name} className="flex items-center gap-[10px]" style={{ marginBottom: 11 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: h.color }} />
                <span style={{ flex: 1, fontFamily: F.tc, fontWeight: 700, fontSize: 13, color: "#C9C9CF" }}>{h.name}</span>
                <span style={{ fontFamily: F.mono, fontSize: 12, color: h.color }}>{h.val}</span>
              </div>
            ))}
            <div style={{ marginTop: 16, padding: "11px 13px", background: "#161619", borderLeft: "3px solid #E5622A" }}>
              <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 11, color: "#E5622A" }}>⚠ 產出閘門</span>
              <span style={{ fontFamily: F.tc, fontWeight: 500, fontSize: 11, color: "#8A8A93" }}> · 待處理清空前 Excel/PDF disabled</span>
            </div>
          </PanelBox>
        </div>

        {/* TOP 品項 + 原子產量 */}
        <div className="grid gap-3 px-6 py-2 pb-10" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))" }}>
          <PanelBox>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: "#F5F4EF", marginBottom: 18 }}>
              TOP 10 品項 <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 11, color: "#6C6C74" }}>份 · 本月</span>
            </div>
            {TOP_ITEMS.map((it, i) => (
              <div key={it.name} className="flex items-center gap-[10px]" style={{ fontFamily: F.mono, marginBottom: 10 }}>
                <span style={{ width: 20, color: it.lead ? "#F5D400" : "#7A7A82", fontWeight: 700, fontSize: 12 }}>{String(i + 1).padStart(2, "0")}</span>
                <span style={{ width: "44%", fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#E7E7EA" }}>{it.name}</span>
                <div style={{ flex: 1, height: 14, background: "#161619" }}>
                  <div style={{ width: `${it.w}%`, height: 14, background: it.lead ? "#F5D400" : "#3E3E46" }} />
                </div>
                <span style={{ width: 24, textAlign: "right", fontSize: 12, color: "#C9C9CF" }}>{it.n}</span>
              </div>
            ))}
          </PanelBox>
          <PanelBox>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: "#F5F4EF", marginBottom: 18 }}>
              原物料出爐總量 <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 11, color: "#6C6C74" }}>atom · 本月</span>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "12px 20px" }}>
              {ATOMS.map((a) => (
                <div key={a.name}>
                  <div className="flex justify-between" style={{ marginBottom: 5 }}>
                    <span style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: "#C9C9CF" }}>{a.name}</span>
                    <span style={{ fontFamily: F.mono, fontSize: 12, color: a.lead ? "#F5D400" : "#8A8A93" }}>{a.v}</span>
                  </div>
                  <div style={{ height: 8, background: "#161619" }}>
                    <div style={{ width: `${a.w}%`, height: 8, background: a.lead ? "#F5D400" : "#3E3E46" }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-baseline" style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid #26262C" }}>
              <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#8A8A93" }}>本月出爐合計</span>
              <span style={{ fontFamily: F.anton, fontSize: 26, color: "#F5F4EF" }}>
                796 <span style={{ fontFamily: F.mono, fontSize: 12, color: "#6C6C74" }}>顆 + 41 罐</span>
              </span>
            </div>
          </PanelBox>
        </div>

        <WarningTape size="sm" />
        <div className="px-6 py-3" style={{ fontFamily: F.mono, fontSize: 11, color: "#7A7A82" }}>
          DASHBOARD DEMO · 視覺 1:1 還原 · 數字為設計稿示意、P2 接 domain 即時算
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label, accent, labelColor, foot, footColor, children,
}: {
  label: string; accent?: string; labelColor?: string; foot?: string; footColor?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ background: "#111114", border: "1px solid #26262C", borderLeft: accent ? `3px solid ${accent}` : "1px solid #26262C", padding: 18 }}>
      <div style={{ fontFamily: F.mono, fontSize: 10, color: labelColor || "#7A7A82", letterSpacing: ".12em" }}>{label}</div>
      <div className="flex items-baseline" style={{ marginTop: 8 }}>{children}</div>
      {foot && <div style={{ fontFamily: F.mono, fontSize: 10, color: footColor || "#6C6C74", marginTop: 7 }}>{foot}</div>}
    </div>
  );
}

function PanelBox({ children }: { children: React.ReactNode }) {
  return <div style={{ background: "#0F0F12", border: "1px solid #26262C", padding: 20 }}>{children}</div>;
}

function PanelHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex justify-between items-baseline" style={{ marginBottom: 20 }}>
      <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: "#F5F4EF" }}>
        {title} {sub && <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 11, color: "#6C6C74" }}>{sub}</span>}
      </span>
      {right}
    </div>
  );
}

function Bar({ label, v, h, color, hot, hatch }: { label: string; v: string; h: number; color?: string; hot?: boolean; hatch?: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center gap-2">
      <span style={{ fontFamily: F.mono, fontSize: hot ? 13 : 12, color: hot ? color : "#8A8A93", fontWeight: hot ? 700 : 400 }}>{v}</span>
      <div style={{ width: "100%", height: h, background: color || "#2E2E34", position: "relative" }}>
        {hatch && <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(45deg,#2E2E34 0 6px,#161619 6px 12px)" }} />}
      </div>
      <span style={{ fontFamily: F.mono, fontSize: 11, color: hot ? color : "#6C6C74" }}>{label}</span>
    </div>
  );
}
