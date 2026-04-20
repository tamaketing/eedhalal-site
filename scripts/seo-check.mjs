import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const BASE_URL = 'https://eedhalal.com';

const PAGES = [
  'index.html',
  'popular-menu.html',
  'order-steps.html',
  'corporate.html',
  'contact.html',
  'delivery.html',
  'delivery-area.html',
  'delivery-terms.html',
  'faq.html',
  'catering.html',
  'buffet-menu.html',
  'hospital-orders.html'
];

function extractFirst(pattern, input) {
  const match = input.match(pattern);
  return match ? match[1].trim() : '';
}

function has(pattern, input) {
  return pattern.test(input);
}

async function checkPage(file, titles, descriptions) {
  const content = await readFile(path.join(rootDir, file), 'utf8');
  const title = extractFirst(/<title>([\s\S]*?)<\/title>/i, content);
  const description = extractFirst(/<meta\s+name="description"\s+content="([\s\S]*?)">/i, content);
  const canonical = extractFirst(/<link\s+rel="canonical"\s+href="([\s\S]*?)">/i, content);

  const errors = [];
  if (!title) errors.push('missing_title');
  if (!description) errors.push('missing_description');
  if (!canonical) errors.push('missing_canonical');
  if (canonical && !canonical.startsWith(BASE_URL)) errors.push('canonical_not_absolute');
  if (!has(/<meta\s+property="og:title"/i, content)) errors.push('missing_og_title');
  if (!has(/<meta\s+property="og:description"/i, content)) errors.push('missing_og_description');
  if (!has(/<meta\s+name="twitter:card"/i, content)) errors.push('missing_twitter_card');

  if (title) {
    const prev = titles.get(title) || [];
    prev.push(file);
    titles.set(title, prev);
  }

  if (description) {
    const prev = descriptions.get(description) || [];
    prev.push(file);
    descriptions.set(description, prev);
  }

  return errors;
}

async function run() {
  const titles = new Map();
  const descriptions = new Map();
  let hasErrors = false;

  for (const file of PAGES) {
    const errors = await checkPage(file, titles, descriptions);
    if (errors.length > 0) {
      hasErrors = true;
      console.error(`${file}: ${errors.join(', ')}`);
    }
  }

  for (const [title, files] of titles.entries()) {
    if (files.length > 1) {
      hasErrors = true;
      console.error(`duplicate_title: ${JSON.stringify(title)} in ${files.join(', ')}`);
    }
  }

  for (const [description, files] of descriptions.entries()) {
    if (files.length > 1) {
      hasErrors = true;
      console.error(`duplicate_description: ${JSON.stringify(description)} in ${files.join(', ')}`);
    }
  }

  const robots = await readFile(path.join(rootDir, 'robots.txt'), 'utf8').catch(() => '');
  const sitemap = await readFile(path.join(rootDir, 'sitemap.xml'), 'utf8').catch(() => '');
  const llms = await readFile(path.join(rootDir, 'llms.txt'), 'utf8').catch(() => '');
  if (!robots.includes('Sitemap: https://eedhalal.com/sitemap.xml')) {
    hasErrors = true;
    console.error('robots.txt missing sitemap pointer');
  }
  if (!sitemap.includes('<urlset')) {
    hasErrors = true;
    console.error('sitemap.xml missing urlset');
  }
  if (!llms.includes('# EED HALAL')) {
    hasErrors = true;
    console.error('llms.txt invalid content');
  }

  if (hasErrors) {
    process.exitCode = 1;
    return;
  }
  console.log('seo:check passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
