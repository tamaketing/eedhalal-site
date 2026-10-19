// A compact map of the repository, so an agent can pick the right file with one
// cheap read instead of exploring.
//
//   node tools/agent/map.mjs              whole map
//   node tools/agent/map.mjs pages        just the web pages
//   node tools/agent/map.mjs data         just the data files
//   node tools/agent/map.mjs scripts      just the scripts and services
//
// Reads only <title> from HTML and the first comment line from modules, never a
// whole file, so the output stays small enough to keep in context.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

const MAX_ONE_LINE = 80;

const lineCount = async (relative) => {
  try {
    return (await readFile(path.join(ROOT, relative), 'utf8')).split('\n').length;
  } catch {
    return 0;
  }
};

async function describe(relative) {
  try {
    const text = await readFile(path.join(ROOT, relative), 'utf8');
    if (relative.endsWith('.html')) {
      const title = text.match(/<title>([\s\S]{0,160}?)<\/title>/i)?.[1] || '';
      const description = text.match(/<meta\s+name="description"\s+content="([\s\S]{0,160}?)"/i)?.[1] || '';
      const note = description.trim() ? `${title.trim()} — ${description.trim()}` : title.trim();
      return note.length > MAX_ONE_LINE + 20 ? `${note.slice(0, MAX_ONE_LINE + 20 - 1)}…` : note;
    }
    const comment = text.split('\n').find((line) => line.trim().startsWith('//'));
    return comment ? comment.replace(/^\s*\/\/\s?/, '').slice(0, MAX_ONE_LINE) : '';
  } catch {
    return '';
  }
}

const listing = async (dir, filter = () => true) => {
  try {
    return (await readdir(path.join(ROOT, dir), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && filter(entry.name))
      .map((entry) => `${dir}/${entry.name}`)
      .sort();
  } catch {
    return [];
  }
};

const asLines = (value) => (Array.isArray(value) ? value : String(value).split(' | '));

async function table(title, files) {
  if (!files.length) return [];
  const rows = [title];
  for (const file of files) {
    const lines = await lineCount(file);
    const note = await describe(file);
    rows.push(`  ${file.replace(/^\.\//, '')} (${lines}) ${note}`.trimEnd());
  }
  return rows;
}

export async function buildMap(section = 'all') {
  const want = (name) => section === 'all' || section === name;
  const out = [];

  if (want('pages')) {
    const rootPages = await listing('.', (name) => name.endsWith('.html'));
    const enPages = await listing('en', (name) => name.endsWith('.html'));
    out.push(...(await table('หน้าเว็บภาษาไทย (ไฟล์ราก)', rootPages)));
    out.push(...(await table('หน้าเว็บภาษาอังกฤษ (en/)', enPages)));
    out.push('');
  }

  if (want('assets')) {
    const js = await listing('js', (name) => name.endsWith('.js'));
    const css = await listing('css', (name) => name.endsWith('.css') || name.endsWith('.min.css'));
    const img = await listing('img');
    out.push(`สคริปต์ฝั่งหน้าเว็บ (${js.length} ไฟล์): ${js.map((file) => file.replace('js/', '')).join(', ')}`);
    out.push(`สไตล์ชีต (${css.length} ไฟล์): ${css.map((file) => file.replace('css/', '')).join(', ')}`);
    out.push(`รูปภาพ (${img.length} ไฟล์) อยู่ใน img/`);
    out.push('');
  }

  if (want('data')) {
    const data = await listing('data');
    out.push(...(await table('ข้อมูลที่เป็นแหล่งความจริง (data/)', data)));
    out.push('');
    out.push('ข้อมูลส่วนตัวของเจ้าของ (ไม่ขึ้น Git): demo/owner-set-builder/menu-central.json');
    out.push('');
  }

  if (want('scripts')) {
    const scripts = await listing('scripts', (name) => name.endsWith('.mjs'));
    const services = await listing('services', (name) => name.endsWith('.mjs'));
    const server = await listing('server', (name) => name.endsWith('.mjs'));
    const db = await listing('db', (name) => name.endsWith('.mjs'));
    const tools = await listing('tools/agent', (name) => name.endsWith('.mjs'));
    const admin = await listing('tools/admin', (name) => name.endsWith('.mjs'));
    out.push(...(await table('เครื่องมือทีม AI (tools/agent/)', tools)));
    out.push(...(await table('สคริปต์ตรวจและซิงก์ (scripts/)', scripts)));
    out.push(...(await table('ตรรกะธุรกิจ (services/) — ชั้นเดียวที่แตะฐานข้อมูลได้', services)));
    out.push(...(await table('เซิร์ฟเวอร์ (server/)', server)));
    out.push(...(await table('ตัวเชื่อมฐานข้อมูล (db/)', db)));
    out.push(...(await table('เครื่องมือเจ้าของบนเครื่อง (tools/admin/)', admin)));
    out.push('');
  }

  if (want('tests')) {
    const tests = await listing('test', (name) => name.endsWith('.test.mjs'));
    out.push(`เทสต์ ${tests.length} ไฟล์ใน test/ · รันด้วย node --test --test-concurrency=1`);
    out.push('');
  }

  return out.join('\n').trimEnd();
}

export const MAP_SECTIONS = ['pages', 'assets', 'data', 'scripts', 'tests'];

async function main() {
  const arg = process.argv.slice(2).find((value) => !value.startsWith('-'));
  if (arg && !MAP_SECTIONS.includes(arg)) {
    process.stderr.write(`ไม่รู้จักหมวด "${arg}" — ใช้ได้: ${MAP_SECTIONS.join(', ')} หรือเว้นว่างเพื่อดูทั้งหมด\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${await buildMap(arg || 'all')}\n`);
}

if (isCli) {
  main().catch((error) => {
    process.stderr.write(`อ่านแผนที่โปรเจกต์ไม่สำเร็จ: ${error.message}\n`);
    process.exitCode = 1;
  });
}