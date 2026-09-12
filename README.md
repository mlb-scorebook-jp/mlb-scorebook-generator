# mlb-scorebook-generator
MLB Gameday to Waseda-style scorebook generator

## 資料作成モード（Phase 1）

初回のみ `npm install` と `npx playwright install chromium` を実行し、スコアブックを開く前に次を起動します。

```sh
./scripts/start-evidence-server.sh
```

スコアブックで試合を読み込み、左サイドバーの「資料作成モード」から打席を選択すると、MLB公式Gamedayの画面を証拠画像として `output/pdf/` にPDFを作成します。失敗した打席は画面上に「手動確認必要」として表示されます。
