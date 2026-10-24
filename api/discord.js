// bud's Discord endpoint. Discord sends every slash command and button click here
// (Interactions Endpoint URL: https://bud.oqw.one/api/discord).
import {
  isValidRequest, discordApi, InteractionType, ResponseType, EPHEMERAL,
  SITE_URL, WELCOME_CHANNEL_ID, linkButton, button, row,
} from '../lib/discord.js';

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
