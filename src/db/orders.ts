/**
 * Orders 表 CRUD wrappers
 */
import type { ChannelId, Order } from "../domain/models";
import { db } from "./schema";

export async function upsertOrder(order: Order): Promise<void> {
  await db.orders.put(order);
}

export async function upsertMany(orders: Order[]): Promise<void> {
  await db.orders.bulkPut(orders);
}

/** 取某通路 active 訂單（可能參與下次 diff 的）。 */
export async function getActiveByChannels(
  channels: ChannelId[]
): Promise<Order[]> {
  return db.orders
    .where("channel")
    .anyOf(channels)
    .filter((o) => isActive(o))
    .toArray();
}

/** 判定「active」：非終端狀態（可能還會出現在下次匯入）。 */
export function isActive(o: Order): boolean {
  return (
    o.status !== "shipped" &&
    o.status !== "canceled" &&
    o.status !== "kol_shipped"
  );
}

export async function getById(id: string): Promise<Order | undefined> {
  return db.orders.get(id);
}

export async function markDisappeared(
  orderIds: string[],
  disappearedAt: string
): Promise<void> {
  await db.orders
    .where("id")
    .anyOf(orderIds)
    .modify({
      status: "disappeared_pending_resolution",
      disappeared_at: disappearedAt,
    });
}

export async function resolveDisappearance(
  orderId: string,
  resolution: "shipped" | "canceled" | "kept_active",
  resolvedAt: string
): Promise<void> {
  const status =
    resolution === "shipped"
      ? "shipped"
      : resolution === "canceled"
      ? "canceled"
      : "confirmed"; // kept_active → 恢復到 confirmed（下次匯入再修正）
  await db.orders.update(orderId, {
    status,
    disappeared_resolution: resolution,
    last_seen_at: resolvedAt,
    disappeared_at: null,
  });
}

/** 全部訂單（給儀表板用）。 */
export async function getAll(): Promise<Order[]> {
  return db.orders.toArray();
}

/** dev helper：清空。 */
export async function clearAll(): Promise<void> {
  await db.transaction("rw", db.orders, db.import_runs, db.order_changes, async () => {
    await db.orders.clear();
    await db.import_runs.clear();
    await db.order_changes.clear();
  });
}
