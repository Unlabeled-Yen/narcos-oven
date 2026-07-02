/**
 * MenuEditorPage helpers — 型別、轉換函式、靜態 demo 資料
 * （主檔 import，不直接對外）
 */
import type { Product } from "../../domain/models";

// ── 品牌 token ────────────────────────────────────────────────
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
  green: "#43B23C",
  orange: "#E5622A",
  purple: "#8557C9",
  red: "#E5352B",
  border: "#3a3a40",
  borderDash: "#2a2a30",
} as const;

export const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
} as const;

// ── 靜態建議 demo（憲章 #2：0 LLM） ──────────────────────────
export const STATIC_SUGGESTION = {
  id: "白玉芝麻巴斯克",
  display_name: "白玉芝麻巴斯克",
  category: "single" as const,
  price: 820,
  cost: null as null,
  seen_count: 1,
  contains: [{ atom: "白玉芝麻巴斯克", count: 1 }],
  aliases: ["無麩 ✦ 芝麻巴斯克 六寸 白玉芝麻巴斯克"],
  match_signature: {
    include: ["白玉", "芝麻巴斯克"],
    exclude: [] as string[],
  },
  notes: "由 Claude Code 建議、07/15 首次匯入出現。芝麻 720 ＋ 白玉夾餡 100 = 820。",
};

// ── EditState ─────────────────────────────────────────────────
export type EditState = {
  display_name: string;
  price: string;
  category: "combo" | "single";
  contains: Array<{ atom: string; count: number }>;
  match_signature: { include: string[]; exclude: string[] };
  aliases: string[];
  notes: string;
};

export function productToEdit(p: Product): EditState {
  return {
    display_name: p.display_name,
    price: p.price != null ? String(p.price) : "",
    category: p.category,
    contains: p.contains.map((c) => ({ atom: c.atom, count: c.count })),
    match_signature: {
      include: [...(p.match_signature?.include ?? [])],
      exclude: [...(p.match_signature?.exclude ?? [])],
    },
    aliases: [...p.aliases],
    notes: p.notes ?? "",
  };
}

export function emptyEdit(): EditState {
  return {
    display_name: "",
    price: "",
    category: "single",
    contains: [],
    match_signature: { include: [], exclude: [] },
    aliases: [],
    notes: "",
  };
}

export function atomUnit(
  atomId: string,
  atoms: Record<string, { unit: string }>
): string {
  return atoms[atomId]?.unit ?? "顆";
}
