import test from 'node:test';
import { checkBusinessSync } from '../scripts/check-business-sync.mjs';

test('every business fact is present in all registered files (edit ALL files on change)', async () => {
  await checkBusinessSync();
});
