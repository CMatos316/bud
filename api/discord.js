// bud's Discord endpoint. Discord sends every slash command and button click here
// (Interactions Endpoint URL: https://bud.oqw.one/api/discord).
import { waitUntil } from '@vercel/functions';
import {
  isValidRequest, discordApi, InteractionType, ResponseType, EPHEMERAL,
  SITE_URL, WELCOME_CHANNEL_ID, APP_ID, linkButton, button, row,
} from '../lib/discord.js';
import { sendQuestions, handleQuestionInteraction } from '../lib/questions.js';

const json = (data, status = 200) => Response.json(data, { status });

// A private reply only the person who clicked or typed can see.
const privately = (content, components) => json({
  type: ResponseType.CHANNEL_MESSAGE,
  data: { content, flags: EPHEMERAL, ...(components ? { components } : {}) },
});

const HELLOS = [
  'hi! I’m bud.',
  'oh hey! I’m bud.',
  'hello hello. I’m bud.',
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export async function POST(request) {
  const raw = await request.text();
  const ok = isValidRequest(raw, request.headers.get('x-signature-ed25519'), request.headers.get('x-signature-timestamp'));
  if (!ok) return new Response('invalid request signature', { status: 401 });

  const interaction = JSON.parse(raw);

  // Discord checks the endpoint with a PING when you save the URL, and now and then after.
  if (interaction.type === InteractionType.PING) return json({ type: ResponseType.PONG });

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const name = interaction.data?.name;

    if (name === 'bud') {
      return privately(
        `${pick(HELLOS)} Let’s make you a buddy of your own: shape it, paint it, and it’ll pick its own name.`,
        [row(linkButton('Make your bud', SITE_URL))],
      );
    }

    if (name === 'bud-nudge') {
      // DMs take a moment each, so answer "thinking…" now and fill in the result when it's done.
      waitUntil((async () => {
        let content;
        try {
          const r = await sendQuestions({ force: true });
          content = r.due === 0
            ? 'Nobody’s due a question right now (brand-new buds, questions turned off, or a few ignored in a row).'
            : `Sent ${r.sent} ${r.sent === 1 ? 'question' : 'questions'}. `
              + (r.skipped ? `Skipped ${r.skipped} (DMs off or not in the server anymore).` : '');
        } catch (err) {
          console.error(err);
          content = 'Something went wrong sending the nudges. Check the Vercel logs.';
        }
        await discordApi(`/webhooks/${APP_ID}/${interaction.token}/messages/@original`, { method: 'PATCH', body: { content } }).catch(console.error);
      })());
      return json({ type: ResponseType.DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } });
    }

    if (name === 'bud-setup') {
      try {
        await discordApi(`/channels/${WELCOME_CHANNEL_ID}/messages`, {
          method: 'POST',
          body: {
            content: '**Meet bud.**\nMake your own little buddy: draw its shape, pick its eyes, paint it, and it’ll name itself. '
              + 'Then it’ll help you find people here who are into the same things you are.',
            components: [row(button('Make your bud', 'make_bud'))],
          },
        });
        return privately(`Posted the button in <#${WELCOME_CHANNEL_ID}>.`);
      } catch (err) {
        console.error(err);
        return privately('I couldn’t post in #welcome. Check that I can send messages there.');
      }
    }
  }

  // bud's DM questions: quick answers, "own words" text box, stop asking
  const cid = interaction.data?.custom_id || '';
  if ((interaction.type === InteractionType.MESSAGE_COMPONENT || interaction.type === InteractionType.MODAL_SUBMIT) && cid.startsWith('q:')) {
    try { return json(await handleQuestionInteraction(interaction, waitUntil)); }
    catch (err) { console.error(err); return privately('hm, something went wrong. try again in a bit?'); }
  }

  if (interaction.type === InteractionType.MESSAGE_COMPONENT && interaction.data?.custom_id === 'make_bud') {
    // Later this becomes a one-time personal link that signs them in. For now it opens the maker.
    return privately(
      `${pick(HELLOS)} Here’s your way in. Only you can see this.`,
      [row(linkButton('Open bud', SITE_URL))],
    );
  }

  return privately('I don’t know that one yet.');
}

export function GET() {
  return new Response('bud is listening. (Discord sends POST requests here.)', { headers: { 'content-type': 'text/plain' } });
}
