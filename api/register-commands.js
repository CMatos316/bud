// Registers bud's slash commands in the test server. Safe to run repeatedly:
// it replaces the server's bud commands with exactly the list in lib/discord.js, nothing else.
// Open https://bud.oqw.one/api/register-commands after changing COMMANDS.
import { discordApi, APP_ID, GUILD_ID, COMMANDS } from '../lib/discord.js';

export async function GET() {
  try {
    const result = await discordApi(`/applications/${APP_ID}/guilds/${GUILD_ID}/commands`, { method: 'PUT', body: COMMANDS });
    const names = result.map((c) => '/' + c.name).join(', ');
    return new Response(`Registered ${result.length} command(s): ${names}`, { headers: { 'content-type': 'text/plain' } });
  } catch (err) {
    console.error(err);
    return new Response('Could not register commands: ' + err.message, { status: 500, headers: { 'content-type': 'text/plain' } });
  }
}
