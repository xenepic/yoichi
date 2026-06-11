import { Browser, chromium, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { AvailableSlot, Config } from './types';

interface Selectors {
  availableDate: string;
  nextMonth: string;
}

function loadSelectors(): Selectors {
  return {
    availableDate:
      process.env.SELECTOR_AVAILABLE_DATE ??
      'td[data-handler="selectDay"] a',
    nextMonth:
      process.env.SELECTOR_NEXT_MONTH ??
      'a.ui-datepicker-next:not(.ui-state-disabled)',
  };
}

async function navigateToTargetMonth(
  page: Page,
  sel: Selectors,
  targetDate: string
): Promise<void> {
  const [year, month] = targetDate.split('-').map(Number);
  const monthNames = ['1月','2月','3月','4月','5月','6月',
                      '7月','8月','9月','10月','11月','12月'];
  const targetMonthText = `${year}年${monthNames[month - 1]}`;

  for (let attempt = 0; attempt < 12; attempt++) {
    // Normalize whitespace (including &nbsp; U+00A0) before checking
    const bodyText = await page.evaluate(
      () => (document.body.textContent ?? '').replace(/[\s ]+/g, '')
    );
    if (bodyText.includes(targetMonthText)) {
      return;
    }

    const nextBtn = await page.$(sel.nextMonth);
    if (!nextBtn) {
      await saveErrorScreenshot(page, 'next-month-btn-not-found');
      console.error('「次月」ボタンが見つかりません。SELECTOR_NEXT_MONTH を確認してください。');
      return;
    }
    await nextBtn.click();
    await page.waitForTimeout(800);
  }
}

async function extractSlotsFromPage(
  page: Page,
  targetDate: string
): Promise<AvailableSlot[]> {
  // Extract slots entirely in-browser to traverse the DOM relationship:
  // div.cellBox > div.cellBox_one (time) + button.selBtn (available, text contains "残りN人")
  const rawSlots = await page.evaluate((): Array<{ time: string; remaining: number | null }> => {
    const results: Array<{ time: string; remaining: number | null }> = [];
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button.selBtn'));
    for (const btn of buttons) {
      const cellBox = btn.closest('.cellBox');
      if (!cellBox) continue;
      const timeEl = cellBox.querySelector('.cellBox_one');
      const rawTime = timeEl?.textContent?.trim() ?? '';
      const timeMatch = rawTime.match(/(\d{1,2}):(\d{2})/);
      if (!timeMatch) continue;
      const time = timeMatch[1].padStart(2, '0') + ':' + timeMatch[2];
      const btnText = btn.textContent?.trim() ?? '';
      const remMatch = btnText.match(/残り(\d+)/);
      const remaining = remMatch ? parseInt(remMatch[1], 10) : null;
      results.push({ time, remaining });
    }
    return results;
  });

  return rawSlots.map(({ time, remaining }) => ({
    date: targetDate,
    time,
    remaining,
    slotId: `${targetDate}T${time}`,
  }));
}

async function saveErrorScreenshot(page: Page, label: string): Promise<void> {
  fs.mkdirSync('screenshots', { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join('screenshots', `error-${label}-${ts}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.error(`エラー時スクリーンショット保存: ${filePath}`);
}

export async function checkAvailableSlots(
  config: Config
): Promise<AvailableSlot[]> {
  const sel = loadSelectors();
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: config.headless });
    const page = await browser.newPage();

    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9' });

    console.log(`予約ページを開いています: ${config.reservationUrl}`);
    await page.goto(config.reservationUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(1500);

    await navigateToTargetMonth(page, sel, config.targetDate);

    // 人数選択（select 要素があれば設定）
    const partySizeSelect = await page.$(
      'select[name*="people"], select[name*="person"], select[name*="nin"], select[id*="party"]'
    );
    if (partySizeSelect) {
      await partySizeSelect.selectOption(String(config.partySize));
      await page.waitForTimeout(500);
    }

    // jQuery UI datepicker のデータ属性で対象日を特定してクリック
    // data-month は 0-based（JavaScript 月インデックス）
    const [yearStr, monthStr, dayStr] = config.targetDate.split('-');
    const jsMonth = parseInt(monthStr, 10) - 1;
    const dateSel = `td[data-handler="selectDay"][data-year="${yearStr}"][data-month="${jsMonth}"] a[data-date="${parseInt(dayStr, 10)}"]`;
    const dateLink = await page.$(dateSel);

    if (!dateLink) {
      await saveErrorScreenshot(page, 'date-not-found');
      console.warn(
        `対象日 ${config.targetDate} の空き枠リンクが見つかりませんでした。この日の空き枠はありません。`
      );
      return [];
    }

    await dateLink.click();
    await page.waitForTimeout(1500);

    const slots = await extractSlotsFromPage(page, config.targetDate);
    console.log(`空き枠 ${slots.length} 件を検出しました`);
    return slots;

  } catch (err) {
    console.error('チェック中にエラーが発生しました:', err);
    throw err;
  } finally {
    await browser?.close();
  }
}
