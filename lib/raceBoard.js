// The Island Race board: a loop of tiles round the island, starting and finishing at the campfire, with one
// fork: the long way round by the beach (past the koi pond), or a shortcut through the woods (3 tiles shorter,
// with a nap cloud and a mud slide, but also the love tree). The same board is sent to the page, which draws it; positions are in island units
// (the race island has a radius of 12).
//
// tiles: [{ id, type, x, z, next: [ids] }]: a fork has two next tiles (0 = the beach, 1 = the woods); the last
// tile's next is [] (step past it and you've finished).
export const RING = 34, FORK = 5, REJOIN = 17;
const RING_TYPES = [
  'start', 'plain', 'item', 'plain', 'plain', 'fork', 'plain', 'launch', 'plain', 'item', 'plain', 'slide',
  'koi', 'plain', 'swap', 'plain', 'item', 'plain', 'plain', 'launch', 'plain', 'slide', 'plain', 'item',
  'plain', 'plain', 'swap', 'plain', 'item', 'plain', 'slide', 'plain', 'plain', 'plain',
];
const SHORT_TYPES = ['plain', 'nap', 'plain', 'item', 'slide', 'plain', 'tree', 'plain'];
export const LAUNCH_AHEAD = 5, KOI_RIDE = 4;

function build() {
  const tiles = [], r = 8.4;
  // the ring: start at the front of the island (towards the camera), going anticlockwise as seen from above
  for (let i = 0; i < RING; i++) {
    const a = Math.PI / 2 - (i / RING) * Math.PI * 2, w = 1 + 0.06 * Math.sin(i * 0.9) + 0.04 * Math.sin(i * 2.3);
    tiles.push({ id: i, type: RING_TYPES[i], x: +(Math.cos(a) * r * w).toFixed(3), z: +(Math.sin(a) * r * w).toFixed(3), next: i < RING - 1 ? [i + 1] : [] });
  }
  // the woods shortcut: a curve through the middle of the island from the fork to where it rejoins
  const A = tiles[FORK], B = tiles[REJOIN], cx = (A.x + B.x) * 0.18, cz = (A.z + B.z) * 0.18, n = SHORT_TYPES.length;
  for (let k = 0; k < n; k++) {
    const t = (k + 1) / (n + 1), u = 1 - t;
    tiles.push({
      id: RING + k, type: SHORT_TYPES[k], zone: 'woods',
      x: +(u * u * A.x + 2 * u * t * cx + t * t * B.x).toFixed(3), z: +(u * u * A.z + 2 * u * t * cz + t * t * B.z).toFixed(3),
      next: [k < n - 1 ? RING + k + 1 : REJOIN],
    });
  }
  tiles[FORK].next = [FORK + 1, RING];
  // the beach is the stretch of ring the shortcut skips
  for (let i = FORK + 1; i < REJOIN; i++) tiles[i].zone = 'beach';
  return tiles;
}
export const TILES = build();
export const byId = (id) => TILES[id];

// tiles to go until the finish, taking the shorter way at the fork
export const DIST = (() => {
  const d = new Array(TILES.length).fill(Infinity);
  const go = (id) => {
    if (d[id] !== Infinity) return d[id];
    const t = TILES[id];
    d[id] = t.next.length ? 1 + Math.min(...t.next.map(go)) : 1;
    return d[id];
  };
  TILES.forEach((t) => go(t.id));
  return d;
})();

// where a launch pad sends you: a few tiles ahead along the main path
export function launchTarget(id, n = LAUNCH_AHEAD) {
  let at = id;
  for (let i = 0; i < n && TILES[at].next.length; i++) at = TILES[at].next[0];
  return at;
}
// tiles a few steps ahead, one at a time, never onto the last tile (a love-tree hop can't win you the race)
export function hopsAhead(id, n) {
  const out = [];
  let at = id;
  for (let i = 0; i < n; i++) {
    const nx = TILES[at].next[0];
    if (nx == null || !TILES[nx].next.length) break;
    at = nx; out.push(at);
  }
  return out;
}
