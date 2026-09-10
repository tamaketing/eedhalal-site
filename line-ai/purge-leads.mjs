import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const directory = process.env.LEADS_DIR;
const retentionDays = Number(process.env.LEAD_RETENTION_DAYS);
const requestedUserId = process.argv[2] === '--user-id' ? process.argv[3] : '';

if (!directory) throw new Error('LEADS_DIR is required.');
if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error('LEAD_RETENTION_DAYS must be a positive integer.');
if (requestedUserId && !/^U[a-zA-Z0-9_-]{8,}$/.test(requestedUserId)) throw new Error('Invalid LINE user ID.');

const entries = await readdir(directory, { withFileTypes: true });
const cutoff = Date.now() - retentionDays * 86400000;
const deleted = [];

for (const entry of entries) {
  if (!entry.isFile() || !/^U[a-zA-Z0-9_-]+\.json$/.test(entry.name)) continue;
  const userId = entry.name.slice(0, -5);
  if (requestedUserId && userId !== requestedUserId) continue;
  const file = path.join(directory, entry.name);
  if (requestedUserId) {
    await rm(file);
    deleted.push(userId);
    continue;
  }
  let lastActivity = 0;
  try {
    const lead = JSON.parse(await readFile(file, 'utf8'));
    lastActivity = Date.parse(lead.lastTs || lead.updatedAt || '') || (await stat(file)).mtimeMs;
  } catch {
    lastActivity = (await stat(file)).mtimeMs;
  }
  if (lastActivity < cutoff) {
    await rm(file);
    deleted.push(userId);
  }
}

console.log(JSON.stringify({ deleted: deleted.length, retentionDays, targeted: Boolean(requestedUserId) }));
