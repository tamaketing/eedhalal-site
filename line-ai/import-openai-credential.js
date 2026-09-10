const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const apiKey = process.env.OPENAI_API_KEY;
const projectId = process.env.N8N_PROJECT_ID;
const credentialName = process.env.OPENAI_CREDENTIAL_NAME;
const tempDirectory = process.env.OPENCODE_TEMP;
const n8nCommand = process.env.N8N_CLI_PATH;

if (!apiKey) throw new Error('OPENAI_API_KEY is required.');
if (!projectId || !credentialName || !tempDirectory || !n8nCommand) throw new Error('N8N_PROJECT_ID, OPENAI_CREDENTIAL_NAME, OPENCODE_TEMP, and N8N_CLI_PATH are required.');
if (!fs.existsSync(tempDirectory)) throw new Error(`Temporary directory does not exist: ${tempDirectory}`);
if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new Error('N8N_PROJECT_ID contains unsupported characters.');

async function importCredential() {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`OpenAI rejected the API key (${response.status}).`);
  }

  const credentialId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const inputPath = path.join(tempDirectory, `openai-credential-${credentialId}.json`);
  const payload = [{
    id: credentialId,
    name: credentialName,
    type: 'openAiApi',
    data: {
      apiKey,
      organizationId: '',
      url: 'https://api.openai.com/v1',
      header: false,
    },
  }];

  try {
    fs.writeFileSync(inputPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    const command = `"${n8nCommand}" import:credentials --input="${inputPath}" --projectId="${projectId}"`;
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0 || !/Successfully imported 1 credential/.test(result.stdout || '')) {
      throw new Error((result.stderr || result.stdout || 'Credential import failed.').trim());
    }
    console.log(JSON.stringify({ credentialId, credentialName, validated: true }));
  } finally {
    if (fs.existsSync(inputPath)) {
      fs.writeFileSync(inputPath, '');
      fs.unlinkSync(inputPath);
    }
  }
}

importCredential().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
