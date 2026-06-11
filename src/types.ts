export interface AvailableSlot {
  date: string;              // "2026-06-26"
  time: string;              // "10:00"
  remaining: number | null;  // 残枠数（ページに表示がなければ null）
  slotId: string;            // 重複検出キー: "2026-06-26T10:00"
}

export interface NotifiedState {
  notifiedIds: string[];  // 通知済み slotId の配列
  lastChecked: string;    // ISO 8601 タイムスタンプ
}

export interface Config {
  reservationUrl: string;
  discordWebhookUrl: string;
  targetDate: string;      // "2026-06-26"
  partySize: number;       // 2
  stateFilePath: string;
  headless: boolean;
}
