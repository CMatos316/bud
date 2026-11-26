export const GUILD_ID = 'G', SITE_URL = 'https://bud.oqw.one';
export const sent = [];
export let dmWorks = true; export const setDm = (v) => { dmWorks = v; };
export async function sendDmImage(to, payload) { if (!dmWorks) return false; sent.push({ to, ...payload, bytes: payload.bytes.length }); return { id: 'msg' }; }
export const row = (...c) => ({ type: 1, components: c }), linkButton = (label, url) => ({ label, url });

export const BUDS_CHANNEL_ID = 'C'; export const posted = []; export let postWorks = true; export const setPost = (v) => { postWorks = v; };
export async function discordApi(path, opts = {}) { if (!postWorks) throw new Error('discord said no'); posted.push({ path, ...opts }); return { id: 'm1', mention_everyone: true }; }
