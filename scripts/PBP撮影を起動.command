#!/bin/zsh
export NODE_PATH="/Users/hiramotoakihiro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"
exec "/Users/hiramotoakihiro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" "${0:A:h}/pbp-capture-server.mjs"
