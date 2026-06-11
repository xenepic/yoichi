/**
 * 予約ページを開いてスクリーンショットを保存するデバッグスクリプト。
 * セレクタ調査のために使う。本番監視では使用しない。
 *
 * 使い方: npm run inspect
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const RESERVATION_URL =
  process.env.RESERVATION_URL ??
  'https://distillery.nikka.com/yoichi/reservation';

async function inspect(): Promise<void> {
  fs.mkdirSync('screenshots', { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log(`Opening: ${RESERVATION_URL}`);
  await page.goto(RESERVATION_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const ss1 = path.join('screenshots', 'inspect-01-initial.png');
  await page.screenshot({ path: ss1, fullPage: true });
  console.log(`Screenshot saved: ${ss1}`);

  const elements = await page.evaluate(() => {
    const results: { tag: string; id: string; classes: string; text: string }[] = [];
    document
      .querySelectorAll('input, select, button, a, [role="button"], td, th')
      .forEach(el => {
        results.push({
          tag: el.tagName,
          id: (el as HTMLElement).id,
          classes: (el as HTMLElement).className,
          text: (el as HTMLElement).innerText?.slice(0, 60) ?? '',
        });
      });
    return results;
  });

  console.log('\n--- ページ上のインタラクティブ要素 ---');
  elements.forEach(e => {
    console.log(`[${e.tag}] id="${e.id}" class="${e.classes}" text="${e.text}"`);
  });

  console.log('\n--- 確認するポイント ---');
  console.log('1. カレンダー日付セル: TD タグのクラス名（例: available, open）');
  console.log('2. 次月ボタン: BUTTON の text や aria-label（例: 次へ, ▶, 翌月）');
  console.log('3. 時間枠要素: 日付クリック後に現れるクラス名');
  console.log('4. 満席表示: ×, 満席, soldout, closed 等');
  console.log('5. 残席数: 残りN名 等のテキストパターン');

  console.log('\nブラウザを開いたまま待機中... Ctrl+C で終了してください');
  await page.waitForTimeout(60_000);
  await browser.close();
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
