import dotenv from 'dotenv';
import { Config } from './types';

dotenv.config();

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`必須の環境変数が未設定です: ${name}`);
  return val;
}

export const config: Config = {
  reservationUrl:
    process.env.RESERVATION_URL ??
    'https://distillery.nikka.com/yoichi/reservation',
  discordWebhookUrl: requireEnv('DISCORD_WEBHOOK_URL'),
  targetDate: process.env.TARGET_DATE ?? '2026-06-26',
  partySize: parseInt(process.env.PARTY_SIZE ?? '2', 10),
  stateFilePath: process.env.STATE_FILE_PATH ?? 'data/notified-slots.json',
  headless: process.env.HEADLESS !== 'false',
};
