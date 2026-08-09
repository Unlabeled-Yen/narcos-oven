/**
 * #2 客製化組合「分盒編輯器」（順位 11 · 2026-08-09 依 Yen 指示併入手打單）。
 *
 * 原本是 ManualOrderPage 的第三個獨立分頁（自帶收件人/總價欄、通路寫死
 * 「彈性」、日期寫死今天）；併入後這裡只剩「盒 × 品項」編輯器本體 +
 * 成本/標籤預覽，通路/收件人/日期/運費/折扣/備註全部共用消費者手打
 * 表單的欄位——這正是合併的實質好處：客製組合從此可以選通路、填指定日。
 *
 * UI 結構照 Yen 2026-08-06 定案：第 N 盒：〔品項×數量列表〕→ ＋新增一盒。
 * 標籤張數自動 = 盒數；成本即時預覽用 estimateCustomComboCost（跟存檔後
 * compute-payout.ts 的 cogsFor 同一套 fallback 規則、只是不寫回 DB）。
 */
import { useMemo } from "react";
import type { Menu } from "../../domain/models";
import { groupProducts } from "../../domain/menu";
import { estimateCustomComboCost, type ComboBox, type ComboLine } from "../../domain/custom-combo";

const F = { tc: "'Noto Sans TC',sans-serif", mono: "'Space Mono',monospace" } as const;
const C = {
  card: "#141417", line: "#26262C", ink: "#F5F4EF", mut: "#C9C9CF", mut3: "#6C6C74",
  acc: "var(--acc,#F5D400)", green: "#43B23C", red: "#E5352B",
} as const;

const inputStyle = {
  fontFamily: F.mono, fontSize: 12, color: C.ink,
  background: "#0A0A0C", border: `1px solid ${C.line}`,
  padding: "6px 10px", width: "100%", outline: "none",
} as const;

let boxKeyCounter = 0;
const nextBoxKey = () => String(++boxKeyCounter);
let lineKeyCounter = 0;
const nextLineKey = () => ++lineKeyCounter;

export type BoxState = { boxNo: string; lines: (ComboLine & { key: number })[] };

export function emptyBox(): BoxState {
  return { boxNo: nextBoxKey(), lines: [{ key: nextLineKey(), skuId: "", quantity: 1 }] };
}

/** BoxState → domain 的 ComboBox（過濾未選品項的空列） */
export function toComboBoxes(boxes: BoxState[]): ComboBox[] {
  return boxes.map((b) => ({
    boxNo: b.boxNo,
    lines: b.lines.filter((l) => l.skuId).map((l) => ({ skuId: l.skuId, quantity: l.quantity })),
  }));
}

export function CustomComboBoxesEditor({
  menu,
  boxes,
  onChange,
  grossTotal,
}: {
  menu: Menu;
  boxes: BoxState[];
  onChange: (next: BoxState[]) => void;
  /** 整單總價（來自共用金額欄）· 只拿來算毛利預覽 */
  grossTotal: number;
}) {
  // #2 選項清單 = menu.yaml 的單品層（category:"single"）
  const singleSkuIds = useMemo(
    () => Object.entries(menu.products).filter(([, p]) => p.category === "single").map(([id]) => id),
    [menu]
  );
  const grouped = useMemo(() => groupProducts(menu, singleSkuIds), [menu, singleSkuIds]);

  const validBoxes = useMemo(() => toComboBoxes(boxes), [boxes]);
  const costPreview = useMemo(() => estimateCustomComboCost(validBoxes, menu), [validBoxes, menu]);
  const profitPreview = grossTotal - costPreview;

  function addBox() { onChange([...boxes, emptyBox()]); }
  function removeBox(boxNo: string) { if (boxes.length > 1) onChange(boxes.filter((b) => b.boxNo !== boxNo)); }
  function addLine(boxNo: string) {
    onChange(boxes.map((b) => (b.boxNo === boxNo ? { ...b, lines: [...b.lines, { key: nextLineKey(), skuId: "", quantity: 1 }] } : b)));
  }
  function removeLine(boxNo: string, key: number) {
    onChange(boxes.map((b) => (b.boxNo === boxNo ? { ...b, lines: b.lines.length > 1 ? b.lines.filter((l) => l.key !== key) : b.lines } : b)));
  }
  function updateLine(boxNo: string, key: number, patch: Partial<ComboLine>) {
    onChange(boxes.map((b) => (b.boxNo === boxNo ? { ...b, lines: b.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) } : b)));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {boxes.map((box, boxIdx) => (
        <div key={box.boxNo} style={{ background: C.card, border: `1px solid ${C.line}`, padding: 12 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
            <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: C.acc }}>第 {boxIdx + 1} 盒</span>
            {boxes.length > 1 && (
              <button type="button" onClick={() => removeBox(box.boxNo)} style={{ fontFamily: F.mono, fontSize: 11, color: C.red, background: "transparent", border: "none", cursor: "pointer" }}>刪除此盒</button>
            )}
          </div>
          {box.lines.map((line) => (
            <div key={line.key} className="flex items-center" style={{ gap: 8, marginBottom: 6 }}>
              <select
                value={line.skuId}
                onChange={(e) => updateLine(box.boxNo, line.key, { skuId: e.target.value })}
                style={{ ...inputStyle, flex: 1 }}
              >
                <option value="">選品項…</option>
                {grouped.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.items.map(({ skuId, product }) => (
                      <option key={skuId} value={skuId}>{product.display_name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <input
                type="number" min={1} value={line.quantity}
                onChange={(e) => updateLine(box.boxNo, line.key, { quantity: Number(e.target.value) })}
                style={{ ...inputStyle, width: 70 }}
              />
              {box.lines.length > 1 && (
                <button type="button" onClick={() => removeLine(box.boxNo, line.key)} style={{ fontFamily: F.mono, fontSize: 14, color: C.mut3, background: "transparent", border: "none", cursor: "pointer" }}>✕</button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => addLine(box.boxNo)} style={{ fontFamily: F.mono, fontSize: 11, color: C.mut, background: "transparent", border: `1px dashed ${C.line}`, padding: "4px 10px", cursor: "pointer" }}>
            ＋ 加一列品項
          </button>
        </div>
      ))}

      <button type="button" onClick={addBox} style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 12, color: C.ink, background: "transparent", border: `1px dashed ${C.acc}`, padding: "8px 14px", cursor: "pointer" }}>
        ＋ 新增一盒
      </button>

      <div style={{ display: "flex", gap: 16, fontFamily: F.mono, fontSize: 12, color: C.mut, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
        <span>成本估算 <b style={{ color: C.ink }}>${costPreview.toFixed(2)}</b></span>
        <span>毛利估算 <b style={{ color: profitPreview >= 0 ? C.green : C.red }}>${profitPreview.toFixed(2)}</b></span>
        <span>標籤張數 <b style={{ color: C.ink }}>{boxes.length}</b>（自動 = 盒數）</span>
      </div>
    </div>
  );
}
