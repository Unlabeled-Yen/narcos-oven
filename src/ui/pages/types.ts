import type { Menu, Order } from "../../domain/models";
import type { NavKey } from "../brand/CommandBar";

/**
 * 每一頁的統一契約。
 * AppShell 提供資料 + 導覽，頁面自己 render 自己的 PageHeader + body。
 * 頁面「不」render CommandBar / WarningTape / GrainOverlay（那是 shell 的事）。
 */
export type PageProps = {
  /** 全通路訂單（含 pending / shipped / disappeared） */
  orders: Order[];
  /** menu.yaml 載入結果（唯一真相、禁 hardcode 品項） */
  menu: Menu;
  /** DB 變動後重抓 orders（頁面內做 mutation 後呼叫） */
  refreshOrders: () => Promise<void>;
  /** 導覽到另一頁 */
  navigate: (key: NavKey) => void;
  /** 目前 active 頁 */
  active: NavKey;
  /** 觸發拖檔上傳（開檔案選擇器） */
  onUploadClick: () => void;
  /**
   * #11+#14 全域「當前批次」（ISO 日期或 null）。走 URL hash query（`#/worksheet?batch=…`），
   * 排程/工單/出貨明細/印標籤四頁共用同一份、雙向連動、重新整理也保留。
   */
  currentBatch: string | null;
  /** 更新全域當前批次（連帶更新 hash） */
  setCurrentBatch: (batch: string | null) => void;
};

export type { NavKey };
