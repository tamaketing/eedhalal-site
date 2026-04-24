import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const imageDir = path.resolve(rootDir, 'img');

const host = process.env.HOST;
const urlHost = host || 'localhost';
const port = Number(process.env.PORT || 5500);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function sanitizeUploadFilename(rawFilename) {
  const baseName = path.basename(String(rawFilename || '').trim());
  const sanitized = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = path.extname(sanitized).toLowerCase();

  if (!sanitized || !ext || !['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
    return '';
  }

  return sanitized;
}

async function resolveFilePath(urlPathname) {
  const decodedPath = decodeURIComponent(urlPathname);
  const normalizedPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const absolute = path.resolve(rootDir, `.${normalizedPath}`);

  if (!absolute.startsWith(rootDir)) {
    return null;
  }

  try {
    const fileStat = await stat(absolute);
    if (fileStat.isFile()) return absolute;
  } catch (_error) {
    // Try html fallback below.
  }

  if (!path.extname(absolute)) {
    const htmlFallback = `${absolute}.html`;
    try {
      const fileStat = await stat(htmlFallback);
      if (fileStat.isFile()) return htmlFallback;
    } catch (_error) {
      return null;
    }
  }

  return null;
}

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${urlHost}:${port}`);

    // Handle Image Upload (Local only)
    if (req.method === 'POST' && requestUrl.pathname === '/upload') {
      const filename = sanitizeUploadFilename(req.headers['x-filename']);
      if (!filename) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Invalid X-Filename header');
        return;
      }

      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Empty upload body');
        return;
      }

      const targetPath = path.resolve(imageDir, filename);
      if (!targetPath.startsWith(imageDir)) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Invalid upload path');
        return;
      }

      await writeFile(targetPath, buffer);
      console.log(`[Upload] Saved: img/${filename}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: `img/${filename}` }));
      return;
    }

    const filePath = await resolveFilePath(requestUrl.pathname);
    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const content = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': getContentType(filePath),
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  } catch (error) {
    console.error('[Server Error]', error);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
});

server.listen(port, host, () => {
  console.log(`Static preview server running at http://${urlHost}:${port}/`);
});
