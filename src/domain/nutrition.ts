/**
 * #15 營養成分表列印（純函式、可 Node 測）
 *
 * 老闆的例子：盒內 肉桂捲×3 + 磅蛋糕×2 + 醬×1 → 貼 3 張成分表
 * （每種品項一張，不是每顆一張）。
 *
 * 盒模型（2026-08-06 Yen 定案、見 docs/boss-issues-plan-2026-08.md 順位 3B）：
 *   - 組合品項：每 1 單位 = 1 盒，盒內容 = **目前** menu.yaml 的 contains
 *     （不是訂單當初存的 item.atoms——成分表要反映現在的真實配方，
 *     不是歷史快照，這點跟 COGS 算法故意不同）。
 *   - 散裝單品：同一張訂單裡所有散裝單品併成 1 盒，盒內每種各算一次
 *     （不管數量多少，1 種只算 1 張）。
 *   - 客製單（#2 尚未上線）：預留 box_no 欄位，一旦有值就照 box_no 分組，
 *     現在沒有客製單會產生 box_no，所以目前恆走上面兩條規則。
 *   - 守恆檢查：推導盒數 vs order.labelCount 不一致 → 進警示清單、
 *     不擋單（人工核對用），一致則不出現在警示清單。
 *
 * nutrition_label 三態：
 *   - 真檔名：可列印，進 sheets。
 *   - "none"：明確免貼，完全不出現在任何清單（不是警示、是已解決的狀態）。
 *   - null（未決）：不可列印（沒有檔案可印），但**不能靜默消失**——
 *     進 undecidedAtoms，張數算「本來需要幾張」讓人知道規模，count 不計入
 *     可列印的 totalSheets。
 */
import type { Menu, Order } from "./models";

export type NutritionBox = string[]; // 該盒內含的 atomId（相異即可，不重複）

export type NutritionBoxMismatch = {
  order_id: string;
  derivedBoxCount: number;
  labelCount: number;
};

export type NutritionSheetSummary = {
  atomId: string;
  /** 真實檔名（src/assets/nutrition/ 下）；只有 sheets[] 裡才會出現，undecidedAtoms 裡恆為 null */
  nutritionLabel: string | null;
  count: number;
  sourceOrderIds: string[];
};

export type NutritionResult = {
  /** 可列印（nutrition_label 是真檔名）*/
  sheets: NutritionSheetSummary[];
  /** Σ sheets[].count */
  totalSheets: number;
  /** nutrition_label 未決（null）的 atom——不可列印、但要讓人看見規模 */
  undecidedAtoms: NutritionSheetSummary[];
  /** 推導盒數 vs order.labelCount 不一致的訂單 */
  boxMismatchWarnings: NutritionBoxMismatch[];
};

/**
 * 把一張訂單拆成「盒」的清單，每盒是一組相異 atomId。
 * 匯出供測試直接檢查中間結果（不只測最終聚合數字）。
 */
export function deriveBoxesForOrder(order: Order, menu: Menu): NutritionBox[] {
  const boxes: NutritionBox[] = [];
  const explicitBoxes = new Map<string, Set<string>>();
  const singleAtoms = new Set<string>();
  let hasExplicitBoxNo = false;

  for (const item of order.items) {
    // box_no 是 #2 客製組合（順位 11）預留欄位，目前 UI 未寫入、item 上不存在此欄位時視為 undefined
    const boxNo = (item as { box_no?: string | null }).box_no ?? null;
    if (boxNo != null) {
      hasExplicitBoxNo = true;
      if (!explicitBoxes.has(boxNo)) explicitBoxes.set(boxNo, new Set());
      const set = explicitBoxes.get(boxNo)!;
      for (const a of item.atoms) set.add(a.atomId);
      continue;
    }

    const product = item.productSkuId ? menu.products[item.productSkuId] : undefined;
    if (product?.category === "combo") {
      // 每單位一盒，盒內容 = 目前 menu.yaml 的 contains（不是歷史 item.atoms）
      for (let i = 0; i < item.quantity; i++) {
        boxes.push(product.contains.map((c) => c.atom));
      }
    } else {
      // 散裝單品（含找不到 SKU 定義的 fallback）→ 併入本單共用散裝箱
      for (const a of item.atoms) singleAtoms.add(a.atomId);
    }
  }

  if (hasExplicitBoxNo) {
    for (const set of explicitBoxes.values()) boxes.push(Array.from(set));
  }
  if (singleAtoms.size > 0) {
    boxes.push(Array.from(singleAtoms));
  }
  return boxes;
}

export function nutritionSheetsFor(orders: Order[], menu: Menu): NutritionResult {
  const printable = new Map<string, { count: number; sourceOrderIds: Set<string> }>();
  const undecided = new Map<string, { count: number; sourceOrderIds: Set<string> }>();
  const boxMismatchWarnings: NutritionBoxMismatch[] = [];

  for (const order of orders) {
    const boxes = deriveBoxesForOrder(order, menu);
    if (boxes.length !== order.labelCount) {
      boxMismatchWarnings.push({
        order_id: order.id,
        derivedBoxCount: boxes.length,
        labelCount: order.labelCount,
      });
    }

    for (const box of boxes) {
      for (const atomId of box) {
        const atom = menu.atoms[atomId];
        const label = atom?.nutrition_label ?? null;
        if (label === "none") continue; // 明確免貼、完全不進任何清單

        const bucket = label != null ? printable : undecided;
        if (!bucket.has(atomId)) bucket.set(atomId, { count: 0, sourceOrderIds: new Set() });
        const entry = bucket.get(atomId)!;
        entry.count += 1;
        entry.sourceOrderIds.add(order.id);
      }
    }
  }

  const toSummary = (
    map: Map<string, { count: number; sourceOrderIds: Set<string> }>,
    labelFor: (atomId: string) => string | null
  ): NutritionSheetSummary[] =>
    Array.from(map.entries())
      .map(([atomId, v]) => ({
        atomId,
        nutritionLabel: labelFor(atomId),
        count: v.count,
        sourceOrderIds: Array.from(v.sourceOrderIds).sort(),
      }))
      .sort((a, b) => a.atomId.localeCompare(b.atomId));

  const sheets = toSummary(printable, (atomId) => menu.atoms[atomId]?.nutrition_label ?? null);
  const undecidedAtoms = toSummary(undecided, () => null);
  const totalSheets = sheets.reduce((s, x) => s + x.count, 0);

  return { sheets, totalSheets, undecidedAtoms, boxMismatchWarnings };
}
