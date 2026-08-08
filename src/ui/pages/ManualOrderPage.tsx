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
import { useEffect, useMemo, useState } from "react";
import type { PageProps } from "./types";
import type { ChannelId, Menu, ShopPartner } from "../../domain/models";
import { groupProducts } from "../../domain/menu";
import { buildManualOrder } from "../../domain/manual-order";
import { upsertOrder } from "../../db/orders";
import { listShops } from "../../db/shops";
import { exportManualOrders, filterManualOrders, type ManualExportFilter } from "../../output/manual-orders-excel";
import { CustomComboForm } from "./ManualOrderPage.CustomComboForm";

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

const EXPORT_FILTERS: ManualExportFilter[] = ["全部手打", "KOL", "駐店", "彈性", "宅配", "面交_中壢", "面交_台中", "面交_其他"];

type Mode = "consumer" | "shop" | "custom";

export function ManualOrderPage({ menu, orders, refreshOrders }: PageProps) {
  const [mode, setMode] = useState<Mode>("consumer");
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

  // ── 匯出 section state ──
  const [exportFilter, setExportFilter] = useState<ManualExportFilter>("全部手打");
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const exportPreviewCount = useMemo(
    () => filterManualOrders(orders, exportFilter, exportFrom || null, exportTo || null).length,
    [orders, exportFilter, exportFrom, exportTo]
  );

  function handleExport() {
    try {
      const result = exportManualOrders(
        orders,
        menu,
        exportFilter,
        exportFrom || null,
        exportTo || null
      );
      if (result.count === 0) {
        setExportMsg({ ok: false, text: "❌ 此範圍內無手打單、沒東西可匯" });
      } else {
        setExportMsg({
          ok: true,
          text: `✓ 匯出 ${result.count} 單 · 標籤 ${result.totalLabels} 張 · 金額 $${result.totalGross}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExportMsg({ ok: false, text: `❌ 匯出失敗：${msg}` });
    }
  }

  const productGroups = useMemo(() => groupProducts(menu), [menu]);

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
            雇主直接輸入 · 送出即進 DB · 跟 xlsx 匯入同一套資料
          </div>
        </div>

        {/* Mode tab · Yen 2026-07-06 slice 2C */}
        <div style={{ display: "flex", gap: 4, marginBottom: 14, borderBottom: `1px solid ${C.line}` }}>
          {(
            [
              { key: "consumer" as Mode, label: "消費者手打", hint: "KOL / 彈性 / 面交 / 宅配" },
              { key: "shop" as Mode, label: "駐店訂單", hint: "合作店家批發、附運費 + 結清狀態" },
              { key: "custom" as Mode, label: "客製組合", hint: "自由組合單品、分盒、自訂總價" },
            ]
          ).map((t) => {
            const active = mode === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setMode(t.key)}
                style={{
                  fontFamily: F.tc, fontWeight: active ? 900 : 400, fontSize: 13,
                  color: active ? "#111" : C.mut,
                  background: active ? C.acc : "transparent",
                  border: "none", borderBottom: `2px solid ${active ? C.acc : "transparent"}`,
                  padding: "10px 18px", cursor: "pointer", letterSpacing: ".04em",
                }}
                title={t.hint}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {mode === "shop" && (
          <ShopModeForm menu={menu} refreshOrders={refreshOrders} />
        )}

        {mode === "custom" && (
          <CustomComboForm menu={menu} refreshOrders={refreshOrders} />
        )}

        {mode === "consumer" && savedMsg && (
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

        {mode === "consumer" && (<>
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
                  {productGroups.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.items.map(({ skuId, product: p }) => (
                        <option key={skuId} value={skuId}>
                          {p.display_name} {p.price != null ? `· $${p.price}` : ""}
                        </option>
                      ))}
                    </optgroup>
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

        {/* ── 匯出 xlsx section ── */}
        <div style={{ marginTop: 28, borderTop: `1px dashed ${C.line}`, paddingTop: 20 }}>
          <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, letterSpacing: ".16em" }}>EXPORT · XLSX</div>
              <div style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 16, color: C.ink }}>匯出手打單</div>
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3 }}>
              分類 + 日期範圍 · 產出 xlsx 給雇主留存
            </div>
          </div>

          {exportMsg && (
            <div
              style={{
                fontFamily: F.tc, fontWeight: 700, fontSize: 12,
                color: exportMsg.ok ? "#111" : "#fff",
                background: exportMsg.ok ? C.green : C.red,
                padding: "8px 12px", marginBottom: 10,
              }}
            >
              {exportMsg.text}
            </div>
          )}

          <Section title="6 · 匯出設定" color={C.acc}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              <Field label="分類">
                <select
                  value={exportFilter}
                  onChange={(e) => setExportFilter(e.target.value as ManualExportFilter)}
                  style={inputStyle}
                >
                  {EXPORT_FILTERS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </Field>
              <Field label="下單日 · 起（可空）">
                <input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} style={inputStyle} />
              </Field>
              <Field label="下單日 · 訖（可空）">
                <input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} style={inputStyle} />
              </Field>
            </div>
            <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, marginTop: 12 }}>
              <div className="flex items-baseline" style={{ gap: 6 }}>
                <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3 }}>此範圍內</span>
                <span style={{ fontFamily: F.anton, fontSize: 20, color: exportPreviewCount > 0 ? C.acc : C.mut3 }}>{exportPreviewCount}</span>
                <span style={{ fontFamily: F.tc, fontSize: 11, color: C.mut2 }}>筆手打單</span>
              </div>
              <button
                type="button"
                onClick={handleExport}
                disabled={exportPreviewCount === 0}
                style={{
                  fontFamily: F.tc, fontWeight: 900, fontSize: 12,
                  color: exportPreviewCount === 0 ? C.mut3 : "#111",
                  background: exportPreviewCount === 0 ? "transparent" : C.acc,
                  border: `1px solid ${exportPreviewCount === 0 ? C.line : C.acc}`,
                  padding: "9px 18px", cursor: exportPreviewCount === 0 ? "not-allowed" : "pointer",
                  letterSpacing: ".05em",
                }}
              >
                📥 匯出 XLSX
              </button>
            </div>
          </Section>

          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, marginTop: 8 }}>
            檔名：<span style={{ color: C.mut2 }}>手打單_&lt;分類&gt;_&lt;日期範圍&gt;_匯出&lt;今日&gt;.xlsx</span>
          </div>
        </div>

        <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, marginTop: 20 }}>
          手打單 ID 格式：<span style={{ color: C.mut2 }}>MAN-&lt;channel&gt;-&lt;timestamp&gt;-&lt;rand&gt;</span>
        </div>
        </>)}
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

// ─────────────────────────────────────────────────────────────────────
// ShopModeForm · Yen 2026-07-06 slice 2C · 駐店訂單專用手打表單
// 選店家 → 品項限定該店 items[] → 每 item 帶入公定價（可 override）→ 到貨日 + 運費 + 費用結清
// ─────────────────────────────────────────────────────────────────────

type ShopItemLine = { key: number; skuId: string; quantity: number; unitPriceOverride: string };
let shopItemKeyCounter = 0;
const nextShopKey = () => ++shopItemKeyCounter;

function ShopModeForm({ menu, refreshOrders }: { menu: Menu; refreshOrders: () => Promise<void> }) {
  const [shops, setShops] = useState<ShopPartner[]>([]);
  const [shopId, setShopId] = useState<string>("");
  const [batchDate, setBatchDate] = useState(todayISO());
  const [items, setItems] = useState<ShopItemLine[]>([{ key: nextShopKey(), skuId: "", quantity: 1, unitPriceOverride: "" }]);
  const [freightCost, setFreightCost] = useState("");
  const [settled, setSettled] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { void (async () => setShops(await listShops(false)))(); }, []);

  const shop = useMemo(() => shops.find((s) => s.id === shopId) ?? null, [shops, shopId]);

  // 該店可供貨的品項 · 帶入 override_price 或 menu.wholesale_price
  const shopItemOptions = useMemo(() => {
    if (!shop) return [];
    return shop.items.map((it) => {
      const p = menu.products[it.productSkuId];
      const wholesale = p?.wholesale_price ?? null;
      const effective = it.override_price ?? wholesale;
      return {
        skuId: it.productSkuId,
        name: p?.display_name ?? it.productSkuId,
        wholesale,
        override: it.override_price,
        effective,
      };
    });
  }, [shop, menu]);

  // #3 分類 · 限定該店供貨品項子集，group 仍照 menu.yaml 定義、不因子集而改變
  type ShopItemOption = (typeof shopItemOptions)[number];
  function groupShopItemOptions(options: ShopItemOption[]) {
    const bySku = new Map(options.map((o) => [o.skuId, o]));
    return groupProducts(menu, options.map((o) => o.skuId)).map((g) => ({
      group: g.group,
      items: g.items.map(({ skuId }) => bySku.get(skuId)!),
    }));
  }

  // 計算每個 item 的實際單價（override -> shop item override -> menu.wholesale）+ subtotal
  const computedItems = useMemo(() => {
    return items.map((it) => {
      const shopItem = shop?.items.find((si) => si.productSkuId === it.skuId);
      const p = menu.products[it.skuId];
      const publicPrice = p?.wholesale_price ?? null;
      const shopPrice = shopItem?.override_price ?? null;
      const negotiated = it.unitPriceOverride === "" ? null : Number(it.unitPriceOverride);
      const unitPrice = negotiated ?? shopPrice ?? publicPrice ?? 0;
      const subtotal = unitPrice * it.quantity;
      return { ...it, unitPrice, subtotal, product: p, publicPrice, shopPrice };
    });
  }, [items, shop, menu]);

  const grossTotal = computedItems.reduce((s, it) => s + it.subtotal, 0);
  const actualReceived = grossTotal - (Number(freightCost) || 0);

  // 巴斯克總量 min 2 顆軟警告（Yen 2026-07-06：混口味 OK · 總量 < 2 時 warn）
  const basqueTotal = computedItems.reduce((s, it) => {
    const isBasque = it.product?.contains?.some((c) => /巴斯克$/.test(c.atom));
    return s + (isBasque ? it.quantity : 0);
  }, 0);
  const basqueWarning = basqueTotal > 0 && basqueTotal < 2;

  function addItem() { setItems((prev) => [...prev, { key: nextShopKey(), skuId: "", quantity: 1, unitPriceOverride: "" }]); }
  function removeItem(key: number) { setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.key !== key) : prev)); }
  function updateItem(key: number, patch: Partial<ShopItemLine>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function reset() {
    setBatchDate(todayISO());
    setItems([{ key: nextShopKey(), skuId: "", quantity: 1, unitPriceOverride: "" }]);
    setFreightCost("");
    setSettled(false);
    setNotes("");
  }

  async function handleSave() {
    if (saving) return;
    if (!shopId) { setMsg({ ok: false, text: "❌ 請先選店家" }); return; }
    const validItems = computedItems.filter((it) => it.skuId && it.quantity > 0);
    if (validItems.length === 0) { setMsg({ ok: false, text: "❌ 至少要有一個品項" }); return; }
    setSaving(true);
    try {
      const order = buildManualOrder(
        {
          channel: "駐店",
          order_date: todayISO(),
          customer_wish_date: null,
          batchDate,
          recipient: {
            name: shop?.display_name ?? shopId,
            igOrLine: null, phone: null, address: null, convStore: null,
          },
          items: validItems.map((it) => ({
            skuId: it.skuId,
            rawName: it.product?.display_name ?? it.skuId,
            quantity: it.quantity,
            subtotal: it.subtotal,
          })),
          grossTotal,
          freight: 0,
          discount: 0,
          notes: notes.trim() || undefined,
          shop_partner: shopId,
          override_unit_price: null,
          freight_cost: Number(freightCost) || 0,
          settled,
        },
        menu
      );
      await upsertOrder(order);
      await refreshOrders();
      setMsg({ ok: true, text: `✓ ${shop?.display_name} · $${grossTotal}（實收 $${actualReceived}）· ${order.id}` });
      reset();
    } catch (err) {
      setMsg({ ok: false, text: `❌ 失敗：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  }

  const available = shopItemOptions.filter((opt) => !items.some((it) => it.skuId === opt.skuId));

  if (shops.length === 0) {
    return (
      <div style={{ background: C.card, border: `1px dashed ${C.line}`, padding: 24, textAlign: "center" }}>
        <div style={{ fontFamily: F.tc, fontSize: 13, color: C.mut, marginBottom: 8 }}>尚未新增任何店家</div>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mut3 }}>
          先去「菜單 → 駐店店家」新增店家（設定該店賣什麼、公定價），才能在這裡打單
        </div>
      </div>
    );
  }

  return (
    <div>
      {msg && (
        <div style={{
          fontFamily: F.tc, fontWeight: 700, fontSize: 13,
          color: msg.ok ? "#111" : "#fff", background: msg.ok ? C.green : C.red,
          padding: "10px 14px", marginBottom: 14,
        }}>{msg.text}</div>
      )}

      <Section title="1 · 店家 + 到貨日" color={C.orange}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
          <Field label="合作店家">
            <select value={shopId} onChange={(e) => setShopId(e.target.value)} style={inputStyle}>
              <option value="">— 選店家 —</option>
              {shops.map((s) => (<option key={s.id} value={s.id}>{s.display_name}{s.location ? ` · ${s.location}` : ""}</option>))}
            </select>
          </Field>
          <Field label="到貨日期">
            <input type="date" value={batchDate} onChange={(e) => setBatchDate(e.target.value)} style={inputStyle} />
          </Field>
        </div>
        {shop && shop.items.length === 0 && (
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.orange, marginTop: 8 }}>
            ⚠ 此店家尚未設定任何供貨品項 · 先到「菜單 → 駐店店家」補
          </div>
        )}
      </Section>

      {shop && shop.items.length > 0 && (
        <>
          <Section title="2 · 品項 + 議價（可 override 店家常態價）" color={C.orange}>
            {computedItems.map((it) => (
              <div key={it.key} style={{
                background: C.card, border: `1px solid ${C.line2}`, padding: "8px 10px", marginBottom: 6,
                display: "grid", gridTemplateColumns: "2fr 80px 130px 130px 32px", gap: 8, alignItems: "center",
              }}>
                <select value={it.skuId} onChange={(e) => updateItem(it.key, { skuId: e.target.value, unitPriceOverride: "" })} style={inputStyle}>
                  <option value="">— 選品項 —</option>
                  {groupShopItemOptions(
                    shopItemOptions.filter((opt) => opt.skuId === it.skuId || !items.some((i) => i.skuId === opt.skuId))
                  ).map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.items.map((opt) => (
                        <option key={opt.skuId} value={opt.skuId}>
                          {opt.name} · ${opt.effective ?? "?"}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <input type="number" min={1} value={it.quantity}
                  onChange={(e) => updateItem(it.key, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                  style={{ ...inputStyle, textAlign: "right" as const }}
                />
                <input type="number" value={it.unitPriceOverride}
                  placeholder={it.publicPrice != null ? `常態 $${it.shopPrice ?? it.publicPrice}` : "議價 $"}
                  onChange={(e) => updateItem(it.key, { unitPriceOverride: e.target.value })}
                  style={{ ...inputStyle, textAlign: "right" as const }}
                  title="這次議價單價 · 空 = 用店家常態價 or 公定價"
                />
                <div style={{ fontFamily: F.anton, fontSize: 15, color: C.mut, textAlign: "right" }}>${it.subtotal}</div>
                <button type="button" onClick={() => removeItem(it.key)} disabled={items.length <= 1}
                  style={{
                    fontFamily: F.mono, fontSize: 13, color: items.length <= 1 ? C.mut3 : C.red,
                    background: "transparent", border: `1px solid ${items.length <= 1 ? C.line : C.red}`,
                    padding: "5px 0", cursor: items.length <= 1 ? "not-allowed" : "pointer",
                  }}
                >✕</button>
              </div>
            ))}
            {available.length > 0 && (
              <button type="button" onClick={addItem} style={{
                fontFamily: F.tc, fontWeight: 700, fontSize: 11, color: C.mut,
                background: "transparent", border: `1px dashed ${C.line}`,
                padding: "6px 12px", cursor: "pointer", marginTop: 4,
              }}>＋ 加一列品項</button>
            )}
            {basqueWarning && (
              <div style={{ fontFamily: F.mono, fontSize: 10, color: C.orange, marginTop: 8 }}>
                ⚠ 巴斯克單筆最低 2 顆（可混口味）· 目前 {basqueTotal} 顆 · 可存但雇主自行確認
              </div>
            )}
          </Section>

          <Section title="3 · 運費 + 費用結清" color={C.orange}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <Field label="運費（雇主吸收 · 從實收扣）">
                <input type="number" value={freightCost} onChange={(e) => setFreightCost(e.target.value)} placeholder="0" style={inputStyle} />
              </Field>
              <Field label="總金額（自動）">
                <div style={{ fontFamily: F.anton, fontSize: 20, color: C.acc, padding: "6px 0" }}>${grossTotal}</div>
              </Field>
              <Field label="實收（總 − 運費）">
                <div style={{ fontFamily: F.anton, fontSize: 20, color: C.green, padding: "6px 0" }}>${actualReceived}</div>
              </Field>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontFamily: F.mono, fontSize: 12, color: C.mut, cursor: "pointer" }}>
              <input type="checkbox" checked={settled} onChange={(e) => setSettled(e.target.checked)} />
              費用已結清（店家已付款）
            </label>
          </Section>

          <Section title="4 · 備註" color={C.mut2}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="收件人、聯絡方式、特殊說明..."
              style={{ ...inputStyle, resize: "vertical" as const }}
            />
          </Section>

          <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, marginTop: 4 }}>
            <button type="button" onClick={reset} style={{
              fontFamily: F.mono, fontSize: 11, color: C.mut2,
              background: "transparent", border: `1px solid ${C.line}`, padding: "9px 14px", cursor: "pointer",
            }}>清空</button>
            <button type="button" onClick={handleSave} disabled={saving} style={{
              fontFamily: F.tc, fontWeight: 900, fontSize: 14, color: "#111",
              background: C.acc, border: "none", padding: "11px 22px", cursor: saving ? "wait" : "pointer",
              letterSpacing: ".05em", opacity: saving ? 0.6 : 1,
            }}>{saving ? "存入中…" : "✓ 送出駐店訂單"}</button>
          </div>
        </>
      )}
    </div>
  );
}
