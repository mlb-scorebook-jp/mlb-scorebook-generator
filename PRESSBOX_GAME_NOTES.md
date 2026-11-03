# Pressboxゲームノート自動取得

## 使い方

1. `scripts/Pressboxゲームノートを更新.command` をダブルクリックします。
2. 取得したい日を `YYYY-MM-DD` 形式で入力します。
3. 初回だけ専用のGoogle Chromeが開くので、MLB Pressboxへログインします。
4. 取得完了後、MLB Scorebook Generatorを再読み込みします。

指定日のMLB全カードを取得し、Pressboxの一覧から両チームのゲームノートを探します。取得結果は `data/pressbox/game-notes.js` に保存され、試合前情報と試合後レビューの両方で使用されます。

## 認証情報

ログイン状態は `.pressbox-profile/` に保存されます。このフォルダはGitの対象外です。パスワードやCookieは `data/pressbox/game-notes.js` には書き込まれません。

## 自動抽出する項目

PDF本文から、連続試合安打、連続出塁、連続打点、連続試合本塁打、連続無失点イニングを抽出します。該当項目が見つからない場合も、ゲームノート本文へのリンクは保存します。

Pressbox側でPDFが未掲載のチームは、そのチームだけ未取得になります。取得後にPressboxへ新しいPDFが追加された場合は、同じ日付でもう一度実行すると更新されます。
