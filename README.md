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
