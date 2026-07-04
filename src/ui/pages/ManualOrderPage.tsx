/**
 * ManualOrderPage · 手打單（KOL / 駐店 / 彈性）
 *
 * Yen 2026-07-04：雇主手動輸入 · 送出即進 DB · 跟 xlsx 匯入的訂單走同一 shape
 *   通路：KOL / 駐店 / 彈性 · 也保留其他 channel 供彈性選
 *   品項：SKU 下拉（menu.products）· quantity + subtotal
 *   金額：可自動填（items subtotal 加總）or 手輸覆蓋
 *   送出：buildManualOrder → upsertOrder → refreshOrders
 *
 * Phase 2 · 匯出 xlsx 見同頁「匯出」button（待 Yen 確認格式後補實作）
 */
import { useMemo, useState } from "react";
import type { PageProps } from "./types";
import type { ChannelId } from "../../domain/models";
import { buildManualOrder } from "../../domain/manual-order";
import { upsertOrder } from "../../db/orders";

const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
} as const;

const C = {
  bg: "#0F0F12",
  card: "#141417",
  cardAlt: "#161619",
  line: "#26262C",
  line2: "#1F1F24",
  ink: "#F5F4EF",
  mut: "#C9C9CF",
  mut2: "#8A8A93",
  mut3: "#6C6C74",
  acc: "var(--acc,#F5D400)",
  green: "#43B23C",
  cyan: "#2AC7E8",
  red: "#E5352B",
  orange: "#E5622A",
  purple: "#8557C9",
} as const;

const CHANNEL_OPTIONS: ChannelId[] = ["KOL", "駐店", "彈性", "面交_中壢", "面交_台中", "面交_其他", "宅配"];
const CHANNEL_COLOR: Record<string, string> = {
  KOL: C.purple,
  駐店: C.orange,
  彈性: C.cyan,
  面交_中壢: C.green,
  面交_台中: C.green,
  面交_其他: C.green,
  宅配: C.cyan,
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type ItemInput = {
  key: number;
  skuId: string;
  quantity: number;
  subtotalOverride: string; // 空字串 = 用 SKU 預設 price
};

let itemKeyCounter = 0;
const nextKey = () => ++itemKeyCounter;

export function ManualOrderPage({ menu, refreshOrders }: PageProps) {
  const [channel, setChannel] = useState<ChannelId>("KOL");
  const [name, setName] = useState("");
  const [igOrLine, setIgOrLine] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [convStore, setConvStore] = useState("");
  const [orderDate, setOrderDate] = useState(todayISO());
  const [wishDate, setWishDate] = useState("");
  const [freight, setFreight] = useState("");
  const [discount, setDiscount] = useState("");
  const [grossOverride, setGrossOverride] = useState(""); // 空 = 自動加總
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemInput[]>([{ key: nextKey(), skuId: "", quantity: 1, subtotalOverride: "" }]);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const sortedSkus = useMemo(
    () => Object.entries(menu.products).sort(([, a], [, b]) => a.display_name.localeCompare(b.display_name)),
    [menu]
  );

  const computedItems = useMemo(() => {
    return items.map((it) => {
      const p = menu.products[it.skuId];
      const unitPrice = p?.price ?? 0;
      const subtotal =
        it.subtotalOverride === ""
          ? unitPrice * it.quantity
          : Number(it.subtotalOverride) || 0;
      return { ...it, unitPrice, subtotal, product: p };
    });
  }, [items, menu]);

  const autoGross = computedItems.reduce((s, it) => s + it.subtotal, 0);
  const gross = grossOverride === "" ? autoGross : Number(grossOverride) || 0;

  function addItem() {
    setItems((prev) => [...prev, { key: nextKey(), skuId: "", quantity: 1, subtotalOverride: "" }]);
  }
  function removeItem(key: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.key !== key) : prev));
  }
  function updateItem(key: number, patch: Partial<ItemInput>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function reset() {
    setName("");
    setIgOrLine("");
    setPhone("");
    setAddress("");
    setConvStore("");
    setWishDate("");
    setFreight("");
    setDiscount("");
    setGrossOverride("");
    setNotes("");
    setItems([{ key: nextKey(), skuId: "", quantity: 1, subtotalOverride: "" }]);
  }

  async function handleSave() {
    if (saving) return;
    // 基本檢查
    const validItems = computedItems.filter((it) => it.skuId && it.quantity > 0);
    if (validItems.length === 0) {
      setSavedMsg({ ok: false, text: "❌ 至少要有一個品項" });
      return;
    }
    setSaving(true);
    try {
      const order = buildManualOrder(
        {
          channel,
          order_date: orderDate || null,
          customer_wish_date: wishDate || null,
          recipient: {
            name: name.trim() || null,
            igOrLine: igOrLine.trim() || null,
            phone: phone.trim() || null,
            address: address.trim() || null,
            convStore: convStore.trim() || null,
          },
          items: validItems.map((it) => ({
            skuId: it.skuId,
            rawName: it.product?.display_name ?? it.skuId,
            quantity: it.quantity,
            subtotal: it.subtotal,
          })),
          grossTotal: gross,
          freight: Number(freight) || 0,
          discount: Number(discount) || 0,
          notes: notes.trim() || undefined,
        },
        menu
      );
      await upsertOrder(order);
      await refreshOrders();
      setSavedMsg({ ok: true, text: `✓ 已存入 · ${order.id} · ${gross} 元` });
      reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSavedMsg({ ok: false, text: `❌ 存入失敗：${msg}` });
    } finally {
      setSaving(false);
    }
  }

  const chColor = CHANNEL_COLOR[channel] ?? C.mut2;

  return (
    <div className="h-full flex flex-col min-h-0" style={{ overflowY: "auto", background: "#0A0A0C" }}>
      <div className="px-6 py-4" style={{ maxWidth: 1200, width: "100%", margin: "0 auto" }}>
        {/* Header */}
        <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, letterSpacing: ".16em" }}>MANUAL · ORDER</div>
            <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 20, color: C.ink }}>手打單</div>
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3 }}>
            雇主直接輸入 · KOL / 駐店 / 彈性單 · 送出即進 DB · 跟 xlsx 匯入同一套資料
          </div>
        </div>

        {savedMsg && (
          <div
            style={{
              fontFamily: F.tc, fontWeight: 700, fontSize: 13,
              color: savedMsg.ok ? "#111" : "#fff",
              background: savedMsg.ok ? C.green : C.red,
              padding: "10px 14px", marginBottom: 14,
            }}
          >
            {savedMsg.text}
          </div>
        )}

        {/* ── Section 1 · 通路 + 收件人 ── */}
        <Section title="1 · 通路 / 收件人" color={chColor}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            <Field label="通路">
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as ChannelId)}
                style={inputStyle}
              >
                {CHANNEL_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="姓名">
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="客人姓名" />
            </Field>
            <Field label="IG / LINE">
              <input value={igOrLine} onChange={(e) => setIgOrLine(e.target.value)} style={inputStyle} placeholder="@instagram" />
            </Field>
            <Field label="電話">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} placeholder="09xxx-xxx-xxx" />
            </Field>
            <Field label="超商店號">
              <input value={convStore} onChange={(e) => setConvStore(e.target.value)} style={inputStyle} placeholder="7-11 中壢店" />
            </Field>
            <Field label="宅配地址" span={2}>
              <input value={address} onChange={(e) => setAddress(e.target.value)} style={inputStyle} placeholder="市/區/路/號" />
            </Field>
          </div>
        </Section>

        {/* ── Section 2 · 日期 ── */}
        <Section title="2 · 日期" color={C.acc}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            <Field label="下單日">
              <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="指定出貨日（可空）">
              <input type="date" value={wishDate} onChange={(e) => setWishDate(e.target.value)} style={inputStyle} />
            </Field>
          </div>
        </Section>

        {/* ── Section 3 · 品項 ── */}
        <Section title="3 · 品項" color={C.acc}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
            {computedItems.map((it) => (
              <div
                key={it.key}
                style={{
                  background: C.card, border: `1px solid ${C.line2}`,
                  padding: "8px 10px",
                  display: "grid",
                  gridTemplateColumns: "2fr 90px 120px 32px",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <select
                  value={it.skuId}
                  onChange={(e) => updateItem(it.key, { skuId: e.target.value })}
                  style={inputStyle}
                >
                  <option value="">— 選 SKU —</option>
                  {sortedSkus.map(([id, p]) => (
                    <option key={id} value={id}>
                      {p.display_name} {p.price != null ? `· $${p.price}` : ""}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={it.quantity}
                  onChange={(e) => updateItem(it.key, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                  style={{ ...inputStyle, textAlign: "right" as const }}
                />
                <input
                  type="number"
                  value={it.subtotalOverride}
                  onChange={(e) => updateItem(it.key, { subtotalOverride: e.target.value })}
                  placeholder={String(it.subtotal)}
                  style={{ ...inputStyle, textAlign: "right" as const }}
                  title={`預設 = 單價 $${it.unitPrice} × ${it.quantity}`}
                />
                <button
                  type="button"
                  onClick={() => removeItem(it.key)}
                  disabled={items.length <= 1}
                  title={items.length <= 1 ? "至少要一個品項" : "移除此品項"}
                  style={{
                    fontFamily: F.mono, fontSize: 13,
                    color: items.length <= 1 ? C.mut3 : C.red,
                    background: "transparent", border: `1px solid ${items.length <= 1 ? C.line : C.red}`,
                    padding: "5px 0", cursor: items.length <= 1 ? "not-allowed" : "pointer",
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addItem}
            style={{
              fontFamily: F.tc, fontWeight: 700, fontSize: 11,
              color: C.mut, background: "transparent", border: `1px dashed ${C.line}`,
              padding: "6px 12px", cursor: "pointer",
            }}
          >
            ＋ 加一列品項
          </button>
        </Section>

        {/* ── Section 4 · 金額 ── */}
        <Section title="4 · 金額" color={C.acc}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <Field label={`合計（自動 $${autoGross}）· 可覆蓋`}>
              <input
                type="number"
                value={grossOverride}
                onChange={(e) => setGrossOverride(e.target.value)}
                placeholder={String(autoGross)}
                style={inputStyle}
              />
            </Field>
            <Field label="運費">
              <input type="number" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0" style={inputStyle} />
            </Field>
            <Field label="折扣">
              <input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" style={inputStyle} />
            </Field>
          </div>
          <div className="flex items-baseline" style={{ gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
            <span style={{ fontFamily: F.mono, fontSize: 11, color: C.mut2 }}>訂單合計：</span>
            <span style={{ fontFamily: F.anton, fontSize: 26, color: C.acc }}>${gross}</span>
          </div>
        </Section>

        {/* ── Section 5 · 備註 ── */}
        <Section title="5 · 備註（選填）" color={C.mut2}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="任何補充"
            rows={2}
            style={{ ...inputStyle, resize: "vertical" as const }}
          />
        </Section>

        {/* ── Actions ── */}
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, marginTop: 4 }}>
          <button
            type="button"
            onClick={reset}
            style={{
              fontFamily: F.mono, fontSize: 11, color: C.mut2,
              background: "transparent", border: `1px solid ${C.line}`,
              padding: "9px 14px", cursor: "pointer",
            }}
          >
            清空表單
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              fontFamily: F.tc, fontWeight: 900, fontSize: 14,
              color: "#111", background: C.acc, border: "none",
              padding: "11px 22px", cursor: saving ? "wait" : "pointer",
              letterSpacing: ".05em",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "存入中…" : "✓ 送出 · 進 DB"}
          </button>
        </div>

        <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, marginTop: 20 }}>
          手打單 ID 格式：<span style={{ color: C.mut2 }}>MAN-&lt;channel&gt;-&lt;timestamp&gt;-&lt;rand&gt;</span> · 匯出 xlsx 功能 Phase 2 補
        </div>
      </div>
    </div>
  );
}

// ── UI 原子 ──
const inputStyle = {
  fontFamily: "'Space Mono',monospace",
  fontSize: 12,
  color: "#F5F4EF",
  background: "#0A0A0C",
  border: "1px solid #3a3a40",
  padding: "6px 9px",
  outline: "none",
  width: "100%",
  boxSizing: "border-box" as const,
};

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: C.bg,
        border: `1px solid ${C.line}`,
        borderLeft: `3px solid ${color}`,
        padding: "10px 14px",
        marginBottom: 12,
      }}
    >
      <div style={{ fontFamily: F.mono, fontSize: 10, color, letterSpacing: ".12em", marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: number }) {
  return (
    <div style={span ? { gridColumn: `span ${span}` } : undefined}>
      <div style={{ fontFamily: F.mono, fontSize: 9, color: C.mut3, marginBottom: 3, letterSpacing: ".05em" }}>{label}</div>
      {children}
    </div>
  );
}
