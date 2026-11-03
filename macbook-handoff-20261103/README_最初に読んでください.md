# MLBスコアブック MacBook用 Codex引継ぎ

作成日：2026年11月3日  
対象リポジトリ：`mlb-scorebook-jp/mlb-scorebook-generator`  
基準コミット：`21f0d3b`

## このファイルの目的

Mac miniで行っていたCodexとの作業内容を、MacBookの新しいチャットへ安全に引き継ぐための資料です。

Codexのチャット内部データや認証情報は含めていません。ソースコードはGitHubから取得し、このフォルダ内の引継ぎ資料をMacBook側のCodexへ添付してください。

## MacBookでの再開手順

1. GitHub Desktopで `mlb-scorebook-generator` の `main` を開く。
2. `Fetch origin` を押し、必要なら `Pull origin` を押す。
3. Historyの先頭が `21f0d3b オプトアウト残額を注記表示にする` 以降であることを確認する。
4. 古い `127.0.0.1` のプレビューは閉じる。
5. GitHub Desktopの「Repository」→「Show in Finder」で最新フォルダを開く。
6. MacBookのCodexでこのリポジトリをプロジェクトとして開く。
7. `Codexへの最初の依頼.txt` の内容を新しいチャットへ貼り付ける。
8. このREADMEと `作業仕様と経緯.md` をCodexへ添付する。
9. 表示確認は最新フォルダの `index.html` を開いて行う。

## 必要なソフト

- Codexデスクトップアプリ
- GitHub Desktop
- Webブラウザ
- GitHubアカウントへのログイン

追加のパスワード、アクセストークン、CookieはこのZIPに含まれていません。GitHub、MLB PressboxなどはMacBook側で改めてログインしてください。

## 重要

- Mac mini側の元ファイルは削除しない。
- `main` ブランチを使用する。
- 修正後は必ずコミットする。
- 作業完了時は、ユーザーに貼り付けられる短いコミットサマリーを必ず出す。
- サイトの公開やGitHub Pages設定変更は、明示的に依頼された場合だけ行う。

