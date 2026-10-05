import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.join(ROOT, '..', 'test');
const OUTPUT_DIR = path.join(ROOT, '..', 'test', 'consolidated');

// Test file categories
const CATEGORIES = {
  unit: [
    'admin-runtime-clean.test.mjs',
    'business-facts-vat.test.mjs',
    'business-sync-manifest.test.mjs',
    'central-database.test.mjs',
    'customer-runtime.test.mjs',
    'db-contract.test.mjs',
    'inbound-messages.test.mjs',
    'line-endings.test.mjs',
    'line-human-approval.test.mjs',
    'line-operations.test.mjs',
    'line-push-provider.test.mjs',
    'menu-backups.test.mjs',
    'menu-context.test.mjs',
    'menu-intent.test.mjs',
    'order-draft.test.mjs',
    'response-examples.test.mjs',
    'response-examples-api.test.mjs',
    'response-examples-postgres.test.mjs',
    'starting-price.test.mjs',
    'system-rules.test.mjs',
    'line-human-approval.test.mjs',
    'line-operations.test.mjs',
    'line-push-provider.test.mjs',
  ],
  integration: [
    'admin-menu-ui.test.mjs',
    'inbound-api.test.mjs',
    'inbound-postgres.test.mjs',
    'internal-api.test.mjs',
    'menus-api.test.mjs',
    'menus.test.mjs',
    'menu-central-publish.test.mjs',
    'menu-deploy.test.mjs',
    'menu-intent.test.mjs',
    'order-draft.test.mjs',
    'persist-e2e.test.mjs',
    'response-examples.test.mjs',
    'response-examples-api.test.mjs',
    'response-examples-postgres.test.mjs',
    'system-rules.test.mjs',
    'workflow-b25-candidate.test.mjs',
    'workflow-b25-chain.test.mjs',
    'workflow-persist.test.mjs',
  ],
  e2e: [
    'browser-smoke.test.mjs',
    'line-push-provider.test.mjs',
    'line-operations.test.mjs',
    'start-bot.test.mjs',
    'workflow-b25-candidate.test.mjs',
    'workflow-b25-chain.test.mjs',
    'workflow-persist.test.mjs',
  ],
  contract: [
    'business-content-sync.test.mjs',
    'business-sync-manifest.test.mjs',
    'business-facts-vat.test.mjs',
    'line-endings.test.mjs',
    'starting-price.test.mjs',
    'check-line-endings.test.mjs',
    'check-public-site.test.mjs',
    'popular-menu-page.test.mjs',
    'check-public-site.test.mjs',
    'check-system.test.mjs',
    'check-repository-safety.test.mjs',
    'check-business-sync.test.mjs',
    'check-starting-price.test.mjs',
  ],
  db: [
    'inbound-postgres.test.mjs',
    'response-examples-postgres.test.mjs',
    'postgres-integration.test.mjs',
    'db-contract.test.mjs',
  ],
};

async function consolidate() {
  await Promise.all(Object.entries(CATEGORIES).map(async ([category, files]) => {
    let combinedContent = '';
    
    for (const file of files) {
      const filePath = path.join(TEST_DIR, file);
      try {
        const content = await readFile(path.join(TEST_DIR, file), 'utf8');
        // Remove the import/export statements that are specific to the original file
        // and wrap in a describe block if needed
        combinedContent += `\n// ==== ${file} ====\n${content}\n`;
      } catch (error) {
        console.warn(`Warning: Could not read ${file}: ${error.message}`);
      }
    }
    
    // Wrap in a single test file
    const outputContent = `// Consolidated ${category} tests
// Generated from ${files.length} individual test files

${combinedContent}
`;
    
    const outputPath = path.join(OUTPUT_DIR, `${category}.test.mjs`);
    await writeFile(outputPath, combinedContent, 'utf8');
    console.log(`Created ${outputPath} (${files.length} files consolidated)`);
  }));
  
  console.log('Consolidation complete!');
}

consolidate().catch(console.error);