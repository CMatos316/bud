// The island's seasons and weather, worked out from the clock: the same for everyone, at the same moment,
// with nothing stored and no server running. Used by the island page (world.html), the buds' diaries
// (lib/life.js) and the Island Times' forecast (lib/newsletter.js).
//
// The island floats in the sky, so its weather is its own: not a real place's. It keeps Massachusetts'
// calendar (winter is December to February) and is picked from smooth seeded noise over the hours, so
// spells come and go over a few hours, and a forecast for next week is simply the weather next week.

const HOUR = 3600e3;
const SEASONS = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'fall', 'fall', 'fall', 'winter'];
let etFmt = null;
// the date and hour on the island's calendar (Eastern time)
export function etParts(ms) {
  etFmt = etFmt || new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23', weekday: 'short' });
  const p = {};
  for (const { type, value } of etFmt.formatToParts(new Date(ms))) p[type] = value;
  return { y: Number(p.year), m: Number(p.month) - 1, d: Number(p.day), hour: Number(p.hour) % 24, weekday: p.weekday };
}
export const seasonAt = (ms) => SEASONS[etParts(ms).m];

// Sunrise and sunset, in clock hours, through the year (Boston's, near enough, daylight saving included).
// Indexed by month at its 15th; in between, it's eased from one to the next.
const SUN = [[7.13, 16.68], [6.73, 17.35], [7.02, 18.95], [6.15, 19.5], [5.45, 20.02], [5.12, 20.4], [5.37, 20.33], [5.9, 19.8], [6.47, 18.95], [7.03, 18.07], [6.68, 16.4], [7.1, 16.2]];
export function sunTimes(month, day) {
  const x = month + (day - 15) / 30.5, i = Math.floor(x), f = x - i;
  const a = SUN[((i % 12) + 12) % 12], b = SUN[(((i + 1) % 12) + 12) % 12];
  return { rise: a[0] + (b[0] - a[0]) * f, set: a[1] + (b[1] - a[1]) * f };
}
// The island's sky is drawn for a day with sunrise at 6:30 and sunset at about 18:36. This turns a clock hour
// into that day's hour: the day stretches or shrinks with the season, while dawn and dusk keep their pace.
export function skyHour(h, rise, set) {
  const dawn = rise - 1.5, dark = set + 2.9;
  if (h >= rise && h < set) return 6.5 + (h - rise) / (set - rise) * 12.1;
  if (h >= set && h < dark) return 18.6 + (h - set);
  if (h >= dawn && h < rise) return 5 + (h - dawn);
  const x = h < dawn ? h + 24 : h;
  return (21.5 + (x - dark) / (dawn + 24 - dark) * 7.5) % 24;
}

// smooth seeded noise over time: a value in 0..1 at every moment, drifting from one knot to the next
function hash01(n, salt) {
  let h = (Math.imul(n | 0, 0x9E3779B1) + Math.imul(salt, 0x85EBCA77)) | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B); h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise(t, period, salt) {
  const x = t / period, i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
  return hash01(i, salt) * (1 - s) + hash01(i + 1, salt) * s;
}
// how wet each season is: precipitation starts above `wet`, downpours above `heavy`
const CLIMATE = {
  winter: { wet: 0.665, heavy: 0.8, wind: 0.7, fog: 0.86 },
  spring: { wet: 0.655, heavy: 0.8, wind: 0.74, fog: 0.8 },
  summer: { wet: 0.7, heavy: 0.81, wind: 0.8, fog: 0.88 },
  fall:   { wet: 0.67, heavy: 0.81, wind: 0.7, fog: 0.8 },
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const wetAt = (t) => 0.62 * noise(t, 11, 1) + 0.38 * noise(t, 4, 2);

// The weather at a moment. Amounts are 0..1 and change smoothly from minute to minute:
// { kind, cloud, rain, snow, storm, fog, wind, rainbow, season }
// kind is the word for it: clear, cloudy, rain, storm, snow, blizzard, fog or windy.
export function weatherAt(ms) {
  const t = ms / HOUR, season = seasonAt(ms), c = CLIMATE[season], et = etParts(ms);
  const wet = wetAt(t);
  const fall = clamp01((wet - c.wet) / 0.06);                 // how hard it's coming down
  const heavy = clamp01((wet - c.heavy) / 0.05);
  const cloud = clamp01(Math.max((wet - 0.5) / 0.14, noise(t, 7, 3) * 0.9 - 0.2));
  const cold = season === 'winter';
  const rain = cold ? 0 : fall, snow = cold ? fall : 0;
  const storm = cold ? 0 : heavy * (season === 'summer' || season === 'spring' ? 1 : 0.5);
  const wind = clamp01((noise(t, 6, 4) - c.wind) / 0.18 + heavy * 0.6);
  // fog on some mornings: in by dawn, gone by mid-morning
  const morning = et.hour >= 4 && et.hour < 10 ? Math.sin((et.hour - 4 + (ms % HOUR) / HOUR) / 6 * Math.PI) : 0;
  const fog = clamp01((noise(Math.floor(t / 24), 1, 5) - c.fog) / 0.08) * morning * (1 - fall * 0.7);
  // a rainbow: in the day, in the couple of hours after rain, most of the time
  let rainbow = 0;
  if (!cold && fall < 0.05 && et.hour >= 7 && et.hour < 19 && hash01(Math.floor(t / 6), 6) < 0.7) {
    for (let back = 0.25; back <= 2; back += 0.25) {
      if (wetAt(t - back) > c.wet + 0.03) { rainbow = clamp01(1.15 - back / 2) * (1 - cloud * 0.3); break; }
    }
  }
  const kind = snow > 0.3 ? (heavy > 0.5 ? 'blizzard' : 'snow') : rain > 0.3 ? (storm > 0.5 ? 'storm' : 'rain')
    : fog > 0.4 ? 'fog' : wind > 0.5 ? 'windy' : cloud > 0.55 ? 'cloudy' : 'clear';
  return { kind, cloud, rain, snow, storm, fog, wind, rainbow, season };
}

// How wet the ground is: puddles stay a while after the rain stops.
export function groundWetAt(ms) {
  let w = 0;
  for (let k = 0; k <= 4; k++) w = Math.max(w, weatherAt(ms - k * 0.75 * HOUR).rain * (1 - k * 0.2));
  return w;
}

// Snow on the ground: from the first snowfall of the winter (on or after Dec 1) until it melts in early March.
const firstSnowCache = new Map();
export function firstSnow(winterYear) {
  if (firstSnowCache.has(winterYear)) return firstSnowCache.get(winterYear);
  // midnight Eastern on Dec 1 (05:00 UTC), then hour by hour until it snows properly
  let ms = Date.UTC(winterYear, 11, 1, 5), found = null;
  for (let i = 0; i < 24 * 75 && found == null; i++, ms += HOUR) if (weatherAt(ms).snow > 0.6) found = ms;
  firstSnowCache.set(winterYear, found);
  return found;
}
export function snowCoverAt(ms) {
  const { y, m, d } = etParts(ms);
  if (m === 11 || m <= 2) {
    const winterYear = m === 11 ? y : y - 1, first = firstSnow(winterYear);
    if (first == null || ms < first) return 0;
    const settled = clamp01((ms - first) / (5 * HOUR));
    if (m === 2) return settled * clamp01(1 - (d - 1) / 14);   // melting through the first two weeks of March
    return settled;
  }
  return 0;
}

// Words and an icon for a kind of weather (the Island Times' forecast, the buds' diaries).
export const WEATHER_WORDS = {
  clear: ['☀️', 'sunny'], cloudy: ['☁️', 'cloudy'], rain: ['🌧️', 'rain'], showers: ['🌦️', 'showers'], storm: ['⛈️', 'storms'], snow: ['🌨️', 'snow'],
  flurries: ['🌨️', 'flurries'], blizzard: ['❄️', 'blizzard'], fog: ['🌫️', 'foggy morning'], windy: ['🍃', 'windy'],
};
// The weather of an Eastern-time day, for a forecast: a few hours of rain is "showers", most of the day is "rain".
export function dayWeather(y, m, d) {
  const start = Date.UTC(y, m, d, 5), seen = {};
  for (let h = 7; h <= 21; h++) { const w = weatherAt(start + h * HOUR); seen[w.kind] = (seen[w.kind] || 0) + 1; }
  const n = (...k) => k.reduce((a, x) => a + (seen[x] || 0), 0);
  if (seen.blizzard >= 3) return 'blizzard';
  if (n('snow', 'blizzard') >= 6) return 'snow';
  if (n('snow', 'blizzard') >= 3) return 'flurries';
  if (seen.storm >= 2) return 'storm';
  if (n('rain', 'storm') >= 7) return 'rain';
  if (n('rain', 'storm') >= 3) return 'showers';
  if (seen.fog >= 3) return 'fog';
  if (seen.windy >= 6) return 'windy';
  return (seen.cloudy || 0) > (seen.clear || 0) ? 'cloudy' : 'clear';
}

// The week ahead from a moment: [{ weekday: 'Mon', kind, icon, word }] for each Eastern-time day, starting today.
export function forecast(fromMs, days = 7) {
  const { y, m, d } = etParts(fromMs), out = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.UTC(y, m, d + i, 12));
    const kind = dayWeather(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    out.push({ weekday: day.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), kind, icon: WEATHER_WORDS[kind][0], word: WEATHER_WORDS[kind][1] });
  }
  return out;
}
