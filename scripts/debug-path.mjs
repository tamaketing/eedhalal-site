import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const scriptPath = fileURLToPath(import.meta.url);
console.log('scriptPath:', scriptPath);
console.log('import.meta.url:', import.meta.url);
const ROOT = path.resolve(path.dirname(scriptPath), '..');
const TEST_DIR = path.join(ROOT, 'test');
console.log('ROOT:', ROOT);
console.log('TEST_DIR:', TEST_DIR);
console.log('Exists admin-logic:', fs.existsSync(path.join(TEST_DIR, 'admin-logic.test.mjs')));
console.log('cwd:', process.cwd());