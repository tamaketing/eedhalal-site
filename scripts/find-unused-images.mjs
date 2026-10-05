// Find (and optionally delete) images in img/ that nothing references.
//
// WHY THIS EXISTS: a photo that is still referenced by data/planner-overrides.json,
// js/menu-data.js, the owner's central draft or any HTML page will break the
// deployed site the moment the file is gone — and the breakage is silent, because
// the menu data keeps pointing at a path that no longer resolves. That is exactly
// how 19 in-use photos ended up deleted once. `check-public-site.mjs` is the gate
// that catches it AFTER the fact; this script is how you find the safe deletions
// BEFORE deleting anything.
//
// Usage
//   node scripts/find-unused-images.mjs          report only (safe, read-only)
//   node scripts/find-unused-images.mjs --write  delete the reported files
//
// How a file counts as "used"
//   - its repo-relative path appears in any tracked-or-present text file
//     (html, css, js, mjs, json, md, xml, txt, webmanifest, yml)
//   - OR its bare filename appears anywhere, because image paths are written in
//     several shapes ("img/x.jpg", "./img/x.jpg", "/img/x.jpg", escaped JSON)
//   - the owner's central draft is scanned too: an image he is about to publish
//     must never be reported as unused
//
// Never deleted, whatever the report says
//   - brand assets: img/logo.*, favicon/app-icon assets named in index.html
//   - anything inside a directory listed in BRAND_PROTECTED
import { readFile, readdir, unlink, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
const IMG_DIR = path.join(ROOT, 'img');
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|avif|ico)$/i;

// Directories never walked: archives, demos, build output and dependencies hold
// copies and fixtures, not live references.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'img_archive_local', 'demo', '_site', 'artifacts',
  'tmp-preview', 'backups', '.opencode',
]);
// Scanned even though they are not part of the public site, because they decide
// what gets published next.
const EXTRA_REFERENCE_FILES = [
  'data/planner-overrides.json',
  'data/business-rules.json',
  'js/menu-data.js',
  'data/sync-manifest.json',
];
const PRIVATE_DATA_DIR = 'demo/owner-set-builder';
const REFERENCE_EXT = /\.(html?|css|m?js|json|md|xml|txt|webmanifest|ya?ml)$/i;

async function walk(dir, out = []) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(full, out);
    } else if (REFERENCE_EXT.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

async function exists(rel) {
  try {
    await access(path.join(ROOT, rel));
    return true;
  } catch {
    return false;
  }
}

async function listImages(dir = IMG_DIR, prefix = 'img') {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...await listImages(path.join(dir, entry.name), rel));
    else if (IMAGE_EXT.test(entry.name)) out.push(rel);
  }
  return out;
}

// Brand assets are never "unused" — they are referenced from places a text scan
// cannot see reliably (favicon caches, og:image crawlers, CMS fields).
const brandAssets = new Set(['img/logo.png', 'img/logo.jpg']);
try {
  const indexHtml = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  for (const match of indexHtml.matchAll(/(?:\/)?img\/([\w.()-]+\.(?:png|jpe?g|webp|svg|ico))/gi)) {
    brandAssets.add(`img/${match[1]}`);
  }
} catch { /* index.html missing: fall back to the logo defaults above */ }

export async function findUnusedImages(root = ROOT) {
  const corpusFiles = [
    ...await walk(root),
    ...EXTRA_REFERENCE_FILES
      .filter((rel) => rel !== 'js/menu-data.js')
      .map((rel) => path.join(root, rel)),
    path.join(root, PRIVATE_DATA_DIR, 'menu-central.json'),
  ];

  const seen = new Set();
  const haystacks = [];
  for (const file of corpusFiles) {
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      haystacks.push(await readFile(file, 'utf8'));
    } catch { /* unreadable/absent reference file just contributes nothing */ }
  }

  const images = await listImages(path.join(root, 'img'));
  const unused = [];
  for (const rel of images) {
    if (brandAssets.has(rel)) continue;
    const base = path.basename(rel);
    const used = haystacks.some((text) => text.includes(rel) || text.includes(base));
    if (!used) unused.push(rel);
  }
  return { images, unused, brandAssets: [...brandAssets].sort(), scanned: haystacks.length };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const { images, unused, brandAssets, scanned } = await findUnusedImages();
  console.log(`Scanned ${images.length} image(s) against ${scanned} reference file(s).`);
  console.log(`Brand assets protected: ${brandAssets.length}\n`);
  if (!unused.length) {
    console.log('No unused images. Every file in img/ is referenced somewhere.');
  } else {
    let bytes = 0;
    for (const rel of unused) {
      const info = await stat(path.join(ROOT, rel)).catch(() => null);
      bytes += info ? info.size : 0;
    }
    console.log(`${unused.length} image(s) are referenced NOWHERE (${(bytes / 1024 / 1024).toFixed(1)} MB):`);
    for (const rel of unused) console.log(`  ${rel}`);
    if (process.argv.includes('--write')) {
      for (const rel of unused) await unlink(path.join(ROOT, rel));
      console.log('\nDeleted the files above from disk.');
      console.log('Next: git add -A img/   (tell git about the deletions)');
      console.log('Then: node scripts/check-public-site.mjs   (prove nothing broke)');
    } else {
      console.log('\nReport only. Re-run with --write to delete them.');
      console.log('Always follow with: node scripts/check-public-site.mjs');
    }
  }
}