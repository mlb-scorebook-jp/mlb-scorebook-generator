#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
cd "$PROJECT_DIR"

NODE_BIN=$(command -v node || true)
if [ -z "$NODE_BIN" ]; then
    CODEX_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
    if [ -x "$CODEX_NODE" ]; then
        NODE_BIN="$CODEX_NODE"
    else
        echo "Node.js 18以上をインストールしてください。"
        exit 1
    fi
fi
if [ ! -d node_modules/playwright ]; then
    echo "先に pnpm install または npm install を実行してください。"
    exit 1
fi
"$NODE_BIN" node_modules/playwright/cli.js install chromium
"$NODE_BIN" scripts/evidence-server.mjs
