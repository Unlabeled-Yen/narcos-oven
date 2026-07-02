import { useState } from "react";
import type { Menu, Order, PendingReasonCode } from "../domain/models";
import { db } from "../db/schema";
import { getDisplayName, explodeToAtoms } from "../domain/menu";

const REASON_LABEL: Record<PendingReasonCode, { label: string; color: string }> = {
  PAYMENT_NOT_CONFIRMED: { label: "未付款", color: "bg-yellow-100 text-yellow-900" },
  MISSING_BATCH_DATE: { label: "缺出爐日", color: "bg-orange-100 text-orange-900" },
  CONFLICT_DATE_C12_C28: { label: "日期衝突", color: "bg-red-100 text-red-900" },
  AMBIGUOUS_CHANNEL: { label: "通路不清", color: "bg-purple-100 text-purple-900" },
  UNKNOWN_PRODUCT: { label: "品項未歸類", color: "bg-red-200 text-red-900" },
  AMOUNT_MISMATCH: { label: "金額不符", color: "bg-red-200 text-red-900" },
  MISSING_RECIPIENT: { label: "缺收件人", color: "bg-orange-100 text-orange-900" },
  KOL_CHOICE_UNRESOLVED: { label: "KOL 待選", color: "bg-yellow-100 text-yellow-900" },
};

export function PendingBucket({
  orders,
  menu,
  onOrdersChanged,
}: {
  orders: Order[];
  menu?: Menu;
  onOrdersChanged?: () => void;
}) {
  if (orders.length === 0) {
    return (
      <p className="text-sm text-green-700 italic">
        ✨ 待處理桶清空、全部進主軌
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {orders.map((o) => (
        <PendingCard
          key={o.id}
          order={o}
          menu={menu}
          onChanged={onOrdersChanged}
        />
      ))}
    </div>
  );
}

function PendingCard({
  order: o,
  menu,
  onChanged,
}: {
  order: Order;
  menu?: Menu;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const primaryReason = o.pendingReasons[0]?.code;
  const showKolChoice = primaryReason === "KOL_CHOICE_UNRESOLVED" && menu;
  const showMissingDate = primaryReason === "MISSING_BATCH_DATE";
  const showAmbiguousChannel = primaryReason === "AMBIGUOUS_CHANNEL";
  const showUnknownProduct = primaryReason === "UNKNOWN_PRODUCT" && menu;

  async function assignKolChoice(skuId: string) {
    if (!menu) return;
    setBusy(true);
    const atoms = explodeToAtoms(skuId, menu);
    const newItems = [
      {
        productSkuId: skuId,
        rawName: getDisplayName(skuId, menu),
        quantity: 1,
        subtotal: null,
        atoms,
      },
    ];
    const filteredReasons = o.pendingReasons.filter(
      (r) => r.code !== "KOL_CHOICE_UNRESOLVED"
    );
    await db.orders.update(o.id, {
      items: [...o.items.filter((it) => it.productSkuId !== null), ...newItems],
      pendingReasons: filteredReasons,
      status: filteredReasons.length === 0 ? "confirmed" : o.status,
    });
    setBusy(false);
    onChanged?.();
  }

  async function fillBatchDate(date: string) {
    setBusy(true);
    const filteredReasons = o.pendingReasons.filter(
      (r) => r.code !== "MISSING_BATCH_DATE"
    );
    await db.orders.update(o.id, {
      batchDate: date,
      customer_wish_date: date,
      assignment_source: "customer_wish_kept",
      pendingReasons: filteredReasons,
      status: filteredReasons.length === 0 ? "confirmed" : o.status,
    });
    setBusy(false);
    onChanged?.();
  }

  async function assignChannel(channel: string) {
    setBusy(true);
    const filteredReasons = o.pendingReasons.filter(
      (r) => r.code !== "AMBIGUOUS_CHANNEL"
    );
    await db.orders.update(o.id, {
      channel: channel as Order["channel"],
      pendingReasons: filteredReasons,
      status: filteredReasons.length === 0 ? "confirmed" : o.status,
    });
    setBusy(false);
    onChanged?.();
  }

  async function assignProduct(skuId: string) {
    if (!menu) return;
    setBusy(true);
    const atoms = explodeToAtoms(skuId, menu);
    const newItems = o.items.map((it) =>
      it.productSkuId === null
        ? { ...it, productSkuId: skuId, atoms: atoms.map(a => ({ ...a, count: a.count * it.quantity })) }
        : it
    );
    const filteredReasons = o.pendingReasons.filter(
      (r) => r.code !== "UNKNOWN_PRODUCT"
    );
    await db.orders.update(o.id, {
      items: newItems,
      pendingReasons: filteredReasons,
      status: filteredReasons.length === 0 ? "confirmed" : o.status,
    });
    setBusy(false);
    onChanged?.();
  }

  return (
    <div className="bg-white border rounded p-3 text-sm shadow-sm">
      <div className="flex items-start justify-between mb-1">
        <div>
          <span className="font-mono text-xs text-gray-600">{o.id}</span>
          <span className="ml-2">{o.recipient.name ?? "—"}</span>
          <span className="ml-2 text-gray-500 text-xs">
            {o.recipient.convStore ?? o.channel ?? ""}
          </span>
        </div>
        <div className="flex gap-1 flex-wrap justify-end">
          {o.pendingReasons.map((r, i) => (
            <span
              key={i}
              className={`text-xs px-2 py-0.5 rounded ${REASON_LABEL[r.code].color}`}
            >
              {REASON_LABEL[r.code].label}
            </span>
          ))}
        </div>
      </div>
      <div className="text-xs text-gray-700 space-y-0.5 mb-2">
        {o.pendingReasons.map((r, i) => (
          <div key={i}>• {r.humanMessage}</div>
        ))}
      </div>

      {/* 互動 UI */}
      {showKolChoice && menu && (
        <div className="mt-2 pt-2 border-t">
          <div className="text-xs text-gray-500 mb-1">選 KOL 實際挑的品項：</div>
          <select
            disabled={busy}
            className="text-xs border rounded px-2 py-1 w-full"
            onChange={(e) => e.target.value && assignKolChoice(e.target.value)}
            defaultValue=""
          >
            <option value="">-- 選一個 SKU --</option>
            {Object.entries(menu.products).map(([sku, p]) => (
              <option key={sku} value={sku}>
                {p.display_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {showMissingDate && (
        <div className="mt-2 pt-2 border-t">
          <div className="text-xs text-gray-500 mb-1">填出爐日：</div>
          <input
            type="date"
            disabled={busy}
            className="text-xs border rounded px-2 py-1"
            onChange={(e) => e.target.value && fillBatchDate(e.target.value)}
          />
        </div>
      )}

      {showAmbiguousChannel && (
        <div className="mt-2 pt-2 border-t">
          <div className="text-xs text-gray-500 mb-1">指定通路：</div>
          <div className="flex gap-1 flex-wrap">
            {["面交_中壢", "面交_台中", "面交_其他", "宅配", "駐店", "活動", "私定", "待分類"].map(
              (ch) => (
                <button
                  key={ch}
                  disabled={busy}
                  onClick={() => assignChannel(ch)}
                  className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-900 px-2 py-1 rounded"
                >
                  {ch}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {showUnknownProduct && menu && (
        <div className="mt-2 pt-2 border-t">
          <div className="text-xs text-gray-500 mb-1">指定品項 SKU：</div>
          <select
            disabled={busy}
            className="text-xs border rounded px-2 py-1 w-full"
            onChange={(e) => e.target.value && assignProduct(e.target.value)}
            defaultValue=""
          >
            <option value="">-- 選一個 SKU --</option>
            {Object.entries(menu.products).map(([sku, p]) => (
              <option key={sku} value={sku}>
                {p.display_name}
              </option>
            ))}
          </select>
          <div className="mt-1 text-xs text-orange-700">
            💡 若確定是新品項、需在 menu.yaml 新增後再套用
          </div>
        </div>
      )}
    </div>
  );
}
