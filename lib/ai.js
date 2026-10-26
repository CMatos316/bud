// Talking to Claude (Haiku: fast and inexpensive) with a forced tool reply, so answers come back structured.
export const MODEL = 'claude-haiku-5-5';
const API = 'https://api.anthropic.com/v1/messages';

export async function callClaude({ system, messages, tool, maxTokens }) {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) { const e = new Error('ANTHROPIC_API_KEY is not set'); e.code = 'no-key'; throw e; }
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: maxTokens, system, messages,
      tools: [tool], tool_choice: { type: 'tool', name: tool.name },
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${JSON.stringify(data)?.slice(0, 300)}`);
  const use = data.content?.find((c) => c.type === 'tool_use' && c.name === tool.name);
  if (!use) throw new Error('Claude did not call the tool');
  return use.input;
}

export const tidy = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
