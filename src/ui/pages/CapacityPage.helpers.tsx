/**
 * CapacityPage — 子元件 & 型別 helpers
 */
import type { Menu } from "../../domain/models";
import { getDisplayName } from "../../domain/menu";

// ─── Brand tokens (local copy) ───────────────────────────────────────────────
export const C = {
  bg: "#08080A",
  panel: "#0F0F12",
  card: "#111114",
  track: "#161619",
  line: "#26262C",
  ink: "#F5F4EF",
  ink3: "#C9C9CF",
  mut: "#8A8A93",
  mut2: "#7A7A82",
  acc: "var(--acc,#F5D400)",
  accFb: "#F5D400",
  green: "#43B23C",
  orange: "#E5622A",
  cyan: "#2AC7E8",
  purple: "#8557C9",
} as const;

export const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
} as const;

// ─── Atom groups ─────────────────────────────────────────────────────────────
export type AtomEntry = { key: string; unit: string };
export type Group = { cat: string; color: string; items: AtomEntry[] };

export const GROUPS: Group[] = [
  {
    cat: "麵包類",
    color: C.accFb,
    items: [
      { key: "肉桂捲", unit: "顆" },
      { key: "蘋果肉桂捲", unit: "顆" },
      { key: "焦糖蘋果肉桂麵包", unit: "顆" },
    ],
  },
  {
    cat: "磅蛋糕類",
    color: C.orange,
    items: [
      { key: "芝麻焙茶磅", unit: "顆" },
      { key: "鳳梨肉桂磅", unit: "顆" },
    ],
  },
  {
    cat: "巴斯克類 · 7 口味共用",
    color: C.cyan,
    items: [{ key: "巴斯克類", unit: "顆" }],
  },
  {
    cat: "堅果醬 / 其他",
    color: C.purple,
    items: [
      { key: "堅果醬40ml", unit: "罐" },
      { key: "堅果醬90ml", unit: "罐" },
      { key: "堅果醬240ml", unit: "罐" },
      { key: "瑕疵小脆捲", unit: "包" },
    ],
  },
];

// 週幾設定
export type WeekDayEntry = {
  key: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  label: string;
  isTue: boolean;
};
export const WEEK_DAYS: WeekDayEntry[] = [
  { key: "Mon", label: "一", isTue: false },
  { key: "Tue", label: "二", isTue: true },
  { key: "Wed", label: "三", isTue: false },
  { key: "Thu", label: "四", isTue: false },
  { key: "Fri", label: "五", isTue: false },
  { key: "Sat", label: "六", isTue: false },
  { key: "Sun", label: "日", isTue: false },
];

// ─── Default values ───────────────────────────────────────────────────────────
export const DEFAULT_CAPS: Record<string, number> = {
  肉桂捲: 200, 蘋果肉桂捲: 200, 焦糖蘋果肉桂麵包: 50,
  芝麻焙茶磅: 30, 鳳梨肉桂磅: 30, 巴斯克類: 50,
  "堅果醬40ml": 100, "堅果醬90ml": 100, "堅果醬240ml": 50,
  瑕疵小脆捲: 20,
};

export const DEFAULT_WEEKLY: Record<string, number> = {
  Mon: 1.0, Tue: 1.0, Wed: 1.0, Thu: 1.0, Fri: 1.0, Sat: 1.0, Sun: 1.0,
};

export const DEFAULT_PRODUCT_LEAD: Record<string, number> = {
  肉桂捲: 2, 蘋果肉桂捲: 2, 焦糖蘋果肉桂麵包: 2,
  芝麻焙茶磅: 1, 鳳梨肉桂磅: 1, 巴斯克類: 1,
  "堅果醬40ml": 0, "堅果醬90ml": 0, "堅果醬240ml": 0,
  瑕疵小脆捲: 0,
};

// ─── Atom display name helper (憲章 #1) ──────────────────────────────────────
export function atomLabel(key: string, menu: Menu): string {
  if (menu.atoms[key]) return key; // atom key 本身是中文
  for (const skuId of Object.keys(menu.products)) {
    if (skuId === key) return getDisplayName(skuId, menu);
  }
  return key;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
export function SectionTitle({ title, monoSub }: { title: string; monoSub?: string }) {
  return (
    <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 17, color: C.ink, marginBottom: 12 }}>
      {title}
      {monoSub && (
        <span style={{ fontFamily: F.mono, fontWeight: 400, fontSize: 11, color: "#6C6C74", marginLeft: 10 }}>
          {monoSub}
        </span>
      )}
    </div>
  );
}

export function FieldRow({
  label, labelColor, value, onChange, width = 48, unit,
}: {
  label: string; labelColor?: string; value: string;
  onChange: (v: string) => void; width?: number; unit: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ flex: 1, fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: labelColor ?? C.ink3 }}>
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width, textAlign: "right", fontSize: 14, fontWeight: 700,
          color: labelColor ?? C.ink, background: C.card,
          border: "1px solid #3a3a40", padding: 5, outline: "none", fontFamily: F.mono,
        }}
      />
      <span style={{ fontFamily: F.mono, fontSize: 11, color: "#6C6C74" }}>{unit}</span>
    </div>
  );
}

export function EstimateTag() {
  return (
    <span style={{ fontFamily: F.mono, fontSize: 9, color: C.orange, marginLeft: 6 }}>
      估算
    </span>
  );
}

export function PendingTag() {
  return (
    <span style={{ fontFamily: F.mono, fontSize: 9, color: C.orange, marginLeft: 8 }}>
      估算/待設
    </span>
  );
}
