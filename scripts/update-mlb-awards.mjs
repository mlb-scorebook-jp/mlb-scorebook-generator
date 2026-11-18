import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const season = Number(process.env.AWARDS_SEASON || new Date().getUTCFullYear());
const outPath = new URL('../js/awards-auto-data.js', import.meta.url);
const staticDataPath = new URL('../js/awards-data-2026.js', import.meta.url);
const staticContext = { window: {} };
vm.runInNewContext(await readFile(staticDataPath, 'utf8'), staticContext);
const base = staticContext.window.MLB_AWARDS_2026;
const previousContext = { window: {} };
try {
  vm.runInNewContext(await readFile(outPath, 'utf8'), previousContext);
} catch {
  // First run: no generated snapshot exists yet.
}
const previous = previousContext.window.MLB_AWARDS_AUTO;
const previousCategories = previous?.season === season ? (previous.categories ?? {}) : {};
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
  'Miami': ['MIA',146], 'NY Yankees': ['NYY',147], 'Milwaukee': ['MIL',158], 'LA Angels': ['LAA',108],
  'New York': ['NYY',147], 'Chicago': ['CWS',145], 'Los Angeles': ['LAD',119],
  'D-backs': ['ARI',109], 'Arizona D-backs': ['ARI',109], 'Detroit/LAD': ['LAD',119],
  'New York Yankees': ['NYY',147]
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

const historySources = {
  mvp: 'most-valuable-player', cyYoung: 'cy-young', rookie: 'rookie-of-the-year', manager: 'manager-of-the-year',
  goldGlove: 'gold-glove', platinumGlove: 'platinum-glove', silverSlugger: 'silver-slugger', hankAaron: 'hank-aaron',
  outstandingDh: 'outstanding-dh', comeback: 'comeback-player', reliever: 'reliever-of-the-year',
  clemente: 'roberto-clemente', allStarMvp: 'all-star', postseason: 'postseason'
};

function parseHistoryRows(html) {
  const events = [];
  for (const heading of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    events.push({ index: heading.index, type: 'heading', level: Number(heading[1]), text: plain(heading[2]) });
  }
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    events.push({ index: table.index, type: 'table', html: table[1] });
  }
  events.sort((a, b) => a.index - b.index);
  let trail = [];
  const rows = [];
  for (const event of events) {
    if (event.type === 'heading') {
      trail = trail.slice(0, Math.max(0, event.level - 2));
      trail[event.level - 2] = event.text;
      trail = trail.filter(Boolean);
      continue;
    }
    for (const match of event.html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => plain(cell[1]));
      if (Number(cells[0]) !== season || cells.length < 3 || /^year$/i.test(cells[0])) continue;
      const player = cells[1];
      if (/^(team|team award|best team)$/i.test(player)) continue;
      const playerIdMatch = match[1].match(/href=["'][^"']*\/(?:player|people|coach|manager)\/(\d+)/i);
      rows.push({ season, player, playerId: playerIdMatch ? Number(playerIdMatch[1]) : null, teamName: cells[2], position: cells[3] || '', section: trail.join(' / '), cells });
    }
  }
  return rows;
}

function teamDetails(teamName, section = '') {
  const explicitLeague = teamName.match(/\((AL|NL)\)/i)?.[1]?.toLowerCase();
  const cleanName = teamName.replace(/\s*\((?:AL|NL)\)\s*/i, '').trim();
  let details = teams[cleanName];
  const league = explicitLeague || (/american league/i.test(section) ? 'al' : /national league/i.test(section) ? 'nl' : null);
  if (['New York', 'New York Yankees', 'New York (AL)'].includes(cleanName)) details = league === 'nl' ? ['NYM',121] : ['NYY',147];
  if (cleanName === 'Chicago') details = league === 'nl' ? ['CHC',112] : ['CWS',145];
  if (cleanName === 'Los Angeles') details = league === 'al' ? ['LAA',108] : ['LAD',119];
  return { team: details?.[0] || '', teamId: details?.[1] || null, league };
}

function knownRows(category) {
  const found = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && (value.playerId || value.player || value.playerJa)) found.push(value);
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  };
  visit(category);
  return found;
}

function makeWinner(row, category, leagueKey = null) {
  const priorRows = knownRows(category);
  const catalogRows = [...knownRows(base.categories), ...knownRows(previousCategories)];
  const { team, teamId, league } = teamDetails(row.teamName, row.section);
  const matchesPlayer = (entry) =>
    (row.playerId && Number(entry.playerId) === row.playerId) ||
    (entry.player && entry.player.toLowerCase() === row.player.toLowerCase());
  const prior = priorRows.find((entry) => matchesPlayer(entry) ||
    (leagueKey && entry.team === team && (entry.playerJa || entry.player)));
  const known = prior || catalogRows.find(matchesPlayer);
  const playerId = row.playerId || (known?.playerId ? Number(known.playerId) : null);
  if (!playerId || !teamId) return null;
  return {
    ...(known || {}),
    ...(leagueKey ? { league: leagueKey === 'al' ? 'AMERICAN LEAGUE' : 'NATIONAL LEAGUE' } : {}),
    player: row.player,
    playerJa: japaneseNames[row.player] || prior?.playerJa || row.player,
    playerId,
    team,
    teamId,
    ...(row.position ? { position: row.position } : {}),
    ...(prior?.count != null ? { count: prior.count } : {}),
    ...(prior?.votePoints != null ? { votePoints: prior.votePoints } : {}),
    stats: prior?.stats && !Array.isArray(prior.stats) ? prior.stats : {}
  };
}

function parseHistoryCategory(key, html) {
  const sourceUrl = `https://www.mlb.com/awards/${historySources[key]}`;
  const category = base.categories[key] || previousCategories[key] || { label: key, group: 'major', status: 'pending' };
  if (key === 'reliever') {
    const bbwaaStart = html.search(/<h[1-6]\b[^>]*>[^<]*BBWAA Awards[^<]*<\/h[1-6]>/i);
    if (bbwaaStart >= 0) html = html.slice(bbwaaStart);
  }
  let rows = parseHistoryRows(html);
  if (key === 'postseason') rows = rows.filter((row) => /world series|alcs|nlcs/i.test(row.section));
  if (!rows.length) return null;

  if (['mvp','cyYoung','rookie','manager','comeback','reliever','hankAaron'].includes(key)) {
    const winners = {};
    for (const leagueKey of ['al','nl']) {
      const row = rows.find((entry) => entry.section.toLowerCase().includes(leagueKey === 'al' ? 'american league' : 'national league'));
      if (!row) return null;
      winners[leagueKey] = makeWinner(row, category, leagueKey);
      if (!winners[leagueKey]) return null;
    }
    return { ...category, ...winners, status: 'announced', sourceUrl };
  }

  if (key === 'goldGlove') {
    const grouped = new Map();
    for (const row of rows) {
      const leagueKey = row.section.toLowerCase().includes('american league') ? 'al' : row.section.toLowerCase().includes('national league') ? 'nl' : null;
      if (!leagueKey) continue;
      if (!['P','C','1B','2B','3B','SS','LF','CF','RF','UT'].includes(row.position)) continue;
      const winner = makeWinner(row, category, leagueKey);
      if (!winner) return null;
      const position = row.position || '—';
      if (!grouped.has(position)) grouped.set(position, { position, positionJa: ({ P: '投手', C: '捕手', '1B': '一塁手', '2B': '二塁手', '3B': '三塁手', SS: '遊撃手', LF: '左翼手', CF: '中堅手', RF: '右翼手', UT: 'ユーティリティー' })[position] || position });
      grouped.get(position)[leagueKey] = winner;
    }
    const winners = [...grouped.values()].filter((row) => row.al && row.nl);
    if (winners.length !== 10) return null;
    return { ...category, winners, status: 'announced', sourceUrl };
  }

  if (key === 'postseason') {
    const mapping = { worldSeriesMvp: /world series/i, alcsMvp: /alcs/i, nlcsMvp: /nlcs/i };
    return Object.fromEntries(Object.entries(mapping).map(([categoryKey, pattern]) => {
      const match = rows.find((row) => pattern.test(row.section));
      if (!match) return [categoryKey, null];
      const winner = makeWinner(match, base.categories[categoryKey]);
      return [categoryKey, winner ? { ...base.categories[categoryKey], status: 'announced', sourceUrl, winners: [{ ...winner, honor: base.categories[categoryKey].winners?.[0]?.honor || base.categories[categoryKey].label }] } : null];
    }));
  }

  if (key === 'silverSlugger') rows = rows.filter((row) => ['C','1B','2B','3B','SS','OF','DH','UT'].includes(row.position));
  const required = key === 'silverSlugger' ? 20 : null;
  if (required && rows.length < required) return null;
  const winners = rows.map((row) => makeWinner(row, category)).filter(Boolean);
  if (!winners.length || winners.length !== rows.length) return null;
  return { ...category, winners: winners.map((winner) => ({ ...winner, honor: category.label })), status: 'announced', sourceUrl };
}

async function trySource(label, fetcher, fallback) {
  try {
    return await fetcher();
  } catch (error) {
    console.warn(`${label} could not be refreshed; preserving the last known data. ${error.message}`);
    return fallback ?? null;
  }
}

const historyHtmlCache = new Map();
async function getHistoryPage(slug) {
  if (!historyHtmlCache.has(slug)) historyHtmlCache.set(slug, getText(`https://www.mlb.com/awards/${slug}`));
  return historyHtmlCache.get(slug);
}
const historyKeys = Object.keys(historySources).filter((key) => key !== 'postseason');
const [allMlbCategory, ...historyResults] = await Promise.all([
  trySource('All-MLB', async () => parseAllMlb(await getHistoryPage('all-mlb')), previousCategories.allMlb ?? (season === base.season ? base.categories.allMlb : null)),
  ...historyKeys.map((key) => trySource(key, async () => {
    const result = parseHistoryCategory(key, await getHistoryPage(historySources[key]));
    if (!result) throw new Error(`Official ${key} history has no complete ${season} result yet`);
    return result;
  }, previousCategories[key] ?? (season === base.season ? base.categories[key] : null))),
  trySource('postseason', async () => {
    const result = parseHistoryCategory('postseason', await getHistoryPage(historySources.postseason));
    if (!result || ['alcsMvp','nlcsMvp','worldSeriesMvp'].some((key) => !result[key])) throw new Error(`Official postseason history has no complete ${season} result yet`);
    return result;
  }, Object.fromEntries(['alcsMvp','nlcsMvp','worldSeriesMvp'].map((key) => [key, previousCategories[key] ?? (season === base.season ? base.categories[key] : null)])))
]);
const historyCategories = Object.fromEntries(historyKeys.map((key, index) => [key, historyResults[index]]));
const postseasonCategories = historyResults.at(-1) || {};

const categories = {
  ...previousCategories,
  ...(allMlbCategory ? { allMlb: allMlbCategory } : {}),
  ...Object.fromEntries(Object.entries(historyCategories).filter(([, value]) => value)),
  ...Object.fromEntries(Object.entries(postseasonCategories).filter(([, value]) => value))
};
if (!Object.keys(categories).length) {
  console.warn(`No award data was available for ${season}; leaving the existing snapshot untouched.`);
  process.exit(0);
}

const snapshot = { season, categories };
const snapshotHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 12);
const previousHash = previous?.season === season
  ? createHash('sha256').update(JSON.stringify({ season, categories: previous.categories ?? {} })).digest('hex').slice(0, 12)
  : null;
const checkedAt = previousHash === snapshotHash ? previous.checkedAt : new Date().toISOString();
const output = `// Generated from MLB official award pages by scripts/update-mlb-awards.mjs.\nwindow.MLB_AWARDS_AUTO = ${JSON.stringify({ ...snapshot, checkedAt }, null, 2)};\n`;
const oldOutput = await readFile(outPath, 'utf8').catch(() => '');
if (oldOutput !== output) await writeFile(outPath, output);

const indexPath = new URL('../index.html', import.meta.url);
const indexHtml = await readFile(indexPath, 'utf8');
const versionedIndex = indexHtml.replace(/(<script src="js\/awards-auto-data\.js\?v=)[^"]*("><\/script>)/, `$1${snapshotHash}$2`);
if (versionedIndex === indexHtml && !indexHtml.includes(`js/awards-auto-data.js?v=${snapshotHash}`)) {
  throw new Error('Could not locate the awards auto-data script in index.html to refresh its cache version');
}
if (versionedIndex !== indexHtml) await writeFile(indexPath, versionedIndex);
console.log(`Updated/preserved ${Object.keys(categories).join(', ')} from MLB official sources (${season}); snapshot ${snapshotHash}.`);
