/**
 * #13 六入附醬 40ml 歷史資料遷移 — CLI 入口。
 *
 * 純邏輯（plan/apply/verifyConservation）在 src/domain/migrate-40ml.ts，
 * 這支腳本只管 argv 解析、讀寫 JSON、印報表——邏輯只有一份，跟 web app
 * 真正跑的程式碼一致，不是複製版。
 *
 * web app 的資料只在瀏覽器 IndexedDB，Node 進不去；唯一合法入口是
 * 「雇主匯出備份 → 這支腳本修正 → 雇主用『還原備份』讀回」。
 *
 * 用法（需用 tsx 執行，因為要 import ../src/domain 的 TS 原始碼）：
 *   npx tsx scripts/migrate-40ml.mjs --dry-run <備份檔.json>   # 只印計畫、不寫檔
 *   npx tsx scripts/migrate-40ml.mjs <備份檔.json>              # 寫出修正後的新檔
 *
 * 輸出檔名：<原檔名>.migrated-40ml-<timestamp>.json（絕不覆蓋原檔——
 * 原檔本身就是遷移前的安全備份）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  planMigration,
  applyMigration,
  verifyConservation,
} from "../src/domain/migrate-40ml.ts";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filePath = args.find((a) => !a.startsWith("--"));
  if (!filePath) {
    console.error("用法：npx tsx scripts/migrate-40ml.mjs [--dry-run] <備份檔.json>");
    process.exit(1);
  }

  const payload = JSON.parse(readFileSync(filePath, "utf-8"));
  if (payload.app !== "narcos-oven" || !Array.isArray(payload.orders)) {
    console.error("❌ 不是本系統的備份檔（app !== narcos-oven 或缺 orders 陣列）");
    process.exit(1);
  }

  const changes = planMigration(payload.orders);
  console.log(`計畫變更：${changes.length} 筆 atoms 項（來自六入組合 SKU）`);
  const byCombo = {};
  for (const c of changes) byCombo[c.productSkuId] = (byCombo[c.productSkuId] ?? 0) + 1;
  for (const [sku, n] of Object.entries(byCombo)) console.log(`  ${sku}: ${n} 筆`);

  if (changes.length === 0) {
    console.log("沒有需要遷移的訂單，結束。");
    return;
  }

  if (dryRun) {
    console.log("\n--dry-run，未寫入任何檔案。逐筆明細：");
    for (const c of changes) {
      console.log(`  訂單 ${c.order_id} · item[${c.item_index}] (${c.productSkuId}) · 香料堅果醬90ml → 40ml（count 不變 = ${c.count}）`);
    }
    return;
  }

  const nextOrders = applyMigration(payload.orders, changes);
  verifyConservation(payload.orders, nextOrders);

  const nextPayload = { ...payload, orders: nextOrders };
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const outPath = join(
    dirname(filePath),
    basename(filePath).replace(/\.json$/, "") + `.migrated-40ml-${ts}.json`
  );
  writeFileSync(outPath, JSON.stringify(nextPayload, null, 2) + "\n");
  console.log(`\n✅ 已寫出修正後備份：${outPath}`);
  console.log("下一步：到 web app「還原備份」匯入這個檔案（會整庫覆蓋，匯入前系統會再次要求 confirm）。");
}

main();
