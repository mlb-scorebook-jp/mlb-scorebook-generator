#!/usr/bin/env python3
"""Add official MLB fielding totals to the generated Gold Glove history."""

import json
import pathlib
import csv
import io
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "js" / "awards-history-2007-2025.js"
PREFIX = "window.MLB_AWARDS_HISTORY = "


def load_history():
    source = DATA_PATH.read_text(encoding="utf-8").strip()
    return json.loads(source.removeprefix(PREFIX).removesuffix(";"))


def fetch_people(season, player_ids):
    query = urllib.parse.urlencode({
        "personIds": ",".join(str(player_id) for player_id in player_ids),
        "hydrate": f"stats(group=[fielding],type=[season],season={season},gameType=R)",
    })
    request = urllib.request.Request(
        f"https://statsapi.mlb.com/api/v1/people?{query}",
        headers={"User-Agent": "MLB Scorebook Generator"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response).get("people", [])


def fetch_csv(url, params):
    request = urllib.request.Request(
        f"{url}?{urllib.parse.urlencode(params)}",
        headers={"User-Agent": "MLB Scorebook Generator"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        text = response.read().decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


def signed_number(value):
    if value in (None, "", "null"):
        return None
    rounded = round(float(value))
    return f"+{rounded}" if rounded > 0 else str(rounded)


def fetch_statcast(season):
    if int(season) < 2016:
        return {}, {}
    common = {"type": "fielder", "gameType": "Regular", "position": 0, "team": "", "csv": "true"}
    frv_rows = fetch_csv("https://baseballsavant.mlb.com/leaderboard/fielding-run-value", {
        **common, "seasonStart": season, "seasonEnd": season, "minInnings": 1, "minResults": 1,
    })
    oaa_rows = fetch_csv("https://baseballsavant.mlb.com/leaderboard/outs_above_average", {
        "type": "Fielder", "startYear": season, "endYear": season, "split": "no", "team": "",
        "range": "year", "min": 1, "pos": "", "roles": "", "viz": "hide", "csv": "true",
    })
    frv = {int(row["id"]): signed_number(row.get("total_runs")) for row in frv_rows if row.get("id")}
    oaa = {int(row["player_id"]): signed_number(row.get("outs_above_average")) for row in oaa_rows if row.get("player_id")}
    return frv, oaa


def matching_splits(person, award_position):
    stats = person.get("stats", [])
    splits = stats[0].get("splits", []) if stats else []
    if award_position == "OF":
        wanted = {"LF", "CF", "RF", "OF"}
        return [row for row in splits if row.get("position", {}).get("abbreviation") in wanted]
    if award_position == "UT":
        return [row for row in splits if row.get("position", {}).get("abbreviation") != "DH"]
    exact = [row for row in splits if row.get("position", {}).get("abbreviation") == award_position]
    return exact or [row for row in splits if row.get("position", {}).get("abbreviation") != "DH"]


def main():
    history = load_history()
    for season, leagues in history.items():
        winners = leagues.get("al", []) + leagues.get("nl", [])
        people = fetch_people(season, sorted({row["playerId"] for row in winners if row.get("playerId")}))
        people_by_id = {person["id"]: person for person in people}
        frv_by_id, oaa_by_id = fetch_statcast(season)
        for winner in winners:
            rows = matching_splits(people_by_id.get(winner.get("playerId"), {}), winner.get("position"))
            chances = sum(int(row.get("stat", {}).get("chances") or 0) for row in rows)
            errors = sum(int(row.get("stat", {}).get("errors") or 0) for row in rows)
            winner["chances"] = chances or None
            winner["errors"] = errors if chances else None
            winner["fieldingPct"] = f"{(chances - errors) / chances:.3f}".removeprefix("0") if chances else "—"
            metrics = []
            if winner.get("playerId") in frv_by_id and frv_by_id[winner["playerId"]] is not None:
                metrics.append({"label": "FRV", "value": frv_by_id[winner["playerId"]]})
            if winner.get("playerId") in oaa_by_id and oaa_by_id[winner["playerId"]] is not None:
                metrics.append({"label": "OAA", "value": oaa_by_id[winner["playerId"]]})
            winner["metrics"] = metrics
        print(f"{season}: {len(winners)} winners")
    DATA_PATH.write_text(PREFIX + json.dumps(history, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")


if __name__ == "__main__":
    main()
