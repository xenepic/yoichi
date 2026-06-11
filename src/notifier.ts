import { AvailableSlot, Config } from './types';

interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  color: number;
  description: string;
  fields: DiscordField[];
  footer: { text: string };
  timestamp: string;
}

export function buildEmbed(slots: AvailableSlot[], config: Config): DiscordEmbed {
  const slotLines = slots
    .map(s => {
      const rem = s.remaining != null ? ` （残り${s.remaining}名）` : '';
      return `• ${s.time}${rem}`;
    })
    .join('\n');

  return {
    title: '🥃 余市蒸溜所 空き枠が見つかりました！',
    color: 0xf1b42f,
    description: `希望条件に合う空き枠が **${slots.length}件** 見つかりました。`,
    fields: [
      { name: '日付', value: config.targetDate, inline: true },
      { name: '人数', value: `${config.partySize}名`, inline: true },
      { name: '空き枠', value: slotLines, inline: false },
    ],
    footer: { text: `予約はこちら → ${config.reservationUrl}` },
    timestamp: new Date().toISOString(),
  };
}

export async function sendDiscordNotification(
  slots: AvailableSlot[],
  config: Config
): Promise<void> {
  const embed = buildEmbed(slots, config);
  const res = await fetch(config.discordWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord Webhook 送信失敗: HTTP ${res.status} ${body}`);
  }
}
