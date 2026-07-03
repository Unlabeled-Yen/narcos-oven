/**
 * PendingPage.helpers — pure logic extracted to keep PendingPage.tsx under 500 lines.
 * DB mutation helpers mirror PendingBucket.tsx exactly.
 */
import { db } from "../../db/schema";
import { getDisplayName, explodeToAtoms } from "../../domain/menu";
import type { Menu, Order, PendingReasonCode } from "../../domain/models";

// ── Brand tokens ──────────────────────────────────────────────────────────
export const C = {
  bg:     "#08080A",
  panel:  "#0F0F12",
  card:   "#111114",
  track:  "#161619",
  line:   "#26262C",
  ink:    "#F5F4EF",
  ink3:   "#C9C9CF",
  mut:    "#8A8A93",
  mut2:   "#7A7A82",
  acc:    "var(--acc,#F5D400)",
  green:  "#43B23C",
  orange: "#E5622A",
  red:    "#E5352B",
  cyan:   "#2AC7E8",
  purple: "#8557C9",
} as const;

export const F = {
  anton: "'Anton',sans-serif",
  tc:    "'Noto Sans TC',sans-serif",
  mono:  "'Space Mono',monospace",
} as const;

// ── Reason display config ─────────────────────────────────────────────────
export const REASON_CONFIG: Record<PendingReasonCode, { label: string; color: string }> = {
  PAYMENT_NOT_CONFIRMED:  { label: "未付款",   color: C.orange },
  MISSING_BATCH_DATE:     { label: "缺出爐日", color: C.cyan   },
  CONFLICT_DATE_C12_C28:  { label: "日期衝突", color: C.red    },
  AMBIGUOUS_CHANNEL:      { label: "通路",     color: C.green  },
  UNKNOWN_PRODUCT:        { label: "品項未歸類", color: C.red  },
  AMOUNT_MISMATCH:        { label: "金額不符", color: C.orange },
  MISSING_RECIPIENT:      { label: "缺收件人", color: C.orange },
  KOL_CHOICE_UNRESOLVED:  { label: "擇一",     color: C.purple },
};

// ── Order predicates ──────────────────────────────────────────────────────
export function isPending(o: Order): boolean {
  return (
    o.status.startsWith("pending_") ||
    o.status === "change_pending_resolution" ||
    o.status === "disappeared_pending_resolution"
  );
}

export function primaryReason(o: Order) {
  return o.pendingReasons[0] ?? null;
}

export function productSummary(o: Order, menu: Menu): string {
  if (o.items.length === 0) return "—";
  const names = o.items.map((it) =>
    it.productSkuId ? getDisplayName(it.productSkuId, menu) : it.rawName
  );
  if (names.length === 1) return names[0]!;
  return `${names[0]} 等 ${names.length} 項`;
}

export function recipientStr(o: Order): string {
  const parts: string[] = [];
  if (o.recipient.name)      parts.push(o.recipient.name);
  if (o.recipient.igOrLine)  parts.push(o.recipient.igOrLine);
  if (o.recipient.convStore) parts.push(o.recipient.convStore);
  else if (o.channel)        parts.push(o.channel);
  return parts.join(" · ") || "—";
}

// ── Option list builder ───────────────────────────────────────────────────
export type OptionEntry = { label: string; isSuggest: boolean; value?: string };

// Sentinel for "leave in bucket, don't resolve"（避免文字被誤存為 batchDate）
export const DEFER_SENTINEL = "__DEFER__";

// 計算下次週二 ISO（若今天已是週二、跳到下週二）
function nextTuesdayISO(from: Date = new Date()): string {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=日 2=二
  const delta = ((2 - day + 7) % 7) || 7;
  d.setDate(d.getDate() + delta);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// 判定 ISO YYYY-MM-DD
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function buildOptions(o: Order, menu: Menu): OptionEntry[] {
  const reason = primaryReason(o);
  if (!reason) return [];
  const highConf = reason.suggestionConfidence >= 0.9;
  const opts: OptionEntry[] = [];

  switch (reason.code) {
    case "KOL_CHOICE_UNRESOLVED": {
      const allSkus = Object.keys(menu.products).slice(0, 9);
      if (reason.suggestion) {
        opts.push({ label: getDisplayName(reason.suggestion, menu), isSuggest: highConf });
        for (const sk of allSkus) {
          if (sk !== reason.suggestion && opts.length < 9)
            opts.push({ label: getDisplayName(sk, menu), isSuggest: false });
        }
      } else {
        for (const sk of allSkus) opts.push({ label: getDisplayName(sk, menu), isSuggest: false });
      }
      break;
    }
    case "AMBIGUOUS_CHANNEL": {
      const channels = ["面交_中壢","面交_台中","面交_其他","宅配","駐店","活動","私定","待分類","KOL"];
      if (reason.suggestion && channels.includes(reason.suggestion)) {
        opts.push({ label: reason.suggestion, isSuggest: highConf });
        for (const ch of channels) {
          if (ch !== reason.suggestion && opts.length < 9) opts.push({ label: ch, isSuggest: false });
        }
      } else {
        for (const ch of channels.slice(0, 9)) opts.push({ label: ch, isSuggest: false });
      }
      break;
    }
    case "MISSING_BATCH_DATE": {
      // 憲章 #2：value 一律用 ISO YYYY-MM-DD、label 給雇主看的中文
      // 靜默失效根因：舊版直接把「下次週二」label 存進 batchDate、月曆比對失敗
      if (reason.suggestion && ISO_DATE_RE.test(reason.suggestion)) {
        const [, mm, dd] = reason.suggestion.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
        opts.push({ label: `建議 ${mm}/${dd}`, isSuggest: highConf, value: reason.suggestion });
      }
      const nextTue = nextTuesdayISO();
      const nextTueDisplay = `${nextTue.slice(5, 7)}/${nextTue.slice(8, 10)}`;
      opts.push({ label: `下次週二 · ${nextTueDisplay}`, isSuggest: false, value: nextTue });
      opts.push({ label: "保留待定", isSuggest: false, value: DEFER_SENTINEL });
      break;
    }
    case "UNKNOWN_PRODUCT": {
      const allSkus = Object.keys(menu.products).slice(0, 9);
      if (reason.suggestion) {
        opts.push({ label: getDisplayName(reason.suggestion, menu), isSuggest: highConf });
        for (const sk of allSkus) {
          if (sk !== reason.suggestion && opts.length < 9)
            opts.push({ label: getDisplayName(sk, menu), isSuggest: false });
        }
      } else {
        for (const sk of allSkus) opts.push({ label: getDisplayName(sk, menu), isSuggest: false });
      }
      break;
    }
    default:
      if (reason.suggestion) opts.push({ label: reason.suggestion, isSuggest: highConf });
      opts.push({ label: "排入", isSuggest: false });
      opts.push({ label: "暫不排", isSuggest: false });
      opts.push({ label: "保留", isSuggest: false });
      break;
  }
  return opts.slice(0, 9);
}

// ── DB mutation helpers (mirroring PendingBucket.tsx) ───────────────────

/**
 * 桶清空 → 自動排入 helper
 * 當 filteredReasons 為空（訂單將轉 confirmed）、且 order 已有 batchDate（原本就有）
 * 或有 ISO 格式的 customer_wish_date、就同步設 assignment_source = customer_wish_kept
 * 讓月曆/週檢視能顯示。避免 confirmed + pending + 無date 的孤兒單。
 */
function autoScheduleIfCleared(
  o: Order,
  filteredReasons: Order["pendingReasons"]
): { batchDate?: string; assignment_source?: Order["assignment_source"] } {
  if (filteredReasons.length !== 0) return {}; // 還有未 resolve 的 reason、不動
  // 已有 batchDate 且 ISO → 保留、只把 source 從 pending 升成 customer_wish_kept
  if (o.batchDate && ISO_DATE_RE.test(o.batchDate) && o.assignment_source === "pending") {
    return { assignment_source: "customer_wish_kept" };
  }
  // 沒 batchDate 但 wish_date ISO → 用 wish_date
  if (!o.batchDate && o.customer_wish_date && ISO_DATE_RE.test(o.customer_wish_date)) {
    return { batchDate: o.customer_wish_date, assignment_source: "customer_wish_kept" };
  }
  return {};
}

async function resolveKolChoice(o: Order, skuId: string, menu: Menu): Promise<void> {
  const atoms = explodeToAtoms(skuId, menu);
  const newItems = [{
    productSkuId: skuId,
    rawName: getDisplayName(skuId, menu),
    quantity: 1,
    subtotal: null,
    atoms,
  }];
  const filteredReasons = o.pendingReasons.filter((r) => r.code !== "KOL_CHOICE_UNRESOLVED");
  await db.orders.update(o.id, {
    items: [...o.items.filter((it) => it.productSkuId !== null), ...newItems],
    pendingReasons: filteredReasons,
    status: filteredReasons.length === 0 ? "confirmed" : o.status,
    ...autoScheduleIfCleared(o, filteredReasons),
  });
}

async function resolveChannel(o: Order, channel: string): Promise<void> {
  const filteredReasons = o.pendingReasons.filter((r) => r.code !== "AMBIGUOUS_CHANNEL");
  await db.orders.update(o.id, {
    channel: channel as Order["channel"],
    pendingReasons: filteredReasons,
    status: filteredReasons.length === 0 ? "confirmed" : o.status,
    ...autoScheduleIfCleared(o, filteredReasons),
  });
}

async function resolveBatchDate(o: Order, date: string): Promise<void> {
  // 憲章 #2 靜默失效零容忍：拒絕非 ISO 日期，loud 失敗
  if (!ISO_DATE_RE.test(date)) {
    // eslint-disable-next-line no-console
    console.error(`[resolveBatchDate] 拒絕非 ISO batchDate: ${JSON.stringify(date)} · order ${o.id}`);
    throw new Error(`batchDate 必須是 YYYY-MM-DD、收到「${date}」（憲章 #2）`);
  }
  const filteredReasons = o.pendingReasons.filter((r) => r.code !== "MISSING_BATCH_DATE");
  await db.orders.update(o.id, {
    batchDate: date,
    customer_wish_date: date,
    assignment_source: "customer_wish_kept",
    pendingReasons: filteredReasons,
    status: filteredReasons.length === 0 ? "confirmed" : o.status,
  });
}

async function resolveProduct(o: Order, skuId: string, menu: Menu): Promise<void> {
  const atoms = explodeToAtoms(skuId, menu);
  const newItems = o.items.map((it) =>
    it.productSkuId === null
      ? { ...it, productSkuId: skuId, atoms: atoms.map((a) => ({ ...a, count: a.count * it.quantity })) }
      : it
  );
  const filteredReasons = o.pendingReasons.filter((r) => r.code !== "UNKNOWN_PRODUCT");
  await db.orders.update(o.id, {
    items: newItems,
    pendingReasons: filteredReasons,
    status: filteredReasons.length === 0 ? "confirmed" : o.status,
    ...autoScheduleIfCleared(o, filteredReasons),
  });
}

async function clearPrimaryReason(o: Order): Promise<void> {
  const primary = primaryReason(o);
  if (!primary) return;
  const filteredReasons = o.pendingReasons.filter((r) => r.code !== primary.code);
  await db.orders.update(o.id, {
    pendingReasons: filteredReasons,
    status: filteredReasons.length === 0 ? "confirmed" : o.status,
    ...autoScheduleIfCleared(o, filteredReasons),
  });
}

/** Route to the appropriate DB call given a chosen option label. */
export async function resolveOrderByOption(o: Order, optionValue: string, menu: Menu): Promise<void> {
  const reason = primaryReason(o);
  if (!reason) return;

  // 「保留待定」sentinel：不 resolve、留在桶裡（避免 label 被誤存為 batchDate）
  if (optionValue === DEFER_SENTINEL) return;

  const findSku = (label: string) =>
    Object.keys(menu.products).find(
      (k) => getDisplayName(k, menu) === label || k === label
    ) ?? label;

  switch (reason.code) {
    case "KOL_CHOICE_UNRESOLVED":
      await resolveKolChoice(o, findSku(optionValue), menu);
      break;
    case "AMBIGUOUS_CHANNEL":
      await resolveChannel(o, optionValue);
      break;
    case "MISSING_BATCH_DATE":
      await resolveBatchDate(o, optionValue); // 內部強制 ISO 檢查
      break;
    case "UNKNOWN_PRODUCT":
      await resolveProduct(o, findSku(optionValue), menu);
      break;
    default:
      await clearPrimaryReason(o);
      break;
  }
}

/** Accept the suggestion from pendingReasons[0]. Returns false if no suggestion. */
export async function resolveOrderBySuggestion(o: Order, menu: Menu): Promise<boolean> {
  const reason = primaryReason(o);
  if (!reason?.suggestion) return false;
  await resolveOrderByOption(o, reason.suggestion, menu);
  return true;
}
