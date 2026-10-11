import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://eedhalal.com';
// Preserve the existing access policy, including legacy tokens. A declaration
// proves permission only, never a visit, verified bot identity, or a citation.
export const SEARCH_AGENTS = [
  'Googlebot', 'bingbot', 'Applebot', 'GPTBot', 'ChatGPT-User', 'OAI-SearchBot',
  'Google-Extended', 'Google-CloudVertexBot', 'ClaudeBot', 'Claude-SearchBot',
  'Claude-User', 'anthropic-ai', 'Meta-ExternalAgent', 'FacebookBot',
  'PerplexityBot', 'Perplexity-User', 'GrokBot', 'xAI-Grok', 'CopilotBot',
  'MistralAI-User', 'Amazonbot', 'Applebot-Extended', 'Bytespider', 'cohere-ai',
  'CCBot', 'YouBot', 'DuckAssistBot', 'iaskspider', 'KagiBot', 'Diffbot',
  'omgili', 'omgilibot', 'img2dataset',
];

export function parseRobots(source) {
  const groups = [];
  let group;
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*([\w-]+)\s*:\s*(.*?)\s*$/.exec(line.split('#')[0]);
    if (!match) continue;
    const [, rawKey, value] = match;
    const key = rawKey.toLowerCase();
    if (key === 'user-agent') {
      if (!group || group.rules.length) {
        group = { agents: [], rules: [] };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
    } else if (group && ['allow', 'disallow'].includes(key) && value) {
      group.rules.push({ allow: key === 'allow', value });
    }
  }
  return groups;
}

// RFC 9309 group selection: specific groups do not inherit wildcard rules.
// Applicable groups are merged; the longest path wins, with Allow winning ties.
export function crawlAllowed(groups, agent, target) {
  const name = agent.toLowerCase();
  const ranked = groups.map(group => ({ group, rank: Math.max(-1, ...group.agents.map(token => token === '*' ? 0 : name.includes(token) ? token.length : -1)) }));
  const rank = Math.max(-1, ...ranked.map(item => item.rank));
  const matches = ranked.filter(item => item.rank === rank && rank >= 0)
    .flatMap(item => item.group.rules).filter(rule => {
      const escaped = rule.value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
      const pattern = rule.value.endsWith('$') ? escaped.slice(0, -2) + '$' : escaped;
      return new RegExp(`^${pattern}`).test(target);
    }).sort((a, b) => b.value.replaceAll('*', '').length - a.value.replaceAll('*', '').length || Number(b.allow) - Number(a.allow));
  return matches[0]?.allow ?? true;
}

function attr(tag, name) {
  return new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(tag)?.[1];
}

export async function checkSearchDiscovery(root = ROOT) {
  const read = file => readFile(path.join(root, file), 'utf8');
  const [robots, sitemap, llms, full] = await Promise.all(['robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.md'].map(read));
  const groups = parseRobots(robots);
  const declared = new Set(groups.flatMap(group => group.agents));
  const failures = [];
  for (const agent of ['*', ...SEARCH_AGENTS]) {
    if (!declared.has(agent.toLowerCase())) failures.push(`robots.txt: missing ${agent}`);
  }
  if (!robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`)) failures.push('robots.txt: missing canonical sitemap');
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  if (new Set(urls).size !== urls.length) failures.push('sitemap.xml: duplicate URLs');
  const publicData = ['/data/planner-overrides.json', '/data/business-rules.json', '/data/menu-copy-en.json']
    .flatMap(url => [url, `${url}?t=1`]);
  const publicPaths = [...urls.map(url => new URL(url).pathname), '/llms.txt', '/llms-full.md', '/sitemap.xml', '/css/style.css', '/js/main.js', '/js/menu-data.js', ...publicData];
  for (const agent of [...SEARCH_AGENTS, 'UnlistedSearchAgent']) {
    for (const url of publicPaths) if (!crawlAllowed(groups, agent, url)) failures.push(`robots.txt: ${agent} cannot crawl ${url}`);
    for (const url of ['/budget-planner.html', '/kitchen-order.html', '/en.html', '/data/private-placeholder.json']) {
      if (crawlAllowed(groups, agent, url)) failures.push(`robots.txt: ${agent} bypasses the exclusion for ${url}`);
    }
  }
  const titles = new Map();
  for (const url of urls) {
    const parsed = new URL(url);
    if (parsed.origin !== ORIGIN) { failures.push(`sitemap.xml: wrong origin ${url}`); continue; }
    const file = parsed.pathname === '/' ? 'index.html' : parsed.pathname.slice(1);
    const html = (await read(file)).replace(/<!--[\s\S]*?-->/g, '');
    const title = /<title>([^<]+)<\/title>/i.exec(html)?.[1];
    const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0]);
    if (!title) failures.push(`${file}: missing title`);
    else if (titles.has(title)) failures.push(`${file}: duplicate title with ${titles.get(title)}`);
    else titles.set(title, file);
    if (!metas.some(tag => attr(tag, 'name') === 'description' && attr(tag, 'content')?.trim())) failures.push(`${file}: missing description`);
    if (!metas.some(tag => attr(tag, 'name') === 'viewport')) failures.push(`${file}: missing mobile viewport`);
    if ([...html.matchAll(/<h1\b/gi)].length !== 1) failures.push(`${file}: expected one H1`);
    for (const tag of metas) {
      if (/^(robots|googlebot|bingbot)$/i.test(attr(tag, 'name') || '') && /\b(noindex|nofollow|nosnippet|none)\b|max-snippet\s*:\s*0\b/i.test(attr(tag, 'content') || '')) failures.push(`${file}: restrictive search meta ${tag}`);
    }
    if (!html.includes('href="/llms.txt"')) failures.push(`${file}: missing LLM discovery link`);
    if (/^(en\/)?(table-service|set-menu)\.html$/.test(file) && !/"@type":\s*"Service"/.test(html)) failures.push(`${file}: missing service schema`);
  }
  for (const [file, content] of [['llms.txt', llms], ['llms-full.md', full]]) {
    if (/publishes\s+(?:\*\*)?no prices|publishes no per-dish prices|no prices by design|44 dishes|MENU_CONTEXT|30[–-]1000\+/i.test(content)) failures.push(`${file}: retired catalogue/capacity instructions`);
    // Check the actual citation destinations, including absolute same-site links.
    const links = new Set([...content.matchAll(/https:\/\/eedhalal\.com\/[^\s)`<>]*/g)].map(match => match[0].replace(/[.,;]+$/, '')));
    for (const link of links) {
      const pathname = new URL(link).pathname;
      const target = pathname === '/' ? 'index.html' : pathname.slice(1);
      try { if (!(await stat(path.join(root, target))).isFile()) failures.push(`${file}: invalid citation ${link}`); }
      catch { failures.push(`${file}: missing citation ${link}`); }
    }
  }
  assert.deepEqual(failures, [], `Search discovery validation failed:\n${failures.join('\n')}`);
  console.log(`Search discovery passed: ${urls.length} pages, ${SEARCH_AGENTS.length} named agents + wildcard, public menu data, and both AI files.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkSearchDiscovery();
