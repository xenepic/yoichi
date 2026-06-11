# 余市蒸溜所 空き枠監視ツール Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 余市蒸溜所の予約ページ（https://distillery.nikka.com/yoichi/reservation）を定期監視し、2026-06-26・2名の条件に合う空き枠が出たときだけ Discord Webhook に通知する Node.js/TypeScript ツールを作る。

**Architecture:** Playwright でブラウザを起動→予約ページを開く→対象日の空き枠を抽出→前回通知済み枠（`data/notified-slots.json`）と差分比較→新規枠のみ Discord へ通知→状態を更新して保存。GitHub Actions の cron で 15 分間隔実行し、`data/notified-slots.json` をリポジトリにコミットバックして状態を永続化する。

**Tech Stack:** Node.js 20+, TypeScript 5, Playwright 1.x, dotenv, Jest + ts-jest, GitHub Actions

---

## File Structure

```
yoichi/
├── src/
│   ├── types.ts          # AvailableSlot / NotifiedState / Config インターフェース
│   ├── config.ts         # .env 読み込み・バリデーション → typed config オブジェクト export
│   ├── storage.ts        # data/notified-slots.json の読み書き・差分抽出
│   ├── checker.ts        # Playwright でページ開いてスロット抽出
│   ├── notifier.ts       # Discord Webhook 送信・embed 整形
│   └── main.ts           # check → diff → notify → save の統括
├── scripts/
│   └── inspect.ts        # 1回だけ実行するデバッグ用スクリプト（スクリーンショット取得）
├── tests/
│   ├── storage.test.ts   # storage.ts のユニットテスト
│   └── notifier.test.ts  # notifier.ts embed 整形のユニットテスト
├── data/
│   └── .gitkeep          # notified-slots.json がランタイムに生成されるディレクトリ
├── screenshots/           # inspect.ts / エラー時のスクリーンショット置き場（.gitignore 対象）
├── .env.example
├── .github/
│   └── workflows/
│       └── monitor.yml
├── package.json
├── tsconfig.json
├── jest.config.ts
└── README.md
```

---

## Task 1: プロジェクト初期化（package.json / tsconfig / jest 設定）

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `jest.config.ts`

- [ ] **Step 1: package.json を作成する**

```json
{
  "name": "yoichi-monitor",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "check": "ts-node src/main.ts",
    "inspect": "ts-node scripts/inspect.ts",
    "test": "jest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "playwright": "^1.45.0"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "@types/node": "^20.14.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.5",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: tsconfig.json を作成する**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*", "scripts/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: jest.config.ts を作成する**

```typescript
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/checker.ts'],
};

export default config;
```

- [ ] **Step 4: 必要なディレクトリとファイルを作成する**

```bash
mkdir -p data screenshots .github/workflows src scripts tests
echo "" > data/.gitkeep
```

- [ ] **Step 5: .gitignore を作成する**

```gitignore
node_modules/
dist/
.env
screenshots/
```

- [ ] **Step 6: 依存パッケージをインストールする**

```bash
npm install
```

Expected: `node_modules/` が作成される。

- [ ] **Step 7: Playwright の Chromium をインストールする**

```bash
npx playwright install chromium
```

Expected: Chromium がダウンロードされる。

- [ ] **Step 8: コミット**

```bash
git init
git add package.json tsconfig.json jest.config.ts .gitignore data/.gitkeep
git commit -m "chore: initialize project scaffold"
```

---

## Task 2: 型定義・設定読み込み（types.ts / config.ts / .env.example）

**Files:**
- Create: `src/types.ts`
- Create: `src/config.ts`
- Create: `.env.example`

- [ ] **Step 1: src/types.ts を作成する**

```typescript
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
```

- [ ] **Step 2: src/config.ts を作成する**

```typescript
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
```

- [ ] **Step 3: .env.example を作成する**

```dotenv
# Discord Webhook URL（必須）
# Discord サーバー設定 > テキストチャンネル > インテグレーション > ウェブフック で取得
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN

# 予約ページ URL（デフォルト値あり）
RESERVATION_URL=https://distillery.nikka.com/yoichi/reservation

# 希望日（YYYY-MM-DD 形式）
TARGET_DATE=2026-06-26

# 希望人数
PARTY_SIZE=2

# 状態ファイルパス（デフォルト値あり）
STATE_FILE_PATH=data/notified-slots.json

# デバッグ: false にするとブラウザを表示する（ローカル確認用）
HEADLESS=true

# ========== Playwright セレクタ設定 ==========
# inspect スクリプトの出力を見て実際のページに合わせて更新する。

# カレンダー上の「空きあり」日付セル（クリック可能な要素）
SELECTOR_AVAILABLE_DATE=td.available a,td.open a,[data-available="true"]

# 「次の月へ」ボタン（カレンダーをページング）
SELECTOR_NEXT_MONTH=button.next,.calendar-next,[aria-label="次月"],[aria-label="翌月"]

# 日付クリック後に現れる時間枠コンテナ
SELECTOR_TIME_SLOT=.time-slot,.slot-item,[class*="timeslot"],[class*="time_slot"]

# 時間枠コンテナ内の「時刻」テキストを持つ要素
SELECTOR_SLOT_TIME=.slot-time,.time,[class*="slot-time"],[class*="slotTime"]

# 満席・予約不可を示す要素（このセレクタにマッチした枠は除外）
SELECTOR_SLOT_FULL=.full,.soldout,.closed,[data-status="full"],[data-status="closed"]

# 残席数テキストを持つ要素（オプション、なければ null を使用）
SELECTOR_SLOT_REMAINING=.remaining,.count,[class*="remain"],[class*="zanseki"]
```

- [ ] **Step 4: TypeScript チェックを走らせる**

```bash
npm run typecheck
```

Expected: エラーなし。

- [ ] **Step 5: コミット**

```bash
git add src/types.ts src/config.ts .env.example
git commit -m "feat: add types and config loader"
```

---

## Task 3: 状態管理（storage.ts）— TDD

**Files:**
- Create: `src/storage.ts`
- Create: `tests/storage.test.ts`

- [ ] **Step 1: 失敗するテストを書く（tests/storage.test.ts）**

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  readState,
  writeState,
  getNewSlots,
  buildNextState,
} from '../src/storage';
import { AvailableSlot, NotifiedState } from '../src/types';

describe('readState', () => {
  it('ファイルが存在しないときデフォルト状態を返す', () => {
    const result = readState('/nonexistent/path.json');
    expect(result.notifiedIds).toEqual([]);
    expect(result.lastChecked).toBeDefined();
  });

  it('正常なJSONファイルから状態を読み込む', () => {
    const tmpFile = path.join(os.tmpdir(), 'test-state.json');
    const state: NotifiedState = {
      notifiedIds: ['2026-06-26T10:00'],
      lastChecked: '2026-06-01T00:00:00Z',
    };
    fs.writeFileSync(tmpFile, JSON.stringify(state));
    const result = readState(tmpFile);
    expect(result.notifiedIds).toEqual(['2026-06-26T10:00']);
    fs.unlinkSync(tmpFile);
  });
});

describe('writeState', () => {
  it('状態をJSONファイルに書き込む', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoichi-'));
    const filePath = path.join(tmpDir, 'state.json');
    const state: NotifiedState = {
      notifiedIds: ['2026-06-26T09:00'],
      lastChecked: '2026-06-11T00:00:00Z',
    };
    writeState(filePath, state);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(raw.notifiedIds).toEqual(['2026-06-26T09:00']);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('ディレクトリが存在しない場合も書き込める', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoichi-'));
    const filePath = path.join(tmpDir, 'nested', 'state.json');
    writeState(filePath, { notifiedIds: [], lastChecked: '' });
    expect(fs.existsSync(filePath)).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('getNewSlots', () => {
  const slots: AvailableSlot[] = [
    { date: '2026-06-26', time: '09:00', remaining: 5, slotId: '2026-06-26T09:00' },
    { date: '2026-06-26', time: '10:00', remaining: 2, slotId: '2026-06-26T10:00' },
    { date: '2026-06-26', time: '11:00', remaining: 8, slotId: '2026-06-26T11:00' },
  ];

  it('すべて新規のとき全スロットを返す', () => {
    const state: NotifiedState = { notifiedIds: [], lastChecked: '' };
    expect(getNewSlots(slots, state)).toHaveLength(3);
  });

  it('既通知済みのスロットを除外する', () => {
    const state: NotifiedState = {
      notifiedIds: ['2026-06-26T09:00', '2026-06-26T11:00'],
      lastChecked: '',
    };
    const result = getNewSlots(slots, state);
    expect(result).toHaveLength(1);
    expect(result[0].slotId).toBe('2026-06-26T10:00');
  });

  it('すべて通知済みのとき空配列を返す', () => {
    const state: NotifiedState = {
      notifiedIds: ['2026-06-26T09:00', '2026-06-26T10:00', '2026-06-26T11:00'],
      lastChecked: '',
    };
    expect(getNewSlots(slots, state)).toHaveLength(0);
  });
});

describe('buildNextState', () => {
  it('新規スロットの ID を既存の通知済みリストにマージする', () => {
    const prev: NotifiedState = {
      notifiedIds: ['2026-06-26T09:00'],
      lastChecked: '',
    };
    const newSlots: AvailableSlot[] = [
      { date: '2026-06-26', time: '10:00', remaining: 2, slotId: '2026-06-26T10:00' },
    ];
    const next = buildNextState(prev, newSlots);
    expect(next.notifiedIds).toContain('2026-06-26T09:00');
    expect(next.notifiedIds).toContain('2026-06-26T10:00');
    expect(next.notifiedIds).toHaveLength(2);
  });

  it('重複した ID を持ち込まない', () => {
    const prev: NotifiedState = {
      notifiedIds: ['2026-06-26T09:00'],
      lastChecked: '',
    };
    const newSlots: AvailableSlot[] = [
      { date: '2026-06-26', time: '09:00', remaining: null, slotId: '2026-06-26T09:00' },
    ];
    const next = buildNextState(prev, newSlots);
    expect(next.notifiedIds).toHaveLength(1);
  });

  it('lastChecked を更新する', () => {
    const before = new Date();
    const next = buildNextState({ notifiedIds: [], lastChecked: '' }, []);
    const after = new Date();
    const ts = new Date(next.lastChecked);
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npm test -- --testPathPattern=storage
```

Expected: `Cannot find module '../src/storage'` のエラー。

- [ ] **Step 3: src/storage.ts を実装する**

```typescript
import fs from 'fs';
import path from 'path';
import { AvailableSlot, NotifiedState } from './types';

const DEFAULT_STATE: NotifiedState = {
  notifiedIds: [],
  lastChecked: new Date(0).toISOString(),
};

export function readState(filePath: string): NotifiedState {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as NotifiedState;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function writeState(filePath: string, state: NotifiedState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

export function getNewSlots(
  current: AvailableSlot[],
  state: NotifiedState
): AvailableSlot[] {
  const notifiedSet = new Set(state.notifiedIds);
  return current.filter(slot => !notifiedSet.has(slot.slotId));
}

export function buildNextState(
  prev: NotifiedState,
  newSlots: AvailableSlot[]
): NotifiedState {
  const merged = new Set([
    ...prev.notifiedIds,
    ...newSlots.map(s => s.slotId),
  ]);
  return {
    notifiedIds: [...merged],
    lastChecked: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: テストがパスすることを確認する**

```bash
npm test -- --testPathPattern=storage
```

Expected: `Tests: 8 passed`

- [ ] **Step 5: コミット**

```bash
git add src/storage.ts tests/storage.test.ts
git commit -m "feat: add storage module with state diffing (TDD)"
```

---

## Task 4: Discord 通知（notifier.ts）— TDD

**Files:**
- Create: `src/notifier.ts`
- Create: `tests/notifier.test.ts`

- [ ] **Step 1: 失敗するテストを書く（tests/notifier.test.ts）**

```typescript
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

  it('footer に予約ページ URL を含む', () => {
    const embed = buildEmbed(testSlots, testConfig);
    expect(embed.footer.text).toContain('distillery.nikka.com');
  });

  it('color が数値である', () => {
    const embed = buildEmbed(testSlots, testConfig);
    expect(typeof embed.color).toBe('number');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npm test -- --testPathPattern=notifier
```

Expected: `Cannot find module '../src/notifier'` のエラー。

- [ ] **Step 3: src/notifier.ts を実装する**

```typescript
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
```

- [ ] **Step 4: テストがパスすることを確認する**

```bash
npm test -- --testPathPattern=notifier
```

Expected: `Tests: 8 passed`

- [ ] **Step 5: 全テストが通ることを確認する**

```bash
npm test
```

Expected: `Test Suites: 2 passed`

- [ ] **Step 6: コミット**

```bash
git add src/notifier.ts tests/notifier.test.ts
git commit -m "feat: add Discord notifier with embed formatting (TDD)"
```

---

## Task 5: ページ構造の調査スクリプト（scripts/inspect.ts）

予約ページの実際の HTML 構造を確認するためのデバッグスクリプト。
`src/checker.ts` を書く前にこのスクリプトを実行してセレクタを特定する。

**Files:**
- Create: `scripts/inspect.ts`

- [ ] **Step 1: scripts/inspect.ts を作成する**

```typescript
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
```

- [ ] **Step 2: inspect スクリプトを実行してページ構造を確認する**

```bash
npm run inspect
```

Expected:
- ブラウザが開き、予約ページが表示される
- `screenshots/inspect-01-initial.png` にスクリーンショットが保存される
- コンソールにページ内の要素一覧が出力される

- [ ] **Step 3: 出力を元にセレクタをメモし、必要なら .env に追記する**

確認すべき要素（コンソール出力から探す）:

| 目的 | 確認したいもの |
|------|--------------|
| 空きあり日付セル | `TD` タグのクラス名（例: `available`, `open`, `○`）|
| 前月・次月ボタン | `BUTTON` or `A` のテキスト（`次へ`, `>`, `▶` 等）|
| 時間枠の要素 | 日付クリック後に現れる要素のクラス名 |
| 満席の要素 | `×`, `満席`, `closed` 等のテキストを持つ要素 |
| 残枠数のテキスト | `残り`, `○` 等のテキストパターン |

デフォルトと違う場合は `.env` に `SELECTOR_*` を追記する（Task 2 の `.env.example` 参照）。

- [ ] **Step 4: コミット**

```bash
git add scripts/inspect.ts
git commit -m "feat: add page inspection debug script"
```

---

## Task 6: 予約ページスクレイパー（checker.ts）

**⚠️ このタスクを始める前に Task 5 の inspect スクリプトを実行し、実際のページ構造を確認してください。**

**Files:**
- Create: `src/checker.ts`

- [ ] **Step 1: src/checker.ts を作成する**

```typescript
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
```

- [ ] **Step 2: TypeScript チェックを走らせる**

```bash
npm run typecheck
```

Expected: エラーなし。

- [ ] **Step 3: ローカルで動作確認**

```bash
# .env を作成（DISCORD_WEBHOOK_URL はダミーでよい）
cp .env.example .env
# .env を開き DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/dummy/dummy に書き換え

HEADLESS=false npx ts-node -e "
const { checkAvailableSlots } = require('./src/checker');
const { config } = require('./src/config');
checkAvailableSlots(config).then(s => console.log(JSON.stringify(s, null, 2)));
"
```

Expected: ブラウザが開き、予約ページが表示される。スロット配列がコンソールに出力される（空でも可）。

スロットが取得できない場合は Task 5 の inspect 出力を参照してセレクタを `.env` で上書きする。

- [ ] **Step 4: コミット**

```bash
git add src/checker.ts
git commit -m "feat: add Playwright reservation page checker"
```

---

## Task 7: メイン処理（main.ts）

**Files:**
- Create: `src/main.ts`

- [ ] **Step 1: src/main.ts を作成する**

```typescript
import { config } from './config';
import { checkAvailableSlots } from './checker';
import { readState, writeState, getNewSlots, buildNextState } from './storage';
import { sendDiscordNotification } from './notifier';

async function main(): Promise<void> {
  console.log(`=== 余市蒸溜所 空き枠チェック開始 [${new Date().toISOString()}] ===`);
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
```

- [ ] **Step 2: エンドツーエンド動作確認**

```bash
npm run check
```

Expected:
- コンソールにチェック開始・完了のログが表示される
- `data/notified-slots.json` が作成される

- [ ] **Step 3: TypeScript チェック**

```bash
npm run typecheck
```

Expected: エラーなし。

- [ ] **Step 4: コミット**

```bash
git add src/main.ts
git commit -m "feat: add main orchestrator"
```

---

## Task 8: GitHub Actions ワークフロー

**Files:**
- Create: `.github/workflows/monitor.yml`

- [ ] **Step 1: .github/workflows/monitor.yml を作成する**

```yaml
name: 余市蒸溜所 空き枠監視

on:
  schedule:
    # 毎時 0, 15, 30, 45 分に実行（UTC）。日本時間は +9h。
    - cron: '0,15,30,45 * * * *'
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright Chromium
        run: npx playwright install --with-deps chromium

      - name: Run availability check
        env:
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
          RESERVATION_URL: ${{ vars.RESERVATION_URL || 'https://distillery.nikka.com/yoichi/reservation' }}
          TARGET_DATE: ${{ vars.TARGET_DATE || '2026-06-26' }}
          PARTY_SIZE: ${{ vars.PARTY_SIZE || '2' }}
          STATE_FILE_PATH: data/notified-slots.json
          HEADLESS: 'true'
          SELECTOR_AVAILABLE_DATE: ${{ vars.SELECTOR_AVAILABLE_DATE || '' }}
          SELECTOR_NEXT_MONTH: ${{ vars.SELECTOR_NEXT_MONTH || '' }}
          SELECTOR_TIME_SLOT: ${{ vars.SELECTOR_TIME_SLOT || '' }}
          SELECTOR_SLOT_TIME: ${{ vars.SELECTOR_SLOT_TIME || '' }}
          SELECTOR_SLOT_FULL: ${{ vars.SELECTOR_SLOT_FULL || '' }}
          SELECTOR_SLOT_REMAINING: ${{ vars.SELECTOR_SLOT_REMAINING || '' }}
        run: npm run check

      - name: Commit state if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/notified-slots.json
          if git diff --staged --quiet; then
            echo "状態に変化なし。コミットをスキップします。"
          else
            git commit -m "chore: update notified slots state [skip ci]"
            git push
          fi
```

- [ ] **Step 2: GitHub リポジトリを作成してプッシュする**

GitHub CLI がある場合:
```bash
gh repo create yoichi-monitor --private --source=. --remote=origin --push
```

GitHub CLI がない場合は GitHub.com でリポジトリを作成してから:
```bash
git remote add origin https://github.com/YOUR_USERNAME/yoichi-monitor.git
git push -u origin main
```

- [ ] **Step 3: GitHub Secrets に DISCORD_WEBHOOK_URL を登録する**

```bash
gh secret set DISCORD_WEBHOOK_URL
# プロンプトに Webhook URL を貼り付ける
```

または GitHub.com → リポジトリ → Settings → Secrets and variables → Actions → New repository secret

- [ ] **Step 4: 手動でワークフローをトリガーして動作確認する**

```bash
gh workflow run monitor.yml
gh run watch  # リアルタイムでログを確認
```

Expected: ワークフローが緑になり、ログに `=== チェック完了 ===` が表示される。

- [ ] **Step 5: コミット**

```bash
git add .github/workflows/monitor.yml
git commit -m "feat: add GitHub Actions monitor workflow"
git push
```

---

## Task 9: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: README.md を作成する**

```markdown
# 余市蒸溜所 空き枠監視ツール

ニッカウヰスキー余市蒸溜所の見学予約ページを定期監視し、希望条件に合う空き枠が出た際に Discord へ通知します。

## 機能

- Playwright によるブラウザ自動化でページを取得
- 希望日・人数の条件に合う空き枠を抽出
- 前回通知済みの枠は再通知しない（`data/notified-slots.json` で管理）
- Discord Webhook へ通知
- GitHub Actions で 15 分間隔の自動実行

## 注意事項

- 空き枠の **検知と通知のみ** を行います
- 自動予約・フォーム送信・ログイン突破・CAPTCHA 突破は行いません
- 公式サイトへの負荷を避けるため、実行間隔は 15 分以上を推奨します

## セットアップ

### 前提条件

- Node.js 20 以上
- npm
- Discord サーバーの管理権限（Webhook 作成用）

### 1. リポジトリをクローン

```bash
git clone https://github.com/YOUR_USERNAME/yoichi-monitor.git
cd yoichi-monitor
```

### 2. 依存パッケージをインストール

```bash
npm install
npx playwright install chromium
```

### 3. .env を設定

```bash
cp .env.example .env
```

`.env` を開き、必須項目を入力します。

| 変数 | 必須 | 説明 |
|------|------|------|
| `DISCORD_WEBHOOK_URL` | ✅ | Discord の Webhook URL |
| `TARGET_DATE` | | 希望日（デフォルト: `2026-06-26`） |
| `PARTY_SIZE` | | 希望人数（デフォルト: `2`） |
| `HEADLESS` | | `false` でブラウザを表示（デフォルト: `true`） |

Discord Webhook の取得方法:
1. Discord サーバーのテキストチャンネルを右クリック → 「チャンネルの編集」
2. 「インテグレーション」→「ウェブフック」→「新しいウェブフック」
3. 「ウェブフックのURLをコピー」

### 4. ページ構造の確認（初回のみ）

```bash
npm run inspect
```

ブラウザが開き、予約ページが表示されます。コンソール出力と `screenshots/inspect-01-initial.png` を参照して、`.env` のセレクタ設定を実際のページに合わせて更新してください（デフォルトで動作する場合は不要）。

### 5. ローカルで動作確認

```bash
npm run check
```

### 6. GitHub Actions の設定

1. GitHub にリポジトリをプッシュ
2. **Secrets** に `DISCORD_WEBHOOK_URL` を追加（Settings → Secrets and variables → Actions）
3. 必要に応じて **Variables** に `TARGET_DATE`、`PARTY_SIZE`、`SELECTOR_*` を追加
4. Actions → 「余市蒸溜所 空き枠監視」→「Run workflow」で手動実行して動作確認

## セレクタのカスタマイズ

ページ構造が変わったり、デフォルトセレクタが合わない場合は `.env`（ローカル）または GitHub Variables（GitHub Actions）で上書きします。

```bash
# .env の例
SELECTOR_AVAILABLE_DATE=td.available a
SELECTOR_NEXT_MONTH=button[aria-label="翌月"]
SELECTOR_TIME_SLOT=.reservation-slot
```

## ファイル構成

| ファイル | 役割 |
|---------|------|
| `src/types.ts` | 型定義 |
| `src/config.ts` | 設定読み込み |
| `src/storage.ts` | 通知済み状態の管理 |
| `src/checker.ts` | Playwright スクレイパー |
| `src/notifier.ts` | Discord 通知 |
| `src/main.ts` | メイン処理 |
| `data/notified-slots.json` | 通知済み枠の状態（自動生成） |
| `.github/workflows/monitor.yml` | 定期実行ワークフロー |

## ライセンス

MIT
```

- [ ] **Step 2: コミット**

```bash
git add README.md
git commit -m "docs: add README with setup instructions"
git push
```

---

## Self-Review チェック

### Spec カバレッジ確認

| 要件 | 対応タスク |
|------|-----------|
| Playwright で予約ページを開く | Task 6 (checker.ts) |
| 希望日 2026-06-26 | Task 2 (config.ts の TARGET_DATE デフォルト値) |
| 人数 2名 | Task 2 (config.ts の PARTY_SIZE デフォルト値) |
| 空きがある日時のみ抽出 | Task 6 (extractSlotsFromPage) |
| 前回通知済み枠は再通知しない | Task 3 (getNewSlots / buildNextState) |
| Discord Webhook に通知 | Task 4 (notifier.ts) |
| .env で設定管理 | Task 2 (.env.example / config.ts) |
| GitHub Actions で定期実行 | Task 8 (monitor.yml) |
| README にセットアップ手順 | Task 9 |

### 型整合性確認

- `AvailableSlot.slotId` → Task 3 の `getNewSlots`/`buildNextState` で使用 ✅
- `Config` → Task 6 の `checker.ts` と Task 4 の `notifier.ts` で `config: Config` として受け取り ✅
- `buildEmbed` の戻り値 `DiscordEmbed` → テストで `embed.fields.find(...)` 使用 ✅
- `sendDiscordNotification` → Task 7 の `main.ts` から呼び出し ✅
