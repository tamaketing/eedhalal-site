import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const host = process.env.HOST;
const urlHost = host || 'localhost';
const port = Number(process.env.PORT || 5500);
const apiProxyTarget = (process.env.API_PROXY_TARGET || 'http://127.0.0.1:80').replace(/\/$/, '');

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

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

async function proxyApiRequest(req, res, requestUrl) {
  const upstreamUrl = `${apiProxyTarget}${requestUrl.pathname}${requestUrl.search}`;
  const headers = {};

  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'host' || lowerKey === 'connection' || lowerKey === 'content-length') {
      continue;
    }
    headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }

  const method = req.method || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readRequestBody(req);

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method,
      headers,
      body
    });
  } catch (_error) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      ok: false,
      message: 'backend_unreachable',
      hint: 'Backend API is unavailable. Start npm run backend:dev and reload.'
    }));
    return;
  }

  const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
  const responseHeaders = {};

  upstreamResponse.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'connection' || lowerKey === 'transfer-encoding' || lowerKey === 'content-length') {
      return;
    }
    responseHeaders[key] = value;
  });

  responseHeaders['Cache-Control'] = 'no-store';
  res.writeHead(upstreamResponse.status, responseHeaders);
  res.end(responseBody);
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

    if (requestUrl.pathname.startsWith('/api/')) {
      await proxyApiRequest(req, res, requestUrl);
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
  } catch (_error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
});

server.listen(port, host, () => {
  console.log(`Public server running at http://${urlHost}:${port}/`);
});
