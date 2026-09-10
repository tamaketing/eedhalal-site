const crypto = require('crypto');

const text = process.argv.slice(2).join(' ') || '80 กล่องส่งเขตวัฒนา ส่งฟรีไหม';
const userId = `U${crypto.randomBytes(16).toString('hex')}`;
const webhookUrl = process.env.LINE_GATEWAY_URL;
const channelSecret = process.env.LINE_CHANNEL_SECRET;

if (!webhookUrl || !channelSecret) throw new Error('LINE_GATEWAY_URL and LINE_CHANNEL_SECRET are required.');

async function run() {
  const startedAt = Date.now();
  const payload = JSON.stringify({
    events: [{
      type: 'message',
      replyToken: 'test-reply-token',
      source: { type: 'user', userId },
      timestamp: Date.now(),
      mode: 'active',
      message: { id: `test-${Date.now()}`, type: 'text', text },
    }],
  });
  const signature = crypto.createHmac('sha256', channelSecret).update(payload).digest('base64');
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Line-Signature': signature },
    body: payload,
  });
  console.log(JSON.stringify({ status: response.status, durationMs: Date.now() - startedAt }));
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
