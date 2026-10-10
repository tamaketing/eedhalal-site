import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The four control docs must stay present, structurally intact, and
// cross-linked. AI tools load AGENTS.md automatically, but nothing enforced
// the other control docs — a deleted, renamed, or silently restructured doc
// misleads the next edit. This gate catches that before release.
//
// Anchors use stable English literals on purpose: Thai headings get
// rephrased, English contract markers should not move without intent.
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const CONTROL_DOCS = [
  'AGENTS.md',
  'FACTS.md',
  'DEPLOY.md',
  'tools/admin/README.md',
];

export const REQUIRED_ANCHORS = {
  'AGENTS.md': [
    '## Document Responsibilities',
    '## Required Synchronization',
    '## Human Sales Page Rules',
  ],
  'FACTS.md': ['data/sync-manifest.json', 'data/business-rules.json'],
  'DEPLOY.md': ['node scripts/check-business-sync.mjs --check', 'EED_ALLOW_GIT_DEPLOY=1'],
  'tools/admin/README.md': ['EED_ADMIN_DATA_DIR'],
};

export const README_TITLE = '# EED HALAL';

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

export function docFile(root, doc) {
  return path.join(root, ...doc.split('/'));
}

// process.argv[1] is a filesystem path, while import.meta.url is a file URL.
// Accepting an explicit path keeps this testable the same way
// check-repository-safety.mjs does.
export function isMainModule(invokedPath = process.argv[1]) {
  if (!invokedPath) return false;
  return pathToFileURL(path.resolve(invokedPath)).href === import.meta.url;
}

export function extractDocLinks(markdown) {
  const withoutCode = markdown.replace(/`[^`]*`/g, '');
  const links = [];
  for (const match of withoutCode.matchAll(LINK)) {
    if (match.index > 0 && withoutCode[match.index - 1] === '!') continue; // image, not a doc link
    let target = match[1].trim().replace(/\\/g, '/');
    if (/^(https?:|mailto:|#)/i.test(target)) continue;
    target = target.split('#')[0].trim();
    if (!target) continue;
    links.push(target);
  }
  return links;
}

export async function checkDocs(root = ROOT) {
  const failures = [];
  const contents = new Map();
  for (const doc of CONTROL_DOCS) {
    try {
      // Strip a leading BOM: some editors save one, and it must not break
      // the README title check or link extraction.
      contents.set(doc, (await readFile(docFile(root, doc), 'utf8')).replace(/^\uFEFF/, ''));
    } catch {
      failures.push(`${doc}: control document is missing`);
    }
  }
  let anchorCount = 0;
  let linkCount = 0;
  for (const [doc, anchors] of Object.entries(REQUIRED_ANCHORS)) {
    const text = contents.get(doc);
    if (text === undefined) continue; // already reported as missing
    for (const anchor of anchors) {
      anchorCount += 1;
      if (!text.includes(anchor)) failures.push(`${doc}: required anchor is missing: ${anchor}`);
    }
  }
  const readme = contents.get('tools/admin/README.md');
  if (readme !== undefined) {
    anchorCount += 1;
    if (!readme.split(/\r?\n/, 1)[0].startsWith(README_TITLE)) {
      failures.push(`tools/admin/README.md: first line must start with "${README_TITLE}"`);
    }
  }
  for (const [doc, text] of contents) {
    const dir = path.dirname(docFile(root, doc));
    for (const target of extractDocLinks(text)) {
      linkCount += 1;
      const resolved = path.resolve(dir, ...target.split('/'));
      const relative = path.relative(root, resolved);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        failures.push(`${doc}: link escapes the repository: ${target}`);
        continue;
      }
      try {
        if (!(await stat(resolved)).isFile()) failures.push(`${doc}: dead link (not a file): ${target}`);
      } catch {
        failures.push(`${doc}: dead link (missing): ${target}`);
      }
    }
  }
  return { failures, anchorCount, linkCount };
}

if (isMainModule()) {
  // Optional argv[2] exists only so tests can point the scan at a temp dir.
  // Normal use is bare `node scripts/check-docs.mjs` from the repo root.
  const { failures, anchorCount, linkCount } = await checkDocs(
    path.resolve(process.argv[2] || ROOT),
  );
  if (failures.length > 0) {
    console.error('Docs validation failed:');
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log(`Docs OK: ${CONTROL_DOCS.length} control documents, ${anchorCount} anchors, ${linkCount} links verified.`);
}
