import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';

const season = Number(process.env.AWARDS_SEASON || new Date().getUTCFullYear());
const outPath = new URL('../js/awards-auto-data.js', import.meta.url);
const staticDataPath = new URL('../js/awards-data-2026.js', import.meta.url);
const staticContext = { window: {} };
vm.runInNewContext(await readFile(staticDataPath, 'utf8'), staticContext);
const base = staticContext.window.MLB_AWARDS_2026;
const headers = { 'user-agent': 'MLB-SCOREBOOK-GENERATOR/1.0 awards updater' };

async function getText(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`MLB source returned ${response.status}: ${url}`);
  return response.text();
}

const entities = (value) => value
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&ndash;|&mdash;/gi, '-').replace(/&rsquo;|&lsquo;/gi, "'")
  .replace(/&eacute;/gi, 'é').replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
const plain = (html) => entities(html.replace(/<[^>]*>/g, ' ').replace(/<[^>]*$/g, '')).replace(/\s+/g, ' ').trim();

const teams = {
  'Arizona': ['ARI',109], 'Baltimore': ['BAL',110], 'Boston': ['BOS',111], 'Chi Cubs': ['CHC',112], 'Chicago Cubs': ['CHC',112],
  'Cincinnati': ['CIN',113], 'Cleveland': ['CLE',114], 'Colorado': ['COL',115], 'Detroit': ['DET',116], 'Houston': ['HOU',117],
  'Kansas City': ['KC',118], 'LA Dodgers': ['LAD',119], 'Los Angeles Dodgers': ['LAD',119], 'Washington': ['WSH',120], 'NY Mets': ['NYM',121],
  'Oakland': ['ATH',133], 'Athletics': ['ATH',133], 'Pittsburgh': ['PIT',134], 'San Diego': ['SD',135], 'Seattle': ['SEA',136],
  'San Francisco': ['SF',137], 'St. Louis': ['STL',138], 'Tampa Bay': ['TB',139], 'Texas': ['TEX',140], 'Toronto': ['TOR',141],
  'Minnesota': ['MIN',142], 'Philadelphia': ['PHI',143], 'Atlanta': ['ATL',144], 'Chi White Sox': ['CWS',145], 'Chicago White Sox': ['CWS',145],
  'Miami': ['MIA',146], 'NY Yankees': ['NYY',147], 'Milwaukee': ['MIL',158]
};
const japaneseNames = {
  'Gabriel Moreno':'G.モレノ','Pete Alonso':'P.アロンソ','Brice Turang':'B.トゥラング','Bobby Witt Jr.':'B.ウィット Jr.',
  'Junior Caminero':'J.カミネロ','Pete Crow-Armstrong':'P.クローアームストロング','Fernando Tatis Jr.':'F.タティス Jr.',
  'Jackson Chourio':'J.チョーリオ','Yordan Alvarez':'Y.アルバレス','Jacob Misiorowski':'J.ミザロウスキー','Cam Schlittler':'C.シュリットラー',
  'Chris Sale':'C.セール','Dylan Cease':'D.シース','Cristopher Sánchez':'C.サンチェス','Mason Miller':'M.ミラー','Louis Varland':'L.バーランド',
  'William Contreras':'W.コントレラス','Willson Contreras':'W.コントレラス','Brandon Lowe':'B.ロウ','Elly De La Cruz':'E.デラクルーズ',
  'Alex Bregman':'A.ブレグマン','James Wood':'J.ウッド','Randy Arozarena':'R.アロザレーナ','Jordan Walker':'J.ウォーカー',
  'Ben Rice':'B.ライス','Yoshinobu Yamamoto':'山本 由伸','Sonny Gray':'S.グレイ','Tarik Skubal':'T.スクーバル',
  'Drew Rasmussen':'D.ラスムッセン','Jesús Luzardo':'J.ルザルド','Bryan Baker':'B.ベイカー','Cade Smith':'C.スミス'
};

function parseAllMlb(html) {
  const start = html.search(new RegExp(`<h[1-3][^>]*>[^<]*${season} All-MLB Team`, 'i'));
  if (start < 0) throw new Error(`Official All-MLB page has no ${season} season section yet`);
  const tail = html.slice(start);
  const nextSeason = tail.search(new RegExp(`<h[1-3][^>]*>[^<]*${season - 1} All-MLB Team`, 'i'));
  const section = nextSeason > 0 ? tail.slice(0, nextSeason) : tail;
  const headings = [...section.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)];
  const parseTeam = (label) => {
    const heading = headings.findIndex((match) => plain(match[1]).toLowerCase().includes(label.toLowerCase()));
    if (heading < 0) throw new Error(`Missing ${label} heading on official All-MLB page`);
    const from = headings[heading].index + headings[heading][0].length;
    const until = headings[heading + 1]?.index ?? section.length;
    const block = section.slice(from, until);
    const rows = [...block.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => plain(cell[1])));
    return rows.filter((row) => row.length >= 4 && row[0] !== 'Year' && row[0] !== String(season)).map((row) => {
      const [position, player, teamName] = row.length >= 4 ? [row[1], row[2], row[3]] : row;
      const team = teams[teamName];
      if (!team || !player || !position) return null;
      return [position, japaneseNames[player] || player, team[0], team[1]];
    }).filter(Boolean);
  };
  const first = parseTeam('First Team');
  const second = parseTeam('Second Team');
  if (first.length !== 16 || second.length !== 16) throw new Error(`Official All-MLB table parsed ${first.length}/${second.length} entries; keeping last good snapshot`);
  return { label: 'オールMLB', group: 'major', status: 'announced', announcedAt: `${season}-11-12`, sourceUrl: 'https://www.mlb.com/awards/all-mlb', first, second };
}

function collectRecipients(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) { value.forEach((item) => collectRecipients(item, found)); return found; }
  if (value.player?.id && value.player?.fullName) found.push(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') collectRecipients(child, found);
  return found;
}

async function fetchMvp() {
  const url = `https://statsapi.mlb.com/api/v1/awards/MLBMVP/recipients?season=${season}`;
  const response = await fetch(url, { headers });
  if (response.status === 404) {
    // StatsAPI can lag or omit a season even after MLB has announced its MVPs.
    // Keep the official static result for this season, and let the other award
    // sources (notably All-MLB) continue updating instead of failing the job.
    console.warn(`MLB Stats API has no ${season} MVP recipient response; retaining the existing official result when available.`);
    return season === base.season && base.categories.mvp?.status === 'announced'
      ? base.categories.mvp
      : null;
  }
  if (!response.ok) throw new Error(`MLB source returned ${response.status}: ${url}`);
  const api = await response.text();
  const records = collectRecipients(JSON.parse(api));
  const finalistRows = [ ...(base.categories.mvp.finalists?.al || []).map((p) => ({ ...p, leagueKey: 'al' })), ...(base.categories.mvp.finalists?.nl || []).map((p) => ({ ...p, leagueKey: 'nl' })) ];
  const winners = {};
  for (const record of records) {
    const playerId = Number(record.player.id);
    const leagueKey = finalistRows.find((p) => Number(p.playerId) === playerId)?.leagueKey;
    if (!leagueKey) continue;
    const finalist = base.categories.mvp.finalists[leagueKey].find((p) => Number(p.playerId) === playerId);
    const prior = base.categories.mvp[leagueKey];
    winners[leagueKey] = { ...prior, player: record.player.fullName, playerId, playerJa: finalist.playerJa, team: record.team?.abbreviation || finalist.team, teamId: Number(record.team?.id || finalist.teamId) };
  }
  if (!winners.al || !winners.nl) return null;
  return { ...base.categories.mvp, ...winners, status: 'announced', announcedAt: `${season}-11-12`, sourceUrl: `https://www.mlb.com/news/${season}-mlb-mvp-award-winners` };
}

const [allMlbHtml, mvpCategory] = await Promise.all([
  getText('https://www.mlb.com/awards/all-mlb'),
  fetchMvp()
]);
const categories = { allMlb: parseAllMlb(allMlbHtml) };
if (mvpCategory) categories.mvp = mvpCategory;
const output = `// Generated from MLB official award pages by scripts/update-mlb-awards.mjs.\nwindow.MLB_AWARDS_AUTO = ${JSON.stringify({ season, checkedAt: new Date().toISOString(), categories }, null, 2)};\n`;
await writeFile(outPath, output);
console.log(`Updated ${Object.keys(categories).join(', ')} from MLB official sources (${season}).`);
