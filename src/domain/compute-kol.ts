/**
 * KOL ROI 純計算函式（domain 層，無副作用）
 *
 * 憲章：
 *   #1  品項名透過 getDisplayName 取，禁 hardcode
 *   #2  主軌 0 LLM，數字全由 orders + menu 算出
 *   #8  洞察附 sourceOrderIds
 *
 * 成本假設：
 *   「寄出成本」= 該 KOL 訂單的所有 items，
 *     每個 item 取 menu.products[productSkuId].cost × item.quantity，
 *     cost 為 null 時以 0 計（loud 標記 isEstimated）。
 *   KOL 訂單識別：channel === "KOL"。
 *   帶單營收 = order.revenue.grossTotal。
 *   ROI     = 帶單營收 / 寄出成本（成本為 0 則為 null）。
 *
 * 「KOL handle」從 order.recipient.igOrLine 取；
 *   igOrLine 為 null 時 fallback order.recipient.name ?? order.id。
 */
import type { Order, Menu } from "./models";
import { getDisplayName } from "./menu";

// ─── 型別 ────────────────────────────────────────────────────────────────────

export type KolOrderKind = "shipped" | "pending" | "choice";

export type KolRow = {
  /** KOL handle（IG 或 Line，無則 name or id） */
  handle: string;
  /** 提供品項顯示名（逗號合併，憲章 #1 getDisplayName） */
  itemNames: string;
  /** 估算寄出成本（NT$）*/
  cost: number;
  /** 折扣碼（igOrLine 用途作識別，無真折扣碼欄位就用 handle 或空字串）*/
  discountCode: string;
  /** 帶單筆數 */
  orderCount: number;
  /** 帶單營收（NT$）*/
  revenue: number;
  /** ROI = revenue / cost；cost=0 時為 null */
  roi: number | null;
  /** 所有來源 order id（憲章 #8）*/
  sourceOrderIds: string[];
  /** 狀態（只有一張 KOL 訂單，取它的 status） */
  status: string;
  /** 狀態分組（決定顏色）*/
  kind: KolOrderKind;
  /** true = 成本有任何 null product.cost，數字為估算（憲章 loud）*/
  isEstimated: boolean;
};

export type KolKpi = {
  /** 不重複 KOL handle 數 */
  kolCount: number;
  /** 已出貨 KOL 數 */
  shippedCount: number;
  /** 待出貨 KOL 數 */
  pendingCount: number;
  /** 待選品項 KOL 數 */
  choiceCount: number;
  /** 寄出成本合計（NT$）*/
  totalCost: number;
  /** 帶單筆數合計 */
  totalOrders: number;
  /** 帶單營收合計（NT$）*/
  totalRevenue: number;
  /** 平均 ROI（成本 > 0 的 rows 才計入）*/
  avgRoi: number | null;
  /** 是否有估算（任一 row isEstimated = true）*/
  hasEstimate: boolean;
  /** 所有 KOL 訂單 id（憲章 #8）*/
  sourceOrderIds: string[];
};

export type KolRoiResult = {
  rows: KolRow[];
  kpi: KolKpi;
  /** ROI 冠軍（取 roi 最高前 3，已出貨且 roi != null）*/
  champions: KolRow[];
  /** 靜態洞察文字（憲章 #2 不呼叫 LLM，由數字生成）*/
  insightText: string;
  /** 洞察依據來源（憲章 #8）*/
  insightSourceOrderIds: string[];
};

// ─── 工具 ────────────────────────────────────────────────────────────────────

function statusToKind(status: string): KolOrderKind {
  if (
    status === "kol_shipped" ||
    status === "shipped" ||
    status === "confirmed"
  ) {
    return "shipped";
  }
  if (status === "pending_kol_choice") return "choice";
  return "pending";
}

function fmtNt(n: number): string {
  return `NT$${n.toLocaleString("zh-TW")}`;
}

// ─── 主函式 ──────────────────────────────────────────────────────────────────

/**
 * computeKolRoi
 *
 * @param orders  全通路訂單
 * @param menu    menu（查品項顯示名、成本）
 */
export function computeKolRoi(orders: Order[], menu: Menu): KolRoiResult {
  const kolOrders = orders.filter((o) => o.channel === "KOL");

  if (kolOrders.length === 0) {
    const empty: KolRoiResult = {
      rows: [],
      kpi: {
        kolCount: 0,
        shippedCount: 0,
        pendingCount: 0,
        choiceCount: 0,
        totalCost: 0,
        totalOrders: 0,
        totalRevenue: 0,
        avgRoi: null,
        hasEstimate: false,
        sourceOrderIds: [],
      },
      champions: [],
      insightText: "目前尚無 KOL 訂單資料。",
      insightSourceOrderIds: [],
    };
    return empty;
  }

  // 按 handle 群組——同一個 KOL 可能有多筆訂單（例如追加寄）
  const byHandle = new Map<string, Order[]>();
  for (const o of kolOrders) {
    const handle =
      o.recipient.igOrLine?.trim() ||
      o.recipient.name?.trim() ||
      o.id;
    if (!byHandle.has(handle)) byHandle.set(handle, []);
    byHandle.get(handle)!.push(o);
  }

  const rows: KolRow[] = [];

  for (const [handle, grpOrders] of byHandle) {
    let cost = 0;
    let isEstimated = false;
    const itemNameSet = new Set<string>();
    const sourceOrderIds: string[] = grpOrders.map((o) => o.id);

    for (const o of grpOrders) {
      for (const item of o.items) {
        const skuId = item.productSkuId;
        if (skuId) {
          const displayName = getDisplayName(skuId, menu);
          itemNameSet.add(displayName);
          const product = menu.products[skuId];
          if (product?.cost != null) {
            cost += product.cost * item.quantity;
          } else {
            // cost 未設：估算用 0 但標記為估算
            isEstimated = true;
          }
        } else {
          // 品項未識別：全估算
          isEstimated = true;
        }
      }
    }

    // 帶單：取非 pending_kol_choice 的訂單的 grossTotal 加總
    const revenue = grpOrders.reduce((s, o) => s + o.revenue.grossTotal, 0);

    // 折扣碼：用 igOrLine 當識別（真實折扣碼欄不存在於 Order schema）
    const discountCode = grpOrders[0]?.recipient.igOrLine?.trim() ?? handle;

    // ROI
    const roi = cost > 0 ? revenue / cost : null;

    // status：優先取最「進展最多」的
    const statusPriority: Record<string, number> = {
      kol_shipped: 10,
      shipped: 9,
      confirmed: 8,
      pending_kol_choice: 3,
    };
    const bestOrder = grpOrders.reduce((best, o) => {
      const bp = statusPriority[best.status] ?? 0;
      const op = statusPriority[o.status] ?? 0;
      return op > bp ? o : best;
    }, grpOrders[0]!);

    const kind = statusToKind(bestOrder.status);

    rows.push({
      handle,
      itemNames: [...itemNameSet].join("、") || "（未識別品項）",
      cost,
      discountCode,
      orderCount: grpOrders.length,
      revenue,
      roi,
      sourceOrderIds,
      status: bestOrder.status,
      kind,
      isEstimated,
    });
  }

  // 依 ROI 降冪排，null ROI 放後面
  rows.sort((a, b) => {
    if (a.roi === null && b.roi === null) return 0;
    if (a.roi === null) return 1;
    if (b.roi === null) return -1;
    return b.roi - a.roi;
  });

  // KPI
  const sourceOrderIds = kolOrders.map((o) => o.id);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const hasEstimate = rows.some((r) => r.isEstimated);
  const shippedCount = rows.filter((r) => r.kind === "shipped").length;
  const pendingCount = rows.filter((r) => r.kind === "pending").length;
  const choiceCount = rows.filter((r) => r.kind === "choice").length;

  const validRois = rows.filter((r) => r.roi !== null && r.cost > 0);
  const avgRoi =
    validRois.length > 0
      ? validRois.reduce((s, r) => s + (r.roi ?? 0), 0) / validRois.length
      : null;

  const kpi: KolKpi = {
    kolCount: rows.length,
    shippedCount,
    pendingCount,
    choiceCount,
    totalCost,
    totalOrders: kolOrders.length,
    totalRevenue,
    avgRoi,
    hasEstimate,
    sourceOrderIds,
  };

  // ROI 冠軍（已出貨、roi != null，取前 3）
  const champions = rows
    .filter((r) => r.kind === "shipped" && r.roi !== null)
    .slice(0, 3);

  // 靜態洞察文字（憲章 #2 數字生成，不呼叫 LLM）
  const insightText = buildInsightText(rows, kpi);

  return {
    rows,
    kpi,
    champions,
    insightText,
    insightSourceOrderIds: sourceOrderIds,
  };
}

// ─── 靜態洞察文字生成 ────────────────────────────────────────────────────────

function buildInsightText(rows: KolRow[], kpi: KolKpi): string {
  if (rows.length === 0) return "尚無 KOL 資料。";

  const parts: string[] = [];

  // 最高 ROI KOL
  const top = rows[0];
  if (top && top.roi !== null && top.roi > 0) {
    parts.push(
      `ROI 最高：${top.handle}（${top.itemNames}）帶單 ${top.roi.toFixed(1)}×。`
    );
  }

  // 低成本高 ROI 品項
  const lowCostHigh = rows
    .filter((r) => r.roi !== null && r.roi >= 10 && r.cost <= 150)
    .slice(0, 2);
  if (lowCostHigh.length > 0) {
    const items = [...new Set(lowCostHigh.flatMap((r) => r.itemNames.split("、")))];
    parts.push(`低成本高回報品項：${items.join("、")}，建議優先安排。`);
  }

  // 高成本中 ROI
  const highCostMid = rows.filter(
    (r) => r.roi !== null && r.roi >= 5 && r.roi < 10 && r.cost > 150
  );
  if (highCostMid.length > 0) {
    parts.push(
      `${highCostMid.length} 位 KOL 成本較高（>$150）但 ROI 中等（5-10×），宜挑高互動帳號合作。`
    );
  }

  // 無帶單
  const noBring = rows.filter((r) => r.revenue === 0 && r.kind !== "pending" && r.kind !== "choice");
  if (noBring.length > 0) {
    parts.push(`${noBring.length} 位已出貨但尚未帶單，建議追蹤。`);
  }

  // 平均 ROI
  if (kpi.avgRoi !== null) {
    parts.push(
      `全部合作平均 ROI ${kpi.avgRoi.toFixed(1)}×（${fmtNt(kpi.totalRevenue)} / ${fmtNt(kpi.totalCost)}）。`
    );
  }

  if (kpi.hasEstimate) {
    parts.push("⚠ 部分品項成本未設定，以 $0 估算——請補齊 menu.yaml cost 欄位。");
  }

  return parts.join(" ") || "資料計算完成。";
}
