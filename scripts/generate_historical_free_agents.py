#!/usr/bin/env python3
"""Generate historical MLB free-agent data from Retrosheet and Chadwick data."""

from __future__ import annotations

import argparse
import csv
import io
import json
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path


TEAM_IDS = {
    "ANA": 108, "CAL": 108, "LAA": 108, "ARI": 109, "BAL": 110,
    "BOS": 111, "CHN": 112, "CIN": 113, "CLE": 114, "COL": 115,
    "DET": 116, "HOU": 117, "KCA": 118, "LAN": 119, "MON": 120,
    "WSN": 120, "NYN": 121, "OAK": 133, "PIT": 134, "SDN": 135,
    "SEA": 136, "SFN": 137, "SLN": 138, "TBA": 139, "TBD": 139,
    "TEX": 140, "TOR": 141, "MIN": 142, "PHI": 143, "ATL": 144,
    "CHA": 145, "FLO": 146, "MIA": 146, "NYA": 147, "MIL": 158,
}

POSITION_COLUMNS = {
    "C": "G_c", "1B": "G_1b", "2B": "G_2b", "3B": "G_3b",
    "SS": "G_ss", "LF": "G_lf", "CF": "G_cf", "RF": "G_rf",
    "DH": "G_dh", "P": "G_p",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--transactions", required=True, type=Path)
    parser.add_argument("--register", required=True, type=Path)
    parser.add_argument("--people", required=True, type=Path)
    parser.add_argument("--appearances", required=True, type=Path)
    parser.add_argument("--pitching", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def read_register(path: Path) -> dict[str, dict[str, str]]:
    people: dict[str, dict[str, str]] = {}
    with zipfile.ZipFile(path) as archive:
        for filename in archive.namelist():
            if "/people-" not in filename or not filename.endswith(".csv"):
                continue
            with archive.open(filename) as raw:
                for row in csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8")):
                    if row["key_retro"]:
                        people[row["key_retro"]] = row
    return people


def read_people(path: Path) -> dict[str, dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return {row["retroID"]: row for row in csv.DictReader(handle) if row["retroID"]}


def read_positions(appearances_path: Path, pitching_path: Path) -> dict[tuple[str, int], tuple[str, str]]:
    appearances: dict[tuple[str, int], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    with appearances_path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            year = int(row["yearID"])
            if not 1995 <= year <= 2020:
                continue
            key = (row["playerID"], year)
            for column in POSITION_COLUMNS.values():
                appearances[key][column] += int(row[column] or 0)

    pitching: dict[tuple[str, int], list[int]] = defaultdict(lambda: [0, 0])
    with pitching_path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            year = int(row["yearID"])
            if not 1995 <= year <= 2020:
                continue
            key = (row["playerID"], year)
            pitching[key][0] += int(row["G"] or 0)
            pitching[key][1] += int(row["GS"] or 0)

    positions: dict[tuple[str, int], tuple[str, str]] = {}
    for key, totals in appearances.items():
        position = max(POSITION_COLUMNS, key=lambda item: totals[POSITION_COLUMNS[item]])
        if position == "P":
            games, starts = pitching.get(key, [totals["G_p"], 0])
            role = "SP" if starts > 0 and starts >= games - starts else "RP"
            positions[key] = ("RHP", role)
        else:
            positions[key] = (position, "")
    return positions


def iso_date(value: str) -> str:
    return f"{value[:4]}-{value[4:6]}-{value[6:8]}"


def parse_date(value: str) -> datetime | None:
    try:
        return datetime.strptime(value, "%Y%m%d")
    except ValueError:
        return None


def main() -> None:
    args = parse_args()
    people = read_register(args.register)
    lahman_people = read_people(args.people)
    positions = read_positions(args.appearances, args.pitching)

    with zipfile.ZipFile(args.transactions) as archive, archive.open("tran.txt") as raw:
        transactions = list(csv.reader(io.TextIOWrapper(raw, encoding="utf-8")))

    signings: dict[str, list[list[str]]] = defaultdict(list)
    for row in transactions:
        if row[7].strip() == "F" and row[10] in TEAM_IDS:
            signings[row[6]].append(row)
    for rows in signings.values():
        rows.sort(key=lambda row: row[0])

    grants: dict[tuple[int, str], list[str]] = {}
    for row in transactions:
        year = int(row[0][:4])
        transaction_type = row[7].strip()
        if not (1995 <= year <= 2020 and transaction_type in {"Fg", "R"} and row[0][4:6] >= "10"):
            continue
        key = (year, row[6])
        previous = grants.get(key)
        if not previous or (transaction_type == "Fg" and previous[7].strip() != "Fg"):
            grants[key] = row

    seasons: dict[int, list[dict[str, object]]] = defaultdict(list)
    for (year, _player_key), row in sorted(grants.items()):
        person = people.get(row[6])
        if not person or not person["mlb_played_first"]:
            continue
        if not (int(person["mlb_played_first"]) <= year <= int(person["mlb_played_last"])):
            continue
        team_code = row[8]
        if team_code not in TEAM_IDS:
            continue
        granted = parse_date(row[0])
        if not granted:
            continue
        signing = next((candidate for candidate in signings[row[6]]
                        if (signed := parse_date(candidate[0])) and
                        granted < signed <= granted + timedelta(days=183)), None)
        lahman_person = lahman_people.get(row[6])
        if not lahman_person:
            continue
        position_data = positions.get((lahman_person["playerID"], year))
        if not position_data:
            continue
        position, pitcher_role = position_data
        if position == "RHP" and lahman_person["throws"] == "L":
            position = "LHP"
        name = " ".join(part for part in [person["name_first"], person["name_last"], person["name_suffix"]] if part)
        bbref = lahman_person["bbrefID"] or person["key_bbref"]
        entry: dict[str, object] = {
            "playerId": int(person["key_mlbam"]),
            "name": name,
            "position": position,
            "formerTeamId": TEAM_IDS[team_code],
            "formerTeamCode": team_code,
            "league": row[9],
            "grantedDate": iso_date(row[0]),
            "sourceUrl": f"https://www.baseball-reference.com/players/{bbref[0]}/{bbref}.shtml",
        }
        if pitcher_role:
            entry["pitcherRole"] = pitcher_role
        if signing:
            signing_year = signing[0][:4]
            entry["signing"] = {
                "teamId": TEAM_IDS[signing[10]],
                "teamCode": signing[10],
                "officialDate": iso_date(signing[0]),
                "url": f"https://www.retrosheet.org/boxesetc/{signing_year}/YM_{signing_year}.htm",
            }
        seasons[year].append(entry)

    for entries in seasons.values():
        entries.sort(key=lambda entry: (str(entry["league"]), str(entry["position"]), str(entry["name"])))

    lines = [
        "// Generated from Retrosheet transaction data and the Chadwick Register.",
        "// Includes MLB players granted free agency or released from October through December.",
        "(function (global) {",
        "    global.MLB_HISTORICAL_FREE_AGENTS = Object.freeze({",
    ]
    for season in sorted(seasons):
        payload = json.dumps(seasons[season], ensure_ascii=False, separators=(",", ":"))
        lines.append(f"        {season}: Object.freeze({payload}),")
    lines.extend(["    });", "})(window);", ""])
    args.output.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
