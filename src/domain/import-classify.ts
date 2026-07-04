/**
 * import-classify.ts · 消失單 + 變動單訊號分類（給 ImportSummaryModal 用）
 *
 * Yen 2026-07-04：讓每張消失/變動卡都有「訊號 badge」+ 系統建議
 *   - B · classifyDisappearance: 已印標籤 → 高機率已出貨 / 未印 → 待確認 / 非賣貨便 → 疑點
 *   - C · classifyChange: 付款回退 / 金額顯著下降 → 建議保留舊
 *
 * 純函式、UI 從此讀 badge/tone/recommendation
 */
import type { Order, OrderChange, ChannelId } from "./models";

// ── B · 消失單分類 ────────────────────────────────────────
export type DisappearBadge = "likely_shipped" | "unclear" | "suspicious";
export type DisappearInfo = {
  badge: DisappearBadge;
  title: string;
  hint: string;
  recommend?: "shipped" | "kept_active";
};

export function classifyDisappearance(o: Order): DisappearInfo {
  const isMartOrKol = o.channel === "賣貨便" || o.channel === "KOL";
  const isFaceOrHome = o.channel.startsWith("面交") || o.channel === "宅配";

  // 面交 / 宅配 xlsx 是「全部回覆」語意、不該消失
  if (isFaceOrHome) {
    return {
      badge: "suspicious",
      title: "非典型消失",
      hint: `${o.channel} 的資料源通常不會消失、可能檔源不同或手動改過表單`,
    };
  }

  // 賣貨便 / KOL：已印標籤 = 高機率已出貨
  if (isMartOrKol && o.frozen_after_label_print) {
    return {
      badge: "likely_shipped",
      title: "高機率已出貨",
      hint: "此單已印標籤、賣貨便/KOL xlsx 匯出「未完成」清單、已寄出即會消失",
      recommend: "shipped",
    };
  }

  // 賣貨便 / KOL 未印標籤消失：可能出貨（賣貨便流程有時直接寄不印）· 也可能檔源少東西
  return {
    badge: "unclear",
    title: "待確認",
    hint: "未印標籤 · 可能已出貨、也可能檔源不同、建議看金額與收件人核對",
  };
}

// ── C · 變動單分類 ────────────────────────────────────────
export type ChangeSignal =
  | "PAYMENT_REVERSED"
  | "AMOUNT_DECREASED"
  | "LABEL_COUNT_CHANGED"
  | "WISH_DATE_CHANGED"
  | "PRODUCT_CHANGED"
  | "CONV_STORE_CHANGED";

export type ChangeSignalInfo = {
  code: ChangeSignal;
  severity: "warn" | "notice";
  message: string;
};

export type ChangeInfo = {
  signals: ChangeSignalInfo[];
  recommend: "accept" | "reject" | "neutral";
  recommendReason?: string;
};

export function classifyChange(change: OrderChange): ChangeInfo {
  const signals: ChangeSignalInfo[] = [];
  let recommend: ChangeInfo["recommend"] = "neutral";
  let recommendReason: string | undefined;

  // 付款狀態回退（不可逆事件反轉）→ 保留舊
  const c5 = change.fields["c5_status"];
  if (c5) {
    const oldPaid = String(c5.from).includes("付款完成");
    const newPaid = String(c5.to).includes("付款完成");
    if (oldPaid && !newPaid) {
      signals.push({
        code: "PAYMENT_REVERSED",
        severity: "warn",
        message: "付款狀態從「付款完成」→「未付款」· 疑似舊資料倒退",
      });
      recommend = "reject";
      recommendReason = "付款是不可逆事件、幾乎肯定新值來自舊備份";
    }
  }

  // 金額顯著下降（新值 < 舊值 · 差 > 5%）→ 提示、但不 auto-reject
  const c21 = change.fields["c21_total"];
  if (c21) {
    const from = toNum(c21.from);
    const to = toNum(c21.to);
    if (from !== null && to !== null && from > 0 && to < from) {
      const dropPct = ((from - to) / from) * 100;
      if (dropPct >= 5) {
        signals.push({
          code: "AMOUNT_DECREASED",
          severity: dropPct >= 20 ? "warn" : "notice",
          message: `金額下降 ${dropPct.toFixed(0)}%（$${from} → $${to}）· 確認是否為客人主動改單`,
        });
        if (recommend === "neutral" && dropPct >= 20) {
          recommend = "reject";
          recommendReason = "金額大幅下降通常代表舊資料混入、非客人減購";
        }
      }
    }
  }

  // 箱數變化中性訊息（不建議方向、只提示）
  const c22 = change.fields["c22_label_count"];
  if (c22 && c22.from !== c22.to) {
    signals.push({
      code: "LABEL_COUNT_CHANGED",
      severity: "notice",
      message: `箱數變動（${c22.from} → ${c22.to}）· 已印標籤時要注意重印`,
    });
  }

  // 客人改指定出貨日 · 主動異動 · 建議接受（客人剛決定的日期）
  const wish = change.fields["customer_wish_date"];
  if (wish && wish.from !== wish.to) {
    signals.push({
      code: "WISH_DATE_CHANGED",
      severity: "notice",
      message: `客人改指定出貨日（${wish.from ?? "—"} → ${wish.to ?? "—"}）· 排程可能要跟著調`,
    });
    if (recommend === "neutral") {
      recommend = "accept";
      recommendReason = "客人主動改期是新意圖、通常應接受並重排批次";
    }
  }

  // 品項字串變 · 中性提示（可能改品項或改數量）
  const c12 = change.fields["c12_product"];
  if (c12 && c12.from !== c12.to) {
    signals.push({
      code: "PRODUCT_CHANGED",
      severity: "notice",
      message: "品項/數量有變動 · 對照舊值與新值確認差異",
    });
  }

  // 超商店號變 · 影響出貨 · 提示
  const c11 = change.fields["c11_conv_store"];
  if (c11 && c11.from !== c11.to) {
    signals.push({
      code: "CONV_STORE_CHANGED",
      severity: "notice",
      message: `取貨門市變（${c11.from ?? "—"} → ${c11.to ?? "—"}）· 已印標籤需重印`,
    });
  }

  return { signals, recommend, recommendReason };
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ── 消失訊號在 stat 級的分組（給批次條用）───────────────
export function groupDisappearances(orders: Order[]): {
  likely_shipped: Order[];
  unclear: Order[];
  suspicious: Order[];
} {
  const g = { likely_shipped: [] as Order[], unclear: [] as Order[], suspicious: [] as Order[] };
  for (const o of orders) {
    g[classifyDisappearance(o).badge].push(o);
  }
  return g;
}

// eslint helper：avoid unused import warning if only types imported elsewhere
export type _ChannelIdSanityOnly = ChannelId;
