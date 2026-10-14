#!/bin/zsh

set -u

PBP_SCRIPT_DIR="${0:A:h}"
PBP_PROJECT_DIR="${PBP_SCRIPT_DIR:h}"
PBP_SERVER="${PBP_SCRIPT_DIR}/pbp-capture-server.mjs"
PBP_RUNTIME_DIR="${PBP_SCRIPT_DIR}/pbp-runtime"
PBP_BUNDLED_ROOT="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies"
PBP_BUNDLED_NODE="${PBP_BUNDLED_ROOT}/node/bin/node"
PBP_BUNDLED_MODULES="${PBP_BUNDLED_ROOT}/node/node_modules"
PBP_PLIST_DIR="${HOME}/Library/LaunchAgents"
PBP_PLIST="${PBP_PLIST_DIR}/com.mlb-scorebook.pbp-capture.plist"
PBP_LABEL="com.mlb-scorebook.pbp-capture"
PBP_DOMAIN="gui/$(id -u)"

if [[ -x "${PBP_BUNDLED_NODE}" ]]; then
    PBP_NODE="${PBP_BUNDLED_NODE}"
else
    PBP_NODE="$(command -v node 2>/dev/null || true)"
fi

if [[ -z "${PBP_NODE}" ]]; then
    echo "Node.jsが見つかりません。CodexアプリまたはNode.jsをインストールしてください。"
    read "?Enterキーで閉じます。"
    exit 1
fi

if [[ -d "${PBP_BUNDLED_MODULES}/playwright" && -d "${PBP_BUNDLED_MODULES}/pdf-lib" ]]; then
    PBP_NODE_MODULES="${PBP_BUNDLED_MODULES}"
else
    PBP_NODE_MODULES="${PBP_RUNTIME_DIR}/node_modules"
    if [[ ! -d "${PBP_NODE_MODULES}/playwright" || ! -d "${PBP_NODE_MODULES}/pdf-lib" ]]; then
        PBP_NPM="$(command -v npm 2>/dev/null || true)"
        if [[ -z "${PBP_NPM}" ]]; then
            echo "必要な実行ファイルを準備できません。Node.js LTSをインストールしてください。"
            read "?Enterキーで閉じます。"
            exit 1
        fi
        echo "PBP撮影機能を準備しています。初回だけ数分かかる場合があります。"
        "${PBP_NPM}" install --prefix "${PBP_RUNTIME_DIR}" --omit=dev || {
            echo "必要なファイルを取得できませんでした。ネットワーク接続を確認してください。"
            read "?Enterキーで閉じます。"
            exit 1
        }
    fi
fi

PBP_SYSTEM_BROWSER=""
for PBP_BROWSER in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "${HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "${HOME}/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "${HOME}/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    if [[ -x "${PBP_BROWSER}" ]]; then
        PBP_SYSTEM_BROWSER="${PBP_BROWSER}"
        break
    fi
done

if [[ -z "${PBP_SYSTEM_BROWSER}" ]]; then
    PBP_PLAYWRIGHT_CLI="${PBP_NODE_MODULES}/playwright/cli.js"
    if [[ ! -f "${PBP_PLAYWRIGHT_CLI}" ]]; then
        echo "撮影用ブラウザの準備ファイルが見つかりません。"
        read "?Enterキーで閉じます。"
        exit 1
    fi
    echo "撮影用ブラウザを準備しています。初回だけ数分かかる場合があります。"
    "${PBP_NODE}" "${PBP_PLAYWRIGHT_CLI}" install chromium || {
        echo "撮影用ブラウザを準備できませんでした。ネットワーク接続を確認してください。"
        read "?Enterキーで閉じます。"
        exit 1
    }
fi

mkdir -p "${PBP_PLIST_DIR}"
/bin/cat > "${PBP_PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PBP_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${PBP_NODE}</string>
        <string>${PBP_SERVER}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_PATH</key>
        <string>${PBP_NODE_MODULES}</string>
        <key>PBP_APP_ROOT</key>
        <string>${PBP_PROJECT_DIR}</string>
    </dict>
    <key>WorkingDirectory</key>
    <string>${PBP_PROJECT_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>/tmp/mlb-scorebook-pbp-capture.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/mlb-scorebook-pbp-capture-error.log</string>
</dict>
</plist>
EOF

/bin/launchctl bootout "${PBP_DOMAIN}/${PBP_LABEL}" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "${PBP_DOMAIN}" "${PBP_PLIST}" || {
    echo "自動起動の登録に失敗しました。"
    read "?Enterキーで閉じます。"
    exit 1
}
/bin/launchctl kickstart -k "${PBP_DOMAIN}/${PBP_LABEL}"

PBP_READY=0
for PBP_ATTEMPT in {1..15}; do
    if /usr/bin/curl -fsS --max-time 2 "http://127.0.0.1:8765/health" 2>/dev/null | /usr/bin/grep -q '"ok":true'; then
        PBP_READY=1
        break
    fi
    sleep 1
done
if [[ "${PBP_READY}" -eq 1 ]]; then
    echo "設定完了。今後はMacへログインすると自動で利用できます。"
else
    echo "設定は保存しましたが、起動確認に失敗しました。"
    echo "エラー記録: /tmp/mlb-scorebook-pbp-capture-error.log"
fi

read "?Enterキーで閉じます。"
