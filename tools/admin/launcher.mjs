// Run only from the owner's local .cmd file; never install as a service.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4185;
const HOST = '127.0.0.1';
const PAGE_URL = `http://${HOST}:${PORT}/`;
const ID = 'owner-set-builder';
const ASSETS = ['/readiness', '/', '/style.css', '/app.mjs', '/sellable-menus', '/budget-planner.html', '/cost-planner.css', '/menu-central-ui.mjs', '/menu-central', '/menu-publish-state'];

function portOccupied() {
  return new Promise((resolve) => {
    const connection = createConnection({ host: HOST, port: PORT });
    let done = false;
    function settle(result) {
      if (done) return;
      done = true;
      connection.destroy();
      resolve(result);
    }
    connection.once('connect', () => settle(true));
    connection.once('error', (error) => settle(error.code !== 'ECONNREFUSED'));
    connection.setTimeout(700, () => settle(true));
  });
}

async function ready() {
  try {
    for (const resource of ASSETS) {
      const response = await fetch(new URL(resource, PAGE_URL), { signal: AbortSignal.timeout(1000), cache: 'no-store' });
      if (response.status !== 200 || response.headers.get('x-eed-local-tool') !== ID) return false;
      if (resource === '/') {
        if (!(await response.text()).includes('id="budget"')) return false;
      } else if (resource === '/readiness') {
        // Instance guard: a bare 200 is not enough — the responder must identify
        // as this tool, otherwise it is ignored (never reused, never stopped).
        const body = await response.json().catch(() => null);
        if (body?.ready !== true || body?.app !== ID) return false;
      } else if (resource === '/sellable-menus') {
        // Shape guard: current data carries a menus array. An older server
        // answering 200 with a previous schema must not be reused with new data.
        const body = await response.json().catch(() => null);
        if (!body || !Array.isArray(body.menus)) return false;
      } else {
        await response.body?.cancel();
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function waitUntilReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await ready()) return true;
    await new Promise((resolve) => setTimeout(resolve, 180));
  } while (Date.now() < deadline);
  return false;
}

function openBrowser() {
  const chromePaths = [
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  const chrome = chromePaths.find(existsSync);
  const browser = chrome
    ? spawn(chrome, [PAGE_URL], { cwd: HERE, detached: true, stdio: 'ignore' })
    : spawn('rundll32.exe', ['url.dll,FileProtocolHandler', PAGE_URL], { cwd: HERE, detached: true, stdio: 'ignore' });
  browser.on('error', () => console.error(`เปิดเบราว์เซอร์ไม่สำเร็จ กรุณาเปิด ${PAGE_URL} เอง`));
  browser.unref();
}

if (await portOccupied()) {
  if (!(await waitUntilReady(2000))) {
    console.error(`พอร์ต ${PORT} ถูกโปรแกรมอื่นใช้อยู่ และไม่ใช่เครื่องมือจัดชุดอาหารที่พร้อมใช้งาน — ไม่หยุดโปรแกรมนั้น กรุณาปิดโปรแกรมที่ใช้พอร์ตนี้แล้วดับเบิลคลิกไอคอนใหม่`);
    process.exitCode = 1;
  } else {
    console.log(`เดโมเปิดอยู่แล้ว: ${PAGE_URL} (ใช้ process เดิม)`);
    openBrowser();
  }
} else {
  const server = spawn(process.execPath, [path.join(HERE, 'server.mjs'), String(PORT)], { cwd: HERE, stdio: 'inherit' });
  let exited = false;
  server.once('error', (error) => { exited = true; console.error(`เริ่มเดโมไม่สำเร็จ: ${error.message}`); });
  server.once('exit', () => { exited = true; });
  const started = await waitUntilReady(10000);
  if (!started) {
    if (!exited) server.kill(); // Only this launcher's own child; never another port owner.
    console.error(`เซิร์ฟเวอร์เดโมไม่พร้อมที่ ${PAGE_URL} — ไม่เปิดหน้าเปล่า`);
    process.exitCode = 1;
  } else {
    console.log(`เดโมพร้อมแล้ว: ${PAGE_URL}`);
    console.log('ปิดหน้าต่างนี้แล้วเครื่องมือจะหยุด');
    openBrowser();
    // Keep this window and its attached server alive until the owner closes it.
    await new Promise((resolve) => server.once('exit', resolve));
  }
}
