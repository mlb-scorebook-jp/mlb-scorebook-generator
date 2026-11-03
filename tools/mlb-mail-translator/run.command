#!/bin/zsh
set -e
python3 "${0:A:h}/translate.py" --limit 50
