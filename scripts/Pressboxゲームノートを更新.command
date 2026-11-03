#!/bin/zsh

SCRIPT_DIR="${0:A:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
NODE_BIN="/Users/hiramotoakihiro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
export NODE_PATH="/Users/hiramotoakihiro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"

read "TARGET_DATE?取得日を YYYY-MM-DD で入力してください（空欄は今日）: "
if [[ -z "${TARGET_DATE}" ]]; then
    TARGET_DATE="$(date +%Y-%m-%d)"
fi

cd "${PROJECT_DIR}" || exit 1
"${NODE_BIN}" "${SCRIPT_DIR}/update-pressbox-game-notes.mjs" "${TARGET_DATE}"
STATUS=$?
echo
if [[ ${STATUS} -eq 0 ]]; then
    echo "取得が完了しました。ページを再読み込みしてください。"
else
    echo "取得に失敗しました。上のメッセージを確認してください。"
fi
read "REPLY?Enterキーで閉じます。"
exit ${STATUS}
