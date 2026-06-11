import { config } from './config';
import { checkAvailableSlots } from './checker';
import { readState, writeState, getNewSlots, buildNextState } from './storage';
import { sendDiscordNotification } from './notifier';

async function main(): Promise<void> {
  console.log(
    `=== 余市蒸溜所 空き枠チェック開始 [${new Date().toISOString()}] ===`
  );
  console.log(`対象日: ${config.targetDate} / 人数: ${config.partySize}名`);

  const prevState = readState(config.stateFilePath);
  console.log(`前回確認: ${prevState.lastChecked}`);
  console.log(`通知済み枠数: ${prevState.notifiedIds.length}`);

  const currentSlots = await checkAvailableSlots(config);
  const newSlots = getNewSlots(currentSlots, prevState);
  console.log(`新規空き枠: ${newSlots.length} 件`);

  if (newSlots.length > 0) {
    console.log('Discord に通知を送信しています...');
    await sendDiscordNotification(newSlots, config);
    console.log('通知完了');
  } else {
    console.log('新規枠なし。通知をスキップします。');
  }

  const nextState = buildNextState(prevState, newSlots);
  writeState(config.stateFilePath, nextState);
  console.log(`状態を保存しました: ${config.stateFilePath}`);
  console.log('=== チェック完了 ===');
}

main().catch(err => {
  console.error('致命的エラー:', err);
  process.exit(1);
});
