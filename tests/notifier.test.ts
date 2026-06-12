import { buildEmbed } from '../src/notifier';
import { AvailableSlot, Config } from '../src/types';

const testConfig: Config = {
  reservationUrl: 'https://distillery.nikka.com/yoichi/reservation',
  discordWebhookUrl: 'https://discord.com/api/webhooks/test/token',
  targetDate: '2026-06-26',
  partySize: 2,
  stateFilePath: 'data/notified-slots.json',
  headless: true,
};

const testSlots: AvailableSlot[] = [
  { date: '2026-06-26', time: '10:00', remaining: 5, slotId: '2026-06-26T10:00' },
  { date: '2026-06-26', time: '10:30', remaining: null, slotId: '2026-06-26T10:30' },
];

describe('buildEmbed', () => {
  it('タイトルに蒸溜所名を含む', () => {
    const embed = buildEmbed(testSlots, testConfig);
    expect(embed.title).toContain('余市蒸溜所');
  });

  it('日付フィールドに targetDate を含む', () => {
    const embed = buildEmbed(testSlots, testConfig);
    const dateField = embed.fields.find(f => f.name === '日付');
    expect(dateField?.value).toBe('2026-06-26');
  });

  it('人数フィールドに partySize を含む', () => {
    const embed = buildEmbed(testSlots, testConfig);
    const partyField = embed.fields.find(f => f.name === '人数');
    expect(partyField?.value).toBe('2名');
  });

  it('空き枠フィールドにすべてのスロット時刻を含む', () => {
    const embed = buildEmbed(testSlots, testConfig);
    const slotField = embed.fields.find(f => f.name === '空き枠');
    expect(slotField?.value).toContain('10:00');
    expect(slotField?.value).toContain('10:30');
  });

  it('残枠数が null でない場合は表示する', () => {
    const embed = buildEmbed(testSlots, testConfig);
    const slotField = embed.fields.find(f => f.name === '空き枠');
    expect(slotField?.value).toContain('残り5名');
  });

  it('残枠数が null の場合は残数表示を省略する', () => {
    const embed = buildEmbed(testSlots, testConfig);
    const slotField = embed.fields.find(f => f.name === '空き枠');
    expect(slotField?.value).not.toContain('残り null');
  });

  it('embed の url に予約ページ URL が設定される', () => {
    const embed = buildEmbed(testSlots, testConfig);
    expect(embed.url).toContain('distillery.nikka.com');
  });

  it('予約 field にクリッカブルリンクが含まれる', () => {
    const embed = buildEmbed(testSlots, testConfig);
    const reservationField = embed.fields.find(f => f.name === '予約');
    expect(reservationField?.value).toContain('distillery.nikka.com');
    expect(reservationField?.value).toMatch(/\[.*\]\(.*\)/);
  });

  it('color が数値である', () => {
    const embed = buildEmbed(testSlots, testConfig);
    expect(typeof embed.color).toBe('number');
  });
});
