#!/bin/zsh
set -e

echo "MLB番記者メール翻訳の初期設定"
echo "OpenAI APIキーを入力してください（画面には表示されません）。"
read -s API_KEY
echo

if [[ -z "$API_KEY" ]]; then
  echo "APIキーが空のため中止しました。"
  exit 1
fi

security add-generic-password -U -a "$USER" -s "mlb-mail-translator-openai" -w "$API_KEY"
unset API_KEY
echo "APIキーをMacのキーチェーンへ保存しました。"
echo "次に直近5件の翻訳テストを実行します。"
python3 "${0:A:h}/translate.py" --limit 5
echo
echo "完了しました。書類フォルダの『MLB番記者_日本語訳』を確認してください。"
