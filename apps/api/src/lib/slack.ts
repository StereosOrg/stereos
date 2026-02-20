const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? '';

export async function notifyNewSignup(email: string) {
  if (!SLACK_BOT_TOKEN) return;

  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({
      channel: 'chatter',
      text: `<@U0928RQADTP> new signup: ${email}`,
    }),
  }).catch(() => {});
}
