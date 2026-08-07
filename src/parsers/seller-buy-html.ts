/**
 * #12 賣貨便網頁存檔（.htm/.html）解析——只抽「訂單編號 + 指定出貨日」。
 *
 * 老闆語意：指定出貨日有時只出現在賣貨便網頁存檔、xlsx 匯出反而沒帶。
 * 這支 parser **不取代** seller-buy.ts、只補寫 customer_wish_date；其餘
 * 欄位（金額/品項/狀態…）一律不從 html 取，避免兩個來源打架（單一事實
 * 來源原則——真正的訂單資料主軌永遠是 xlsx）。
 *
 * 沒有 DOM 套件依賴（此專案本來就沒裝 jsdom/cheerio，瀏覽器執行期其實可以
 * 用原生 DOMParser，但 Node 測試環境沒有；為了同一份程式碼兩邊都能跑、
 * 也不必新增依賴，改用「按賣貨便固定樣板切區塊 + 正規表達式」抽取）。
 * 這是刻意的技術取捨、不是隨便亂猜：賣貨便頁面樣板改版才會讓這裡失效，
 * 跟 xlsx 欄位序號解析的脆弱性同一等級——一旦樣板不符，totalOrdersInHtml
 * 會是 0，呼叫端要 loud 報錯，不能靜默回傳空結果。
 */
import { extractSellerBuyShippingDate, parseSellerBuyOrderDate } from "../domain/batch-date";

const ORDER_ROW_SPLIT = '<tr class="storeproductlist">';
const ORDER_ID_RE = /id="orderno_\d+">([^<]+)</;
const ORDER_DATE_RE = /class="checkbox-input">\s*<label[^>]*>\s*(\d{4}\/\d{1,2}\/\d{1,2})/;

export type HtmlWishDateEntry = {
  order_id: string;
  customer_wish_date: string; // ISO YYYY-MM-DD
};

export type ParseSellerBuyHtmlResult = {
  /** 這份 html 裡總共辨識出幾筆訂單列（不管有沒有指定日）*/
  totalOrdersInHtml: number;
  /** 有指定出貨日的訂單（order_id + 解析出的 ISO 日期）*/
  entries: HtmlWishDateEntry[];
};

/**
 * @throws 如果完全找不到任何「訂單列」樣板（賣貨便頁面改版、或這根本不是
 *         賣貨便訂單頁）——loud fail，不回傳空結果假裝正常。
 */
export function parseSellerBuyHtml(
  html: string,
  sourceFile: string
): ParseSellerBuyHtmlResult {
  const rows = html.split(ORDER_ROW_SPLIT).slice(1);
  if (rows.length === 0) {
    throw new Error(
      `「${sourceFile}」不是可辨識的賣貨便訂單網頁存檔（找不到訂單列樣板，可能是頁面改版或存錯頁）`
    );
  }

  const entries: HtmlWishDateEntry[] = [];
  for (const row of rows) {
    const idMatch = ORDER_ID_RE.exec(row);
    if (!idMatch) continue; // 這個區塊沒有訂單編號、跳過（不當成訂單列）
    const orderId = idMatch[1]!.trim();

    const dateMatch = ORDER_DATE_RE.exec(row);
    const orderDate = dateMatch ? parseSellerBuyOrderDate(dateMatch[1]) : null;

    const wishDate = extractSellerBuyShippingDate(row, orderDate);
    if (wishDate) {
      entries.push({ order_id: orderId, customer_wish_date: wishDate });
    }
  }

  return { totalOrdersInHtml: rows.length, entries };
}
