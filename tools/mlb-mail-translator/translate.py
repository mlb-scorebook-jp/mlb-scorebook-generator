#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP_DIR = Path.home() / "Library" / "Application Support" / "MLBMailTranslator"
STATE_FILE = APP_DIR / "state.json"
OUTPUT_DIR = Path.home() / "Documents" / "MLB番記者_日本語訳"
MODEL = os.environ.get("MLB_MAIL_TRANSLATOR_MODEL", "gpt-5-mini")
MAILBOX = os.environ.get("MLB_MAILBOX_NAME", "MLB番記者")


def run(args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout


def get_api_key():
    try:
        return run(["security", "find-generic-password", "-a", os.environ.get("USER", ""),
                    "-s", "mlb-mail-translator-openai", "-w"]).strip()
    except subprocess.CalledProcessError as exc:
        raise RuntimeError("OpenAI APIキーが未登録です。先に setup.command を実行してください。") from exc


def read_messages(limit):
    raw = run(["osascript", "-l", "JavaScript", str(ROOT / "read-mail.jxa"),
               MAILBOX, str(limit)])
    return json.loads(raw)


def load_state():
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {"translatedIds": []}


def clean_body(value):
    value = value.replace("\r", "")
    value = re.sub(r"\n{3,}", "\n\n", value)
    value = re.sub(r"[ \t]{2,}", " ", value)
    return value.strip()[:45000]


def response_text(data):
    if data.get("output_text"):
        return data["output_text"]
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                return content["text"]
    return ""


def translate_message(api_key, message):
    prompt = f"""以下はMLBの番記者ニュースレターです。日本の野球番組スタッフが使える自然な日本語にしてください。

必須形式:
# 日本語の件名
## 重要ポイント
- 3〜6項目
## 本文の日本語訳
原文の意味、固有名詞、数字、引用の話者を保って翻訳する。
## 放送・取材で使えそうな点
- 記録、移籍、故障、監督・選手コメントなど、使える情報があれば記載。なければ「特になし」。

送信者: {message['sender']}
件名: {message['subject']}
本文:
{clean_body(message['content'])}"""
    payload = json.dumps({"model": MODEL, "input": prompt}).encode("utf-8")
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses", data=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"翻訳APIエラー {exc.code}: {detail}") from exc
    text = response_text(data)
    if not text:
        raise RuntimeError("翻訳結果が空でした。")
    return text


def safe_name(value):
    value = re.sub(r'[\\/:*?"<>|]', "_", value)
    return re.sub(r"\s+", " ", value).strip()[:90]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--test", action="store_true")
    args = parser.parse_args()
    APP_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    messages = read_messages(args.limit)
    if args.test:
        print(f"「{MAILBOX}」から{len(messages)}件を取得できました。")
        for message in messages:
            print(f"- {message['subject']}")
        return

    api_key = get_api_key()
    state = load_state()
    completed = set(state.get("translatedIds", []))
    targets = [message for message in messages if message["id"] not in completed]
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime("%Y-%m-%d")
    day_dir = OUTPUT_DIR / today
    day_dir.mkdir(parents=True, exist_ok=True)
    summaries = []
    for message in reversed(targets):
        translated = translate_message(api_key, message)
        file_name = f"{safe_name(message['subject']) or message['id']}.md"
        header = (f"原文件名: {message['subject']}\n送信者: {message['sender']}\n"
                  f"受信日時: {message['receivedAt']}\nメールID: {message['id']}\n\n")
        (day_dir / file_name).write_text(header + translated + "\n", encoding="utf-8")
        summaries.append(f"## {message['subject']}\n\n{translated}\n")
        completed.add(message["id"])
        print(f"翻訳完了: {file_name}")
    if summaries:
        summary = f"# 本日の番記者情報 {today}\n\n" + "\n---\n\n".join(summaries)
        (day_dir / "本日の番記者情報.md").write_text(summary, encoding="utf-8")
    STATE_FILE.write_text(json.dumps({"translatedIds": sorted(completed)}, ensure_ascii=False, indent=2),
                          encoding="utf-8")
    print(f"保存先: {day_dir}" if targets else "未翻訳の新着メールはありません。")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
