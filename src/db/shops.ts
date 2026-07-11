/**
 * 駐店合作店家 (shops) CRUD helpers · Yen 2026-07-06 slice 2B
 *
 * Shops registry 存 IndexedDB · 雇主在店家管理 UI 自主 CRUD
 * 手打單「駐店」tab 只能選 active=true 的店家
 */
import { db } from "./schema";
import { ShopPartnerSchema, type ShopPartner, type ShopPartnerItem } from "../domain/models";

export async function listShops(includeInactive = false): Promise<ShopPartner[]> {
  const all = await db.shops.orderBy("display_name").toArray();
  return includeInactive ? all : all.filter((s) => s.active);
}

export async function getShop(id: string): Promise<ShopPartner | undefined> {
  return db.shops.get(id);
}

export async function upsertShop(shop: ShopPartner): Promise<void> {
  const parsed = ShopPartnerSchema.parse({ ...shop, updated_at: new Date().toISOString() });
  await db.shops.put(parsed);
}

export async function createShop(input: {
  id: string;
  display_name: string;
  location?: string;
  items?: ShopPartnerItem[];
  notes?: string;
}): Promise<ShopPartner> {
  const now = new Date().toISOString();
  const shop = ShopPartnerSchema.parse({
    id: input.id,
    display_name: input.display_name,
    location: input.location ?? "",
    items: input.items ?? [],
    active: true,
    notes: input.notes ?? "",
    created_at: now,
    updated_at: now,
  });
  await db.shops.put(shop);
  return shop;
}

export async function deleteShop(id: string): Promise<void> {
  await db.shops.delete(id);
}

/** 停用（保留歷史）· 手打單就不再列出、但既有訂單仍可看到店名 */
export async function deactivateShop(id: string): Promise<void> {
  const s = await getShop(id);
  if (!s) return;
  await upsertShop({ ...s, active: false });
}

export async function reactivateShop(id: string): Promise<void> {
  const s = await getShop(id);
  if (!s) return;
  await upsertShop({ ...s, active: true });
}

/** slug 化：中英文空白/符號 → dash · 給新 shop id 用（雇主打「shēngshēng coffee」→ 「shengsheng-coffee」）*/
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s（）()「」【】\[\]{}<>_.,、，。？?!！:;：；/\\|`~@#$%^&*+=]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || `shop-${Date.now().toString(36)}`;
}
