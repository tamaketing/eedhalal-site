import assert from 'node:assert/strict';
import test from 'node:test';
import { crawlAllowed, parseRobots } from '../scripts/check-search-discovery.mjs';

test('specific bot rules do not inherit wildcard exclusions', () => {
  const groups = parseRobots('User-agent: *\nDisallow: /data/\n\nUser-agent: ClaudeBot\nAllow: /');
  assert.equal(crawlAllowed(groups, 'ClaudeBot', '/data/example.json'), true);
  assert.equal(crawlAllowed(groups, 'OtherBot', '/data/example.json'), false);
});

test('a shared group preserves exclusions for named and unlisted agents', () => {
  const groups = parseRobots('User-agent: *\n\n# Provider\nUser-agent: ClaudeBot\nAllow: /\nDisallow: /data/\nAllow: /data/public.json$\nAllow: /data/public.json?');
  for (const name of ['ClaudeBot', 'OtherBot']) {
    assert.equal(crawlAllowed(groups, name, '/menu.html'), true);
    assert.equal(crawlAllowed(groups, name, '/data/private.json'), false);
    assert.equal(crawlAllowed(groups, name, '/data/public.json'), true);
    assert.equal(crawlAllowed(groups, name, '/data/public.json?t=1'), true);
    assert.equal(crawlAllowed(groups, name, '/data/public.json.backup'), false);
  }
});

test('equally specific groups merge and allow wins equal path ties', () => {
  const groups = parseRobots('User-agent: Bot\nDisallow: /x\nUser-agent: Bot\nAllow: /x');
  assert.equal(crawlAllowed(groups, 'Bot', '/x'), true);
});

test('longer exclusions win over broad allow wildcards', () => {
  const groups = parseRobots('User-agent: *\nAllow: /*\nDisallow: /internal/*\nAllow: /internal/help$');
  assert.equal(crawlAllowed(groups, 'Bot', '/internal/notes'), false);
  assert.equal(crawlAllowed(groups, 'Bot', '/internal/help'), true);
});
