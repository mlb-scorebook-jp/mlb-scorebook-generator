#!/usr/bin/env python3
"""Generate 2007-2024 award history from cached MLB Stats API responses."""

from collections import defaultdict
import glob
import json
import os
import re
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AWARDS_DIR = "/tmp/mlb-awards-history"
STATS_DIR = "/tmp/mlb-awards-stats"
STANDINGS_DIR = "/tmp/mlb-awards-standings"
PLAYER_AWARDS_DIR = "/tmp/mlb-player-awards"
OUTPUT = os.path.join(ROOT, "js", "awards-history-major-2007-2024.js")

TEAM_ABBR = {
    108: "LAA", 109: "AZ", 110: "BAL", 111: "BOS", 112: "CHC", 113: "CIN",
    114: "CLE", 115: "COL", 116: "DET", 117: "HOU", 118: "KC", 119: "LAD",
    120: "WSH", 121: "NYM", 133: "OAK", 134: "PIT", 135: "SD", 136: "SEA",
    137: "SF", 138: "STL", 139: "TB", 140: "TEX", 141: "TOR", 142: "MIN",
    143: "PHI", 144: "ATL", 145: "CWS", 146: "MIA", 147: "NYY", 158: "MIL",
}
PAIR_IDS = {
    "mvp": ("ALMVP", "NLMVP", "MOST VALUABLE PLAYER"),
    "cyYoung": ("ALCY", "NLCY", "CY YOUNG AWARD"),
    "rookie": ("ALROY", "NLROY", "ROOKIE OF THE YEAR"),
    "manager": ("ALMOY", "NLMOY", "MANAGER OF THE YEAR"),
    "platinumGlove": ("ALPG", "NLPG", "PLATINUM GLOVE"),
    "hankAaron": ("ALHAA", "NLHAA", "HANK AARON AWARD"),
    "reliever": ("ALREL", "NLREL", "RELIEVER OF THE YEAR"),
    "comeback": ("ALCPOY", "NLCPOY", "COMEBACK PLAYER OF THE YEAR"),
}
SINGLE_IDS = {
    "outstandingDh": ("DHOY", "OUTSTANDING DESIGNATED HITTER", "MAJOR LEAGUE BASEBALL"),
    "clemente": ("MLBRC", "ROBERTO CLEMENTE AWARD", "MAJOR LEAGUE BASEBALL"),
    "allStarMvp": ("ASMVP", "ALL-STAR GAME MVP", "ALL-STAR GAME"),
    "alcsMvp": ("ALCSMVP", "ALCS MVP", "AMERICAN LEAGUE"),
    "nlcsMvp": ("NLCSMVP", "NLCS MVP", "NATIONAL LEAGUE"),
    "worldSeriesMvp": ("WSMVP", "WORLD SERIES MVP", "WORLD SERIES"),
}
AWARD_FAMILIES = {
    "ALMVP": {"ALMVP", "NLMVP"}, "NLMVP": {"ALMVP", "NLMVP"},
    "ALCY": {"ALCY", "NLCY"}, "NLCY": {"ALCY", "NLCY"},
    "ALROY": {"ALROY", "NLROY"}, "NLROY": {"ALROY", "NLROY"},
    "ALMOY": {"ALMOY", "NLMOY"}, "NLMOY": {"ALMOY", "NLMOY"},
    "ALPG": {"ALPG", "NLPG"}, "NLPG": {"ALPG", "NLPG"},
    "ALHAA": {"ALHAA", "NLHAA"}, "NLHAA": {"ALHAA", "NLHAA"},
    "ALREL": {"ALREL", "NLREL"}, "NLREL": {"ALREL", "NLREL"},
    "ALCPOY": {"ALCPOY", "NLCPOY"}, "NLCPOY": {"ALCPOY", "NLCPOY"},
    "ALSS": {"ALSS", "NLSS"}, "NLSS": {"ALSS", "NLSS"},
}
SOURCE_URLS = {
    "mvp": "https://www.mlb.com/awards/most-valuable-player",
    "cyYoung": "https://www.mlb.com/awards/cy-young",
    "rookie": "https://www.mlb.com/awards/rookie-of-the-year",
    "manager": "https://www.mlb.com/awards/manager-of-the-year",
    "platinumGlove": "https://www.mlb.com/awards/platinum-glove",
    "hankAaron": "https://www.mlb.com/awards/hank-aaron",
    "outstandingDh": "https://www.mlb.com/awards/outstanding-dh",
    "reliever": "https://www.mlb.com/awards/reliever-of-the-year",
    "comeback": "https://www.mlb.com/awards/comeback-player",
    "clemente": "https://www.mlb.com/awards/roberto-clemente",
    "allStarMvp": "https://www.mlb.com/all-star/history",
    "alcsMvp": "https://www.mlb.com/awards/postseason",
    "nlcsMvp": "https://www.mlb.com/awards/postseason",
    "worldSeriesMvp": "https://www.mlb.com/awards/postseason",
    "silverSlugger": "https://www.mlb.com/awards/silver-slugger",
    "allMlb": "https://www.mlb.com/awards/all-mlb",
}


def load_json(path):
    try:
        with open(path) as handle:
            return json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def award_rows(year, award_id):
    return load_json(f"{AWARDS_DIR}/{year}-{award_id}.json").get("awards", [])


def normalize_name(value):
    value = unicodedata.normalize("NFKD", value)
    return "".join(character for character in value if character.isalnum()).lower()


def load_japanese_names():
    source = open(os.path.join(ROOT, "js", "players.js")).read()
    match = re.search(r"const NHK_PLAYER_NAMES = (\{.*?\});", source, re.S)
    return json.loads(match.group(1)) if match else {}


JP_NAMES = load_japanese_names()
JP_NAME_OVERRIDES = {
    "Adrián González": "A.ゴンザレス",
    "Davey Johnson": "D.ジョンソン",
    "Jeff Banister": "J.バニスター",
}


def japanese_name(full_name):
    if full_name in JP_NAME_OVERRIDES:
        return JP_NAME_OVERRIDES[full_name]
    mapped = JP_NAMES.get(normalize_name(full_name))
    if mapped and mapped != "表記待ち":
        return mapped
    parts = full_name.replace(" Jr.", " Jr.").split()
    return f"{parts[0][0]}.{parts[-1]}" if len(parts) > 1 else full_name


def stat_splits(year, player_id, group):
    return load_json(f"{STATS_DIR}/{year}-{player_id}-{group}.json").get("stats", [{}])[0].get("splits", [])


def select_stat(year, player_id, group, team_id):
    splits = stat_splits(year, player_id, group)
    matching = [row for row in splits if row.get("team", {}).get("id") == team_id]
    rows = matching or splits
    if not rows:
        return {}
    if group == "fielding":
        stats = [row.get("stat", {}) for row in rows if row.get("stat", {}).get("position", {}).get("code") != "10"]
        chances = sum(int(row.get("chances", 0)) for row in stats)
        errors = sum(int(row.get("errors", 0)) for row in stats)
        return {
            "gamesPlayed": sum(int(row.get("gamesPlayed", 0)) for row in stats),
            "chances": chances,
            "errors": errors,
            "fielding": f"{(chances - errors) / chances:.3f}".lstrip("0") if chances else "—",
        }
    return rows[0].get("stat", {})


def position_of(row):
    return row.get("player", {}).get("primaryPosition", {}).get("abbreviation", "—")


def is_pitcher(row):
    return row.get("player", {}).get("primaryPosition", {}).get("type") == "Pitcher"


def format_ip(value):
    return str(value or "—")


def performance_stats(year, row, category):
    player = row.get("player", {})
    player_id = player.get("id")
    team_id = row.get("team", {}).get("id")
    if category == "manager":
        standings = load_json(f"{STANDINGS_DIR}/{year}.json")
        for record in standings.get("records", []):
            for team in record.get("teamRecords", []):
                if team.get("team", {}).get("id") == team_id:
                    return {
                        "勝敗": f"{team.get('wins', 0)}-{team.get('losses', 0)}",
                        "勝率": team.get("winningPercentage", "—"),
                        "地区順位": f"{team.get('divisionRank', '—')}位",
                    }
        return {"受賞年": year, "所属": TEAM_ABBR.get(team_id, "—")}
    if category in {"clemente", "allStarMvp", "alcsMvp", "nlcsMvp", "worldSeriesMvp"}:
        return {"受賞年": year, "所属": TEAM_ABBR.get(team_id, "—"), "守備位置": position_of(row)}
    if category == "platinumGlove":
        stat = select_stat(year, player_id, "fielding", team_id)
        return {
            "守備機会": stat.get("chances", "—"),
            "失策": stat.get("errors", "—"),
            "守備率": stat.get("fielding", "—"),
        }
    if is_pitcher(row):
        stat = select_stat(year, player_id, "pitching", team_id)
        result = {
            "登板": stat.get("gamesPlayed", "—"),
            "勝敗": f"{stat.get('wins', 0)}-{stat.get('losses', 0)}",
            "防御率": stat.get("era", "—"),
            "投球回": format_ip(stat.get("inningsPitched")),
            "奪三振": stat.get("strikeOuts", "—"),
            "WHIP": stat.get("whip", "—"),
        }
        if category == "reliever":
            result["セーブ"] = stat.get("saves", "—")
        return result
    stat = select_stat(year, player_id, "hitting", team_id)
    return {
        "試合": stat.get("gamesPlayed", "—"),
        "打率": stat.get("avg", "—"),
        "本塁打": stat.get("homeRuns", "—"),
        "打点": stat.get("rbi", "—"),
        "得点": stat.get("runs", "—"),
        "OPS": stat.get("ops", "—"),
    }


def count_and_streak(year, award_id, player_id):
    award_family = AWARD_FAMILIES.get(award_id, {award_id})
    rows = load_json(f"{PLAYER_AWARDS_DIR}/{player_id}.json").get("awards", [])
    seasons = sorted({
        int(row.get("season", 0))
        for row in rows
        if row.get("id") in award_family and int(row.get("season", 0)) <= year
    })
    count = len(seasons)
    streak = 1
    while year - streak in seasons:
        streak += 1
    return count, streak


def winner(year, award_id, row, category, league):
    player = row.get("player", {})
    player_id = player.get("id")
    team_id = row.get("team", {}).get("id")
    count, streak = count_and_streak(year, award_id, player_id)
    data = {
        "league": league,
        "player": player.get("nameFirstLast", ""),
        "playerJa": japanese_name(player.get("nameFirstLast", "")),
        "playerId": player_id,
        "team": TEAM_ABBR.get(team_id, str(team_id or "—")),
        "teamId": team_id,
        "position": "監督" if category == "manager" else position_of(row),
        "count": count or 1,
        "stats": performance_stats(year, row, category),
    }
    if streak > 1:
        data["streak"] = streak
    return data


def one(year, award_id):
    rows = award_rows(year, award_id)
    return rows[0] if rows else None


def slugger_rows(year, award_id):
    order = {"C": 0, "1B": 1, "2B": 2, "3B": 3, "SS": 4, "OF": 5, "DH": 6, "UT": 7}
    values = []
    for row in award_rows(year, award_id):
        player = row["player"]
        team_id = row.get("team", {}).get("id")
        stat = select_stat(year, player["id"], "hitting", team_id)
        count, _ = count_and_streak(year, award_id, player["id"])
        position = position_of(row)
        values.append([
            position,
            japanese_name(player.get("nameFirstLast", "")),
            player["id"],
            TEAM_ABBR.get(team_id, str(team_id)),
            team_id,
            count or 1,
            stat.get("avg", "—"),
            stat.get("homeRuns", "—"),
            stat.get("rbi", "—"),
        ])
    return sorted(values, key=lambda row: (order.get(row[0], 8), row[1]))


def all_mlb_rows(year, award_id):
    result = []
    for row in award_rows(year, award_id):
        player = row["player"]
        team_id = row.get("team", {}).get("id")
        result.append([
            position_of(row),
            japanese_name(player.get("nameFirstLast", "")),
            TEAM_ABBR.get(team_id, str(team_id)),
            team_id,
        ])
    return result


def build_year(year):
    data = {}
    for category, (al_id, nl_id, title) in PAIR_IDS.items():
        al_row, nl_row = one(year, al_id), one(year, nl_id)
        if not al_row or not nl_row:
            continue
        data[category] = {
            "title": title,
            "sourceUrl": SOURCE_URLS[category],
            "al": winner(year, al_id, al_row, category, "AMERICAN LEAGUE"),
            "nl": winner(year, nl_id, nl_row, category, "NATIONAL LEAGUE"),
        }
    for category, (award_id, title, league) in SINGLE_IDS.items():
        row = one(year, award_id)
        if not row:
            continue
        data[category] = {
            "title": title,
            "sourceUrl": SOURCE_URLS[category],
            "single": winner(year, award_id, row, category, league),
        }
    al_ss, nl_ss = slugger_rows(year, "ALSS"), slugger_rows(year, "NLSS")
    if al_ss and nl_ss:
        data["silverSlugger"] = {
            "title": "SILVER SLUGGER",
            "sourceUrl": SOURCE_URLS["silverSlugger"],
            "al": al_ss,
            "nl": nl_ss,
        }
    first, second = all_mlb_rows(year, "MLBAFIRST"), all_mlb_rows(year, "MLBSECOND")
    if first and second:
        data["allMlb"] = {
            "sourceUrl": SOURCE_URLS["allMlb"],
            "first": first,
            "second": second,
        }
    return data


history = {str(year): build_year(year) for year in range(2007, 2025)}
payload = json.dumps(history, ensure_ascii=False, separators=(",", ":"))
with open(OUTPUT, "w") as handle:
    handle.write("window.MLB_AWARDS_MAJOR_HISTORY = Object.assign(window.MLB_AWARDS_MAJOR_HISTORY || {}, ")
    handle.write(payload)
    handle.write(");\n")
print(f"Wrote {OUTPUT}")
