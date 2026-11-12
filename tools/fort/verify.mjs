// every day's builders' answer really holds, through the same code the server runs
import fs from 'node:fs';
import * as fort from '../../lib/fort.js';
const answers = JSON.parse(fs.readFileSync('answers.json', 'utf8'));
let bad = 0;
for (const a of answers) {
  const p = fort.puzzleFor(a.day);
  const r = fort.run(p, a.sol);
  const empty = fort.run(p, []);
  if (!r.held || r.used !== p.par || empty.held) { bad++; console.log('day', a.day, 'PROBLEM', r.held, r.used, p.par, empty.held); }
}
console.log(bad ? bad + ' problems' : `all ${answers.length} days: the builders' fort holds with par pieces, and no fort at all does not`);
