import { Browser, chromium, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { AvailableSlot, Config } from './types';

interface Selectors {
  availableDate: string;
  nextMonth: string;
  timeSlot: string;
  slotTime: string;
  slotFull: string;
  slotRemaining: string;
}

function loadSelectors(): Selectors {
  return {
    availableDate:
      process.env.SELECTOR_AVAILABLE_DATE ??
      'td.available a,td.open a,[data-available="true"]',
    nextMonth:
      process.env.SELECTOR_NEXT_MONTH ??
      'button.next,.calendar-next,[aria-label="次月"],[aria-label="翌月"]',
    timeSlot:
      process.env.SELECTOR_TIME_SLOT ??
      '.time-slot,.slot-item,[class*="timeslot"],[class*="time_slot"]',
    slotTime:
      process.env.SELECTOR_SLOT_TIME ??
      '.slot-time,.time,[class*="slot-time"]',
    slotFull:
      process.env.SELECTOR_SLOT_FULL ??
      '.full,.soldout,.closed,[data-status="full"]',
    slotRemaining:
      process.env.SELECTOR_SLOT_REMAINING ??
      '.remaining,.count,[class*="remain"]',
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
    const bodyText = await page.evaluate(() => document.body.innerText);
    if (
      bodyText.includes(targetMonthText) ||
      bodyText.includes(`${year}/${String(month).padStart(2, '0')}`) ||
      bodyText.includes(`${year}-${String(month).padStart(2, '0')}`)
    ) {
      return;
    }

    const nextBtn = await page.$(sel.nextMonth);
    if (!nextBtn) {
      console.warn('「次月」ボタンが見つかりません。SELECTOR_NEXT_MONTH を確認してください。');
      return;
    }
    await nextBtn.click();
    await page.waitForTimeout(800);
  }
}

async function extractSlotsFromPage(
  page: Page,
  sel: Selectors,
  targetDate: string
): Promise<AvailableSlot[]> {
  const slots = await page.$$(sel.timeSlot);
  const results: AvailableSlot[] = [];

  for (const slot of slots) {
    const isFull = (await slot.$(sel.slotFull)) !== null;
    if (isFull) continue;

    const timeEl = await slot.$(sel.slotTime);
    const rawText = timeEl
      ? await timeEl.innerText()
      : await slot.innerText();

    const timeMatch = rawText.match(/(\d{1,2})[：:：](\d{2})/);
    if (!timeMatch) continue;

    const time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;

    let remaining: number | null = null;
    const remEl = await slot.$(sel.slotRemaining);
    if (remEl) {
      const remText = await remEl.innerText();
      const remMatch = remText.match(/(\d+)/);
      if (remMatch) remaining = parseInt(remMatch[1], 10);
    } else {
      const slotText = await slot.innerText();
      const remMatch = slotText.match(/残り(\d+)/);
      if (remMatch) remaining = parseInt(remMatch[1], 10);
    }

    results.push({
      date: targetDate,
      time,
      remaining,
      slotId: `${targetDate}T${time}`,
    });
  }

  return results;
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

    // 対象日をカレンダーからクリック
    const dayNum = parseInt(config.targetDate.split('-')[2], 10);
    const availableDates = await page.$$(sel.availableDate);
    let dateClicked = false;

    for (const dateEl of availableDates) {
      const text = (await dateEl.innerText()).trim();
      if (text === String(dayNum)) {
        await dateEl.click();
        dateClicked = true;
        await page.waitForTimeout(1500);
        break;
      }
    }

    if (!dateClicked) {
      await saveErrorScreenshot(page, 'date-not-found');
      console.warn(
        `対象日 ${config.targetDate} の空き枠リンクが見つかりませんでした。この日の空き枠はありません。`
      );
      return [];
    }

    const slots = await extractSlotsFromPage(page, sel, config.targetDate);
    console.log(`空き枠 ${slots.length} 件を検出しました`);
    return slots;

  } catch (err) {
    console.error('チェック中にエラーが発生しました:', err);
    throw err;
  } finally {
    await browser?.close();
  }
}
