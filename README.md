# Proactive Resource Monitor（プロアクティブ・リソースモニター）

Clawdbot を動かしているホストの **リソース状況** と **Cron（Gateway Cron）状態** を、
ブラウザでさっと確認できる **軽量・静的な単一ページのダッシュボード** です。

## できること

- CPU 使用率 / メモリ使用率 / ディスク使用率（直近スナップショット）
- ホスト情報（OS/アーキテクチャ/ホスト名/稼働時間/LoadAvg/温度など）
- Raspberry Pi のスロットリング状態（`vcgencmd` がある場合）
- Clawdbot の Cron ジョブ一覧（最終実行/次回実行/所要時間/エラー）
- Cron の健康状態サマリ（OK / Error / Unknown）
- Cron 表のフィルタ（検索 / only errors / hide disabled）
- セキュリティ: Cron ジョブ名やエラー文字列は **HTMLエスケープ** して表示（XSS対策）

## 仕組み

- `update_cron_data.py` が `clawdbot cron list --all --json` を叩いて `cron_status.json` を生成します。
- `index.html`（静的ページ）が `cron_status.json` を fetch して表示します。

> 注意: リアルタイム監視ではなく「定期生成された JSON を表示」する構成です。

## セットアップ

1. このリポジトリを配置
2. JSON を生成（`index.html` と同じ階層に `cron_status.json` が出ます）

```bash
python3 update_cron_data.py
```

3. ブラウザで `index.html` を開く（または軽量サーバで配信）

## おすすめ運用

- systemd timer / cron で 30 秒〜数分おきに `update_cron_data.py` を回す
- ダッシュボード側は 30 秒おきに JSON を読み直します（静的ホスティングでもOK）

---
Created by Pi

## 追加: リソース推移（Trends）

`update_cron_data.py` は、`cron_status.json` に加えて **`resource_history.json`** を更新します。
これにより、ダッシュボードに **過去24時間の CPU / メモリ / 温度の推移** が表示されます。

- 保持: 24時間（最大 2000 点）
- 生成間隔は運用側（cron / timer）に依存します

