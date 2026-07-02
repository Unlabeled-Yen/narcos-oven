import type { Menu, Order } from "../domain/models";
import { getDisplayName } from "../domain/menu";

export function OrdersTable({
  orders,
  menu,
}: {
  orders: Order[];
  menu: Menu;
}) {
  if (orders.length === 0) {
    return <p className="text-sm text-gray-500 italic">（本次無 confirmed 訂單）</p>;
  }

  return (
    <div className="overflow-x-auto bg-white rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-gray-100 text-gray-700 uppercase text-xs">
          <tr>
            <th className="p-2 text-left">訂單編號</th>
            <th className="p-2 text-left">收件人</th>
            <th className="p-2 text-left">門市</th>
            <th className="p-2 text-left">品項</th>
            <th className="p-2 text-right">總額</th>
            <th className="p-2 text-right">運費</th>
            <th className="p-2 text-right">標籤</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-t hover:bg-gray-50">
              <td className="p-2 font-mono text-xs">{o.id}</td>
              <td className="p-2">{o.recipient.name ?? "—"}</td>
              <td className="p-2">{o.recipient.convStore ?? "—"}</td>
              <td className="p-2">
                {o.items.map((it, i) => (
                  <div key={i} className="text-xs">
                    {it.productSkuId
                      ? `${getDisplayName(it.productSkuId, menu)} × ${it.quantity}`
                      : `❓ ${it.rawName.slice(0, 30)}`}
                  </div>
                ))}
              </td>
              <td className="p-2 text-right">${o.revenue.grossTotal}</td>
              <td className="p-2 text-right">${o.revenue.freight}</td>
              <td className="p-2 text-right font-bold">{o.labelCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
