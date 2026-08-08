/**
 * ManualOrderPage 的 #2 客製化組合表單（順位 11）。
 * 拆出來是為了不讓 ManualOrderPage.tsx 繼續變長（該檔已超過 500 行、屬既有債務、
 * 這裡至少不再往上加）。
 *
 * UI 結構照 Yen 2026-08-06 定案：第 N 盒：〔品項×數量列表〕→ ＋新增一盒。
 * 標籤張數自動 = 盒數；成本即時預覽用 estimateCustomComboCost（跟存檔後
 * compute-payout.ts 的 cogsFor 同一套 fallback 規則、只是不寫回 DB）。
 */
import { useMemo, useState } from "react";
import type { Menu } from "../../domain/models";
import { groupProducts } from "../../domain/menu";
import { buildManualOrder } from "../../domain/manual-order";
import { upsertOrder } from "../../db/orders";
import {
  validateCustomCombo,
  customComboItemsInput,
  estimateCustomComboCost,
  type ComboBox,
  type ComboLine,
} from "../../domain/custom-combo";

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

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let boxKeyCounter = 0;
const nextBoxKey = () => String(++boxKeyCounter);

type BoxState = { boxNo: string; lines: (ComboLine & { key: number })[] };
let lineKeyCounter = 0;
const nextLineKey = () => ++lineKeyCounter;

function emptyBox(): BoxState {
  return { boxNo: nextBoxKey(), lines: [{ key: nextLineKey(), skuId: "", quantity: 1 }] };
}

export function CustomComboForm({ menu, refreshOrders }: { menu: Menu; refreshOrders: () => Promise<void> }) {
  const [boxes, setBoxes] = useState<BoxState[]>(() => [emptyBox()]);
  const [recipientName, setRecipientName] = useState("");
  const [grossTotal, setGrossTotal] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // #2 選項清單 = menu.yaml 的單品層（category:"single"）
  const singleSkuIds = useMemo(
    () => Object.entries(menu.products).filter(([, p]) => p.category === "single").map(([id]) => id),
    [menu]
  );
  const grouped = useMemo(() => groupProducts(menu, singleSkuIds), [menu, singleSkuIds]);

  const validBoxes: ComboBox[] = useMemo(
    () => boxes.map((b) => ({ boxNo: b.boxNo, lines: b.lines.filter((l) => l.skuId).map((l) => ({ skuId: l.skuId, quantity: l.quantity })) })),
    [boxes]
  );
  const costPreview = useMemo(() => estimateCustomComboCost(validBoxes, menu), [validBoxes, menu]);
  const totalNum = Number(grossTotal) || 0;
  const profitPreview = totalNum - costPreview;

  function addBox() { setBoxes((prev) => [...prev, emptyBox()]); }
  function removeBox(boxNo: string) { setBoxes((prev) => (prev.length > 1 ? prev.filter((b) => b.boxNo !== boxNo) : prev)); }
  function addLine(boxNo: string) {
    setBoxes((prev) => prev.map((b) => (b.boxNo === boxNo ? { ...b, lines: [...b.lines, { key: nextLineKey(), skuId: "", quantity: 1 }] } : b)));
  }
  function removeLine(boxNo: string, key: number) {
    setBoxes((prev) => prev.map((b) => (b.boxNo === boxNo ? { ...b, lines: b.lines.length > 1 ? b.lines.filter((l) => l.key !== key) : b.lines } : b)));
  }
  function updateLine(boxNo: string, key: number, patch: Partial<ComboLine>) {
    setBoxes((prev) => prev.map((b) => (b.boxNo === boxNo ? { ...b, lines: b.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) } : b)));
  }

  function reset() {
    setBoxes([emptyBox()]);
    setRecipientName("");
    setGrossTotal("");
  }

  async function handleSave() {
    if (saving) return;
    const validation = validateCustomCombo(validBoxes, totalNum, menu);
    if (!validation.ok) {
      setMsg({ ok: false, text: `❌ ${validation.error}` });
      return;
    }
    setSaving(true);
    try {
      const items = customComboItemsInput(validBoxes, menu);
      const order = buildManualOrder(
        {
          channel: "彈性",
          order_date: todayISO(),
          customer_wish_date: null,
          recipient: { name: recipientName.trim() || "客製組合", igOrLine: null, phone: null, address: null, convStore: null },
          items,
          grossTotal: totalNum,
          labelCount: validBoxes.length, // #2b：標籤張數自動 = 盒數，不手填
          notes: "客製組合",
        },
        menu
      );
      await upsertOrder(order);
      await refreshOrders();
      setMsg({ ok: true, text: `✓ 客製組合 · $${totalNum}（${validBoxes.length} 盒）· ${order.id}` });
      reset();
    } catch (err) {
      setMsg({ ok: false, text: `❌ 失敗：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {msg && (
        <div style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 13, color: msg.ok ? "#111" : "#fff", background: msg.ok ? C.green : C.red, padding: "10px 14px" }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <label>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, marginBottom: 4 }}>收件人 / 客戶名稱</div>
          <input style={inputStyle} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="客製組合收件人" />
        </label>
        <label>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, marginBottom: 4 }}>整單總價（老闆報價）</div>
          <input style={inputStyle} type="number" min={0} value={grossTotal} onChange={(e) => setGrossTotal(e.target.value)} placeholder="1500" />
        </label>
      </div>

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
        <span>標籤張數 <b style={{ color: C.ink }}>{boxes.length}</b></span>
      </div>

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving}
        style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 13, color: "#111", background: C.acc, border: "none", padding: "12px 0", cursor: saving ? "wait" : "pointer" }}
      >
        {saving ? "儲存中…" : "送出客製組合"}
      </button>
    </div>
  );
}
