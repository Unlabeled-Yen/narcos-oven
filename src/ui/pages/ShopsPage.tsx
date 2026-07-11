/**
 * ShopsPage · 駐店合作店家管理 · Yen 2026-07-06 slice 2B
 *
 * 雇主自主 CRUD · 每家店設定：display_name / 地點 / 供貨品項清單 / 該店議價常態價
 * 手打單「駐店」tab 只列 active=true 的店家
 */
import { useEffect, useMemo, useState } from "react";
import type { PageProps } from "./types";
import type { ShopPartner, ShopPartnerItem } from "../../domain/models";
import {
  createShop, deactivateShop, deleteShop, listShops, reactivateShop,
  slugify, upsertShop,
} from "../../db/shops";

const F = {
  anton: "'Anton',sans-serif",
  tc: "'Noto Sans TC',sans-serif",
  mono: "'Space Mono',monospace",
} as const;

const C = {
  bg: "#0F0F12",
  card: "#141417",
  line: "#26262C",
  line2: "#1F1F24",
  ink: "#F5F4EF",
  mut: "#C9C9CF",
  mut2: "#8A8A93",
  mut3: "#6C6C74",
  acc: "var(--acc,#F5D400)",
  green: "#43B23C",
  red: "#E5352B",
  orange: "#E5622A",
} as const;

const inputStyle: React.CSSProperties = {
  background: "#0B0B0E", border: `1px solid ${C.line}`, color: C.ink,
  padding: "6px 10px", fontFamily: F.mono, fontSize: 12, width: "100%", boxSizing: "border-box",
};

const btn: React.CSSProperties = {
  fontFamily: F.mono, fontSize: 11, color: C.mut,
  background: "transparent", border: `1px solid ${C.line}`,
  padding: "6px 12px", cursor: "pointer", letterSpacing: ".05em",
};
const btnPrimary: React.CSSProperties = {
  ...btn, color: "#111", background: C.acc, border: `1px solid ${C.acc}`, fontWeight: 900,
};
const btnDanger: React.CSSProperties = { ...btn, color: C.red, borderColor: "#4a1010" };

export function ShopsPage({ menu }: PageProps) {
  const [shops, setShops] = useState<ShopPartner[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function refresh() {
    const list = await listShops(showInactive);
    setShops(list);
  }
  useEffect(() => { void refresh(); }, [showInactive]);

  const productOptions = useMemo(
    () => Object.entries(menu.products)
      .filter(([, p]) => p.status !== "draft")
      .map(([id, p]) => ({ id, name: p.display_name, wholesale: p.wholesale_price })),
    [menu.products]
  );

  const selected = shops.find((s) => s.id === selectedId) ?? null;

  async function handleCreate(displayName: string, location: string) {
    const id = slugify(displayName);
    if (shops.some((s) => s.id === id)) {
      setMsg({ ok: false, text: `❌ 已有同名店家（id=${id}）` });
      return;
    }
    const shop = await createShop({ id, display_name: displayName, location });
    setCreating(false);
    setSelectedId(shop.id);
    setMsg({ ok: true, text: `✓ 已新增店家「${displayName}」` });
    await refresh();
  }

  async function handleUpdate(updated: ShopPartner) {
    await upsertShop(updated);
    setMsg({ ok: true, text: `✓ 已儲存「${updated.display_name}」` });
    await refresh();
  }

  async function handleDeactivate(id: string) {
    await deactivateShop(id);
    setMsg({ ok: true, text: `已停用` });
    await refresh();
  }
  async function handleReactivate(id: string) {
    await reactivateShop(id);
    setMsg({ ok: true, text: `已重新啟用` });
    await refresh();
  }
  async function handleDelete(id: string) {
    if (!confirm(`確定刪除店家？既有訂單的 shop_partner 欄位會保留 id 但介面失去對照。`)) return;
    await deleteShop(id);
    if (selectedId === id) setSelectedId(null);
    setMsg({ ok: true, text: `已刪除` });
    await refresh();
  }

  return (
    <div className="h-full flex flex-col min-h-0" style={{ overflowY: "auto" }}>
      <div style={{ padding: "12px 24px 8px" }}>
        <div className="flex items-baseline flex-wrap" style={{ gap: 12, marginBottom: 8 }}>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, letterSpacing: ".14em" }}>SHOP PARTNERS · 駐店合作店家</span>
          <span style={{ fontFamily: F.tc, fontWeight: 900, fontSize: 16, color: C.ink }}>店家管理</span>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3 }}>
            共 {shops.length} 家 · 手打單「駐店」tab 只列 active 的店家
          </span>
          <div className="flex" style={{ gap: 8, marginLeft: "auto" }}>
            <label style={{ fontFamily: F.mono, fontSize: 11, color: C.mut2, display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              顯示停用店家
            </label>
            <button type="button" style={btnPrimary} onClick={() => setCreating((v) => !v)}>
              {creating ? "取消新增" : "＋ 新增店家"}
            </button>
          </div>
        </div>
        {msg && (
          <div style={{ fontFamily: F.mono, fontSize: 11, color: msg.ok ? C.green : C.red, padding: "6px 0" }}>
            {msg.text}
          </div>
        )}
        {creating && <NewShopForm onCreate={handleCreate} />}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 12, padding: "4px 24px 24px", flex: 1, minHeight: 0 }}>
        {/* LEFT · 店家清單 */}
        <div style={{ background: C.card, border: `1px solid ${C.line}`, padding: 8, minHeight: 0, overflowY: "auto" }}>
          {shops.length === 0 ? (
            <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mut3, padding: 12 }}>
              尚無店家 · 點右上「＋ 新增店家」
            </div>
          ) : (
            shops.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  background: selectedId === s.id ? "#1c1600" : "transparent",
                  border: `1px solid ${selectedId === s.id ? C.acc : C.line2}`,
                  color: C.ink, padding: "8px 10px", marginBottom: 4, cursor: "pointer",
                  opacity: s.active ? 1 : 0.5,
                }}
              >
                <div style={{ fontFamily: F.tc, fontWeight: 700, fontSize: 13 }}>
                  {s.display_name} {!s.active && <span style={{ fontFamily: F.mono, fontSize: 9, color: C.mut3 }}>· 已停用</span>}
                </div>
                <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, marginTop: 2 }}>
                  {s.location || "—"} · {s.items.length} 個供貨品項
                </div>
              </button>
            ))
          )}
        </div>

        {/* RIGHT · 店家詳情編輯 */}
        <div style={{ background: C.card, border: `1px solid ${C.line}`, padding: 16, minHeight: 0, overflowY: "auto" }}>
          {selected ? (
            <ShopEditor
              key={selected.id}
              shop={selected}
              productOptions={productOptions}
              onSave={handleUpdate}
              onDeactivate={() => handleDeactivate(selected.id)}
              onReactivate={() => handleReactivate(selected.id)}
              onDelete={() => handleDelete(selected.id)}
            />
          ) : (
            <div style={{ fontFamily: F.mono, fontSize: 12, color: C.mut3 }}>
              從左側選一家店 · 或點右上「＋ 新增店家」
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────

function NewShopForm({ onCreate }: { onCreate: (name: string, location: string) => void }) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  return (
    <div style={{ background: C.card, border: `1px dashed ${C.line}`, padding: 12, marginTop: 8, display: "flex", gap: 8, alignItems: "flex-end" }}>
      <div style={{ flex: 2 }}>
        <label style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, display: "block", marginBottom: 4 }}>店名（顯示用）</label>
        <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="例：shēngshēng coffee" />
      </div>
      <div style={{ flex: 1 }}>
        <label style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, display: "block", marginBottom: 4 }}>地點（選填）</label>
        <input style={inputStyle} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="例：台南" />
      </div>
      <button
        type="button"
        disabled={!name.trim()}
        style={{ ...btnPrimary, opacity: name.trim() ? 1 : 0.4, cursor: name.trim() ? "pointer" : "not-allowed" }}
        onClick={() => { onCreate(name.trim(), location.trim()); setName(""); setLocation(""); }}
      >
        建立
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────

function ShopEditor({
  shop, productOptions, onSave, onDeactivate, onReactivate, onDelete,
}: {
  shop: ShopPartner;
  productOptions: { id: string; name: string; wholesale: number | null }[];
  onSave: (s: ShopPartner) => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onDelete: () => void;
}) {
  const [displayName, setDisplayName] = useState(shop.display_name);
  const [location, setLocation] = useState(shop.location);
  const [items, setItems] = useState<ShopPartnerItem[]>(shop.items);
  const [notes, setNotes] = useState(shop.notes);

  const dirty =
    displayName !== shop.display_name ||
    location !== shop.location ||
    notes !== shop.notes ||
    JSON.stringify(items) !== JSON.stringify(shop.items);

  function addItem(productSkuId: string) {
    if (items.some((it) => it.productSkuId === productSkuId)) return;
    setItems((prev) => [...prev, { productSkuId, override_price: null }]);
  }
  function updateItem(idx: number, patch: Partial<ShopPartnerItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSave() {
    onSave({
      ...shop,
      display_name: displayName.trim() || shop.display_name,
      location: location.trim(),
      items,
      notes,
    });
  }

  const available = productOptions.filter((p) => !items.some((it) => it.productSkuId === p.id));

  return (
    <div>
      <div className="flex items-baseline flex-wrap" style={{ gap: 8, marginBottom: 12 }}>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, letterSpacing: ".14em" }}>SHOP</span>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3 }}>id: {shop.id}</span>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3 }}>
          {shop.active ? "✓ active" : "· inactive"}
        </span>
        <div className="flex" style={{ gap: 6, marginLeft: "auto" }}>
          {shop.active
            ? <button type="button" style={btn} onClick={onDeactivate}>停用</button>
            : <button type="button" style={btn} onClick={onReactivate}>啟用</button>}
          <button type="button" style={btnDanger} onClick={onDelete}>刪除</button>
          <button
            type="button"
            style={{ ...btnPrimary, opacity: dirty ? 1 : 0.4, cursor: dirty ? "pointer" : "not-allowed" }}
            disabled={!dirty}
            onClick={handleSave}
          >
            儲存變更
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, display: "block", marginBottom: 4 }}>店名</label>
          <input style={inputStyle} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <label style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, display: "block", marginBottom: 4 }}>地點</label>
          <input style={inputStyle} value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mut, letterSpacing: ".08em", marginBottom: 6 }}>
          供貨品項 · 各品項可 override 公定價（null = 用 menu.wholesale_price）
        </div>
        {items.length === 0 && (
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mut3, padding: "8px 0" }}>
            尚無品項 · 從下方下拉新增
          </div>
        )}
        {items.map((it, idx) => {
          const prod = productOptions.find((p) => p.id === it.productSkuId);
          const displayName = prod?.name ?? it.productSkuId;
          const publicPrice = prod?.wholesale;
          const effectivePrice = it.override_price ?? publicPrice ?? null;
          return (
            <div key={it.productSkuId} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, alignItems: "center", padding: "6px 8px", borderBottom: `1px solid ${C.line2}` }}>
              <div style={{ fontFamily: F.tc, fontSize: 12, color: C.ink }}>
                {displayName}
                {publicPrice === null && (
                  <span style={{ fontFamily: F.mono, fontSize: 9, color: C.orange, marginLeft: 6 }}>· 公定價未設</span>
                )}
              </div>
              <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mut2 }}>
                公定 {publicPrice != null ? `$${publicPrice}` : "—"}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3 }}>議價</span>
                <input
                  type="number"
                  style={{ ...inputStyle, width: 80 }}
                  value={it.override_price ?? ""}
                  placeholder="—"
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    updateItem(idx, { override_price: v === "" ? null : Number(v) });
                  }}
                />
                <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3 }}>
                  → 實 ${effectivePrice ?? "?"}
                </span>
              </div>
              <button type="button" style={btnDanger} onClick={() => removeItem(idx)}>移除</button>
            </div>
          );
        })}

        {available.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <label style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, display: "block", marginBottom: 4 }}>加入供貨品項</label>
            <select
              style={inputStyle}
              value=""
              onChange={(e) => { if (e.target.value) addItem(e.target.value); }}
            >
              <option value="">— 選擇 SKU —</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.wholesale != null ? `· 公定 $${p.wholesale}` : "· 未設公定價"}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <label style={{ fontFamily: F.mono, fontSize: 10, color: C.mut3, display: "block", marginBottom: 4 }}>備註</label>
        <textarea
          style={{ ...inputStyle, minHeight: 60, fontFamily: F.tc, fontSize: 12 }}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="運費、結帳窗口、對接人..."
        />
      </div>
    </div>
  );
}
