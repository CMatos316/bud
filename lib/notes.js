// Sticky notes: a friend request you stick on someone's bud.
// Everyone on the island can see that a bud has notes on it; only the sender and the bud's owner can read them.
export const NOTE_COLORS = ['lemon', 'peach', 'mint', 'sky', 'lilac'];
export const NOTE_MAX = 120;
export const DEFAULT_NOTE = 'wanna be friends?';
// After someone says "not now", the sender can't stick another note on that bud for a while.
export const RETRY_AFTER_MS = 3 * 864e5;

const clean = (s) => String(s ?? '')
  .replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  .slice(0, NOTE_MAX);

export const isDiscordId = (v) => typeof v === 'string' && /^\d{5,25}$/.test(v);

export function validateNote(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'missing note' };
  if (!isDiscordId(input.to)) return { ok: false, error: 'who is it for?' };
  const color = NOTE_COLORS.includes(input.color) ? input.color : NOTE_COLORS[0];
  return { ok: true, to: input.to, text: clean(input.text) || DEFAULT_NOTE, color };
}
