// Put the solved days in order (an easy first day, pars that go up and down, different things from one day to the
// next) and write lib/fortDays.js. The builders' answers stay here, in answers.json: they don't go in the repo.
import fs from 'node:fs';
const all = fs.readFileSync('days_all.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const pattern = [3, 3, 4, 3, 4, 5, 4, 3, 4, 6, 3, 4, 5, 4, 3, 4, 6, 3, 4, 5, 4, 3, 4, 6, 5, 4, 3, 4, 6, 5, 4, 3, 4, 3, 4, 3, 4];
const left = new Map(all.map((d) => [d.seed, d])), out = [];
const take = (d) => { left.delete(d.seed); out.push(d); };
take(left.get(3) || [...left.values()].find((d) => d.par === 3) || [...left.values()][0]);   // day 1 is a gentle one (seed 3: cheese, a duck and a piano; three pieces does it)
while (left.size) {
  const want = pattern[out.length % pattern.length], prev = new Set(out[out.length - 1].shots.map((s) => s.what));
  const pool = [...left.values()], same = pool.filter((d) => d.par === want);
  const from = same.length ? same : pool.sort((a, b) => Math.abs(a.par - want) - Math.abs(b.par - want)).slice(0, 4);
  from.sort((a, b) => a.shots.filter((s) => prev.has(s.what)).length - b.shots.filter((s) => prev.has(s.what)).length || (a.bud.x === out[out.length - 1].bud.x) - (b.bud.x === out[out.length - 1].bud.x) || a.seed - b.seed);
  take(from[0]);
}
const line = (d) => `  { bud: ${JSON.stringify(d.bud)}, given: ${JSON.stringify(d.given)}, pile: ${JSON.stringify(d.pile)}, shots: ${JSON.stringify(d.shots)}, par: ${d.par} },`
  .replace(/"(\w+)":/g, '$1: ').replace(/"/g, "'").replace(/,(?=\w)/g, ', ').replace(/\{(?=\w)/g, '{ ').replace(/(?<=[\w'\]])\}/g, ' }');
const file = `// Hold the Fort: the days, in order (lib/fort.js hands out one a day and starts again after the last).
// Made and test-solved by machine: every day here has a fort that holds, built from that day's pile, and "par"
// is how few pieces the solver managed (the page calls it the island's builders' best). It isn't proven to be
// the fewest possible, so a player can beat it.
// bud: where it naps (a square on the 14 x 10 plot). given: what's already there (its napping rock).
// pile: how many of each piece you get. shots: what's flung, in order (angle in degrees, power 0 to 1).
export const DAYS = [
${out.map(line).join('\n')}
];
`;
fs.writeFileSync(new URL('../../lib/fortDays.js', import.meta.url), file);
fs.writeFileSync('answers.json', JSON.stringify(out.map((d, i) => ({ day: i + 1, seed: d.seed, par: d.par, sol: d.sol })), null, 1));
console.log(out.map((d, i) => `${i + 1}:${d.par}${d.shots.map((s) => s.what[0]).join('')}`).join(' '));
