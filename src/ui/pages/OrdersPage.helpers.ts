/**
 * OrdersPage 純邏輯 helpers — 無 React 依賴
 */
import type { ChannelId, Order, OrderStatus } from "../../domain/models";

// ── 字型常數 ──────────────────────────────────────────────
export const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
} as const;

// ── 通路群組：面交三種合併 · Yen 2026-07-04 加「手打單」母分類 ──────
export type ChanGroup = "全部" | "賣貨便" | "面交" | "KOL" | "宅配" | "手打單" | "待分類";

export const FACE_TO_FACE: ChannelId[] = ["面交_中壢", "面交_台中", "面交_其他"];

/** 手打單判斷：id 前綴 MAN- 或 channel 是駐店/彈性（一定是手打） */
export function isManualOrder(o: Order): boolean {
  if (o.id.startsWith("MAN-")) return true;
  if (o.channel === "駐店" || o.channel === "彈性") return true;
  return false;
}

export function channelGroup(ch: ChannelId): ChanGroup {
  if (FACE_TO_FACE.includes(ch)) return "面交";
  if (ch === "駐店" || ch === "彈性") return "手打單";
  return ch as ChanGroup;
}

/** 訂單級 · 手打單優先歸母分類（即使 channel 是 KOL/宅配 · 只要 MAN- prefix 就歸手打單） */
export function orderChanGroup(o: Order): ChanGroup {
  if (isManualOrder(o)) return "手打單";
  return channelGroup(o.channel);
}

export function channelLabel(ch: ChannelId): string {
  if (FACE_TO_FACE.includes(ch)) return "面交";
  return ch;
}

export const CHAN_COLOR: Record<ChanGroup, string> = {
  全部: "#F5F4EF",
  賣貨便: "var(--acc,#F5D400)",
  面交: "#43B23C",
  KOL: "#8557C9",
  宅配: "#2AC7E8",
  手打單: "#E5622A",
  待分類: "#E5352B",
};

// ── 狀態分桶 ──────────────────────────────────────────────
export type StatusGroup = "全部" | "confirmed" | "待處理" | "已出貨" | "消失";

export function statusGroup(s: OrderStatus): StatusGroup {
  if (s === "confirmed") return "confirmed";
  if (s === "shipped" || s === "kol_shipped") return "已出貨";
  if (s === "disappeared_pending_resolution" || s === "canceled") return "消失";
  return "待處理";
}

export function statusLabel(s: OrderStatus): string {
  switch (s) {
    case "confirmed": return "confirmed";
    case "shipped":
    case "kol_shipped": return "已出貨";
    case "disappeared_pending_resolution": return "消失";
    case "canceled": return "已取消";
    case "pending_payment": return "未付款";
    case "pending_batch_date": return "待排批";
    case "pending_conflict_date": return "日期衝突";
    case "pending_channel": return "待分通路";
    case "pending_recipient": return "待收件人";
    case "pending_amount": return "金額異常";
    case "pending_product": return "待確認品項";
    case "pending_kol_choice": return "KOL 待選";
    case "change_pending_resolution": return "變動待確認";
    default: return s;
  }
}

export type StatusStyle = { color: string; bg: string };
export const STATUS_STYLE: Record<StatusGroup, StatusStyle> = {
  全部: { color: "#F5F4EF", bg: "transparent" },
  confirmed: { color: "#43B23C", bg: "#0f2410" },
  待處理: { color: "#E5622A", bg: "#2a1a10" },
  已出貨: { color: "#2AC7E8", bg: "#0d2830" },
  消失: { color: "#E5352B", bg: "#2a1010" },
};

// ── 批次卡 ─────────────────────────────────────────────────
export type BatchCard = {
  date: string;
  weekday: string;
  orderCount: number;
  labelCount: number;
  revenue: number;
};

const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"] as const;

export function parseBatchDate(dateStr: string): Date | null {
  if (!dateStr || dateStr === "—" || dateStr === "待排") return null;
  const slash = dateStr.match(/^(\d{1,2})\/(\d{2})$/);
  if (slash) {
    const year = new Date().getFullYear();
    return new Date(year, parseInt(slash[1]!, 10) - 1, parseInt(slash[2]!, 10));
  }
  const iso = new Date(dateStr);
  return isNaN(iso.getTime()) ? null : iso;
}

export function weekdayLabel(dateStr: string): string {
  const d = parseBatchDate(dateStr);
  if (!d) return "—";
  return WEEKDAY_ZH[d.getDay()] ?? "—";
}
