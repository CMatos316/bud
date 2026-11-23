const here = new URL('.', import.meta.url).href;
export async function resolve(spec, ctx, next) {
  if (ctx.parentURL && ctx.parentURL.includes('/lib/') && !ctx.parentURL.includes('node_modules')) {
    if (spec === './firebase.js') return { url: here + 'fakefire.mjs', shortCircuit: true };
    if (spec === './discord.js') return { url: here + 'fakediscord.mjs', shortCircuit: true };
  }
  return next(spec, ctx);
}
