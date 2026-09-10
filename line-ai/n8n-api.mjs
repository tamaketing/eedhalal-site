const baseUrl = (process.env.N8N_BASE_URL || '').replace(/\/$/, '');
const apiKey = process.env.N8N_API_KEY || '';

export function requireN8nApiConfig() {
  if (!baseUrl) throw new Error('N8N_BASE_URL is required.');
  if (!apiKey) throw new Error('N8N_API_KEY is required.');
}

export async function n8nApi(path, options = {}) {
  requireN8nApiConfig();
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...options,
    headers: {
      'x-n8n-api-key': apiKey,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`n8n API ${options.method || 'GET'} ${path} failed (${response.status}).`);
  return response.status === 204 ? null : response.json();
}
