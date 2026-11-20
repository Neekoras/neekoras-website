/* Lake scene, shared by the homepage and the arcade: cliffs, two waterfalls and the Golden Gate
   above a lake where rays and fish swim.
   The sky is the Bay Area's real one: the sun and moon sit where they are right now over San
   Francisco, and /weather.json (written by the server every ten minutes) picks clear, cloud,
   fog, rain or storm. Add ?hour=18.5 or ?sky=rain to the address to preview another moment.
   The calendar is California's too. From mid-November to New Year's Day there is a lit tree on
   the cliff and snow: light flurries always, heavier when the real weather is rain. Santa crosses
   the sky from December 20 to 25; on Christmas Eve and Christmas Day he stays out with five
   reindeer: a lap round the tree or the moon, then a turn back across the far side of the sky and
   another to come past in front again. Fireworks go up from New Year's Eve evening through New
   Year's Day. `count` is an element that gets a small status line (the time in San Francisco, the
   temperature and the weather) and under it a countdown: to Christmas from December 1, then to
   the new year from December 26. ?date=12-25 previews a date.
   lakeScene({ canvas, host, name, count, rays, reduce }) fills `canvas` to cover `host`; the shore line is
   kept just above `name`, `rays: false` leaves the rays out, `reduce` draws one still frame.
   Drawn into a small pixel buffer (one buffer pixel = 2 CSS px) and scaled up unsmoothed.
   - Water: a lattice of dots over a two-buffer ripple simulation. The rays' wakes, the cursor and
     clicks push on it; dots shift and lift slightly with the wave. Kept dim on purpose.
   - Ray: glides toward a point that wanders on a sum-of-sines path, with a speed cap so it cuts
     corners. Wings roll in a slow wave from body to tip; the tail is a chain dragged behind.
     It veers off when the cursor comes close. No fast motion, no colour changes. */
window.lakeScene = ({ canvas: cv, host: hero, name, count: tag, rays: wantRays = true, reduce = false }) => {
  const ctx = cv.getContext("2d"), S = 2, G = 11, TAU = Math.PI * 2, TAIL = 18;
  const rgb = (h) => { const n = parseInt(h.slice(1), 16); return (0xff000000 | (n & 255) << 16 | (n >> 8 & 255) << 8 | n >> 16) >>> 0; };
  const DOTC = rgb("#7fb4e6"), DOTA = [0.09, 0.17, 0.3, 0.52];
  // Scenery colours at four heights of the sun: night, dusk or dawn, golden hour, full day.
  const hexes = (s) => s.split(" ").map((h) => rgb("#" + h)), EL = [-12, -1, 7, 22], RAD = Math.PI / 180;
  const PAL = {
    sky: [hexes("050b18 06101f 081527 0a1a30 0c1f39 0e2441 112949 142e51 173358 1a3960 1e3f67 22466e"), // top of the sky to the horizon
      hexes("0a1c36 0e2748 14345f 1e4179 31498a 4d5097 73589b 9d5f98 c4698e e27c82 f39876 fbb582"),
      hexes("17468a 22559c 3165ad 4577bb 5d89c6 7a9bce 99acd2 b9bbcf d5c4c0 e9c9ab f5cb96 fbcd88"),
      hexes("1b57a4 2263b2 2b70bf 377dca 468ad3 5797db 6aa4e2 7eb1e8 93bded a8c9f1 bdd5f5 d2e1f8")],
    lake: [hexes("14304f 112a46 0e243d 0c1f35 0a1a2d 081525 07111e 060e19 050b14"), // the shore down to the page colour
      hexes("28568a 214b78 1b4068 163658 122c49 0e233b 0a1a2d 071220 050b14"),
      hexes("3a74b0 2f659f 26578c 1e4978 173c64 113050 0c233c 081727 050b14"),
      hexes("3f8ad2 3379bf 296aab 205a96 184b80 113c69 0c2d50 081d36 050b14")],
    rock: [hexes("0c1c2e 101f33 142438"), hexes("132a41 19344f 1f3e5c"), hexes("3a4a5e 46586d 53667c"), hexes("4c5d70 5a6c80 69798c")],
    far: hexes("1a2548 4d4a88 7a86b8 86a3cc"), farTop: hexes("26325a 6f5c9c 99a0cc a3bbdc"), mid: hexes("131d3c 2c3a6c 566a9c 5f82b4"),
    seam: hexes("081422 0c1e30 263445 34455a"), haze: hexes("2a4266 4a6a9a 8fb2d8 a9cdea"), rim: hexes("7d9ccc f09a7c ffd9a0 fff4d6"),
    moss: hexes("12332f 245a55 4d8a52 5da456"), pine: hexes("050e18 081725 1a3d33 245040"), gate: hexes("3d161a 8f2f2c c8452f d4553a"),
    cloud: hexes("243250 e9a9a0 fff0dc ffffff"), cloudLo: hexes("19243c 85669a d9c2c0 cfdcec"), fish: hexes("4f7fb4 6f9bd0 a8d0f2 c4e2fb"), bird: hexes("0a1220 141c33 2a3850 2f3f5a"), tree: hexes("0d3324 14503a 1f7a48 23884e"),
  };
  const WATER0 = hexes("f1faff c9e8fb 98cdf0 6aaadb 467fb6"), WHITE = rgb("#ffffff"), INK = rgb("#050b14"), RAINC = rgb("#cfe4ff"), LAMP = rgb("#ffd98a"), KOI = hexes("ff8a3c fff3e6");
  const GOLD = rgb("#ffd24a"), BULBS = hexes("ff4d4d ffd24a 6fc3ff ff7ac0"), SPARK = hexes("ec65a6 ff7a2e ffd24a 7fe0ff ffffff 8be28b");
  // Santa, drawn a letter per pixel and facing right: the sleigh (sack, Santa, the curled front, a gold runner)
  // and one reindeer (antlers, head, a white tail), whose legs gallop between two poses
  const SLEIGH = ["....wr........", ".gd..rrr......", "dddd.wss......", "ddddrwwrr...kk", "kkkkkkkkkkk..k", "krrrrrrrrrrrrk", ".krrrrrrrrrrkg", "..ggggggggggg."];
  const DEER = [".......d.d", "........d.", ".......bbb", "......bb..", "wbbbbbbb..", ".bbbbbbb.."], LEGS = [[".b.....b..", "d.......d."], ["..b...b...", "...d.d...."]];
  const INKS = { r: rgb("#e0343f"), w: WHITE, s: rgb("#f3c9a2"), b: rgb("#8a5a34"), d: rgb("#5a3a20"), k: rgb("#9c1f2c"), g: GOLD, n: rgb("#ff3b3b"), l: rgb("#c9a56c") };
  const WX = { clear: { g: 0, clouds: 1 }, partly: { g: 0.15, clouds: 3 }, cloudy: { g: 0.45, clouds: 6 }, overcast: { g: 0.8, clouds: 8 },
    fog: { g: 0.55, clouds: 2, fog: 1 }, rain: { g: 0.85, clouds: 8, rain: 1 }, storm: { g: 0.95, clouds: 8, rain: 2, bolt: 1 } };
  let SKY, LAKE, ROCK, WATER; const C = { white: WHITE, star: rgb("#c9dbf5"), moon: rgb("#e6edf7") };
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const mix = (a, b, t) => { const r = a & 255, g = a >> 8 & 255, bl = a >> 16 & 255; return (0xff000000 | (bl + ((b >> 16 & 255) - bl) * t) << 16 | (g + ((b >> 8 & 255) - g) * t) << 8 | (r + ((b & 255) - r) * t)) >>> 0; };
  const hash = (n) => { n = Math.imul(n ^ n >>> 15, 0x2c1b3c6d); n = Math.imul(n ^ n >>> 12, 0x297a2d39); return ((n ^ n >>> 15) >>> 0) / 4294967296; };
  const vn = (x, s) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i * 131 + s) * (1 - u) + hash((i + 1) * 131 + s) * u; };
  const KIND = [ // nearest to deepest: the deeper ones are smaller and dimmer
    { fill: "#3d6d9a", rim: "#a5d2f2", mid: "#2a5078", mark: "#e6f4ff" },
    { fill: "#b23a78", rim: "#ff8cc6", mid: "#7c2353", mark: "#ffd3e9" },
    { fill: "#234462", rim: "#5587ad", mid: "#19324a", mark: "#86aac8" },
    { fill: "#172f46", rim: "#365a79", mid: "#112435", mark: "#4d7392" },
  ];
  for (const k of KIND) for (const n in k) k[n] = rgb(k[n]);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  let W = 0, H = 0, img, buf, gw = 0, gh = 0, cur, prev, rays = [], mouse = null, last = 0, acc = 0, raf = 0, visible = true;
  let scene, skyM, shore = 0, skyTop = 36, peak = 0, top, stars = [], falls = [], mist = [], fallAcc = 0, mistAcc = 0;
  let surge = 0, flow = 0, lastY = scrollY; // surge: how hard the page is being scrolled, 0 to 1
  let clouds = [], drops = [], schools = [], lamps = [], beacons = [], jump = null, jumpIn = 4000, birds = null, birdIn = 7000, flash = 0, boltIn = 5000, rainAcc = 0;
  const LABEL = { clear: "clear", partly: "partly cloudy", cloudy: "cloudy", overcast: "overcast", fog: "foggy", rain: "raining", storm: "stormy" };
  const CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });
  let lineNow, lineCount;
  if (tag) { lineNow = document.createElement(reduce ? "span" : "button"); if (!reduce) { lineNow.type = "button"; lineNow.title = "Play a whole day in ten seconds"; lineNow.addEventListener("click", () => play()); } lineCount = document.createElement("span"); tag.replaceChildren(lineNow, lineCount); tag.hidden = false; }
  let warp = 0, lapse = null, orbs = [], gate = null, wish = null, real = { sky: "clear", known: false }, typed = ""; // warp: how far the time-lapse has run ahead of the clock
  const CARS = Array.from({ length: 9 }, (_, i) => ({ sp: 0.000034 + hash(i * 17 + 3) * 0.000026, ph: hash(i * 29 + 5), dir: i % 2 ? 1 : -1 }));
  const HEAD = rgb("#fff3c4"), TAILC = rgb("#ff5a4a");
  const WORDS = { rain: "rain", storm: "storm", thunder: "storm", fog: "fog", snow: "rain", sun: "clear", clear: "clear", cloud: "cloudy" };
  let shift = 0, bulbs = [], star = 0, moonAt = null, santa = null, santaIn = 3500, rockets = [], sparks = [], fwIn = 600;

  // Where the sun and moon are over San Francisco right now (low-precision almanac formulas, good to about a degree).
  const q = new URLSearchParams(location.search), hourArg = parseFloat(q.get("hour")), dateArg = /^(\d\d?)-(\d\d?)$/.exec(q.get("date") || ""), LAT = 37.77 * RAD, LON = -122.42;
  const env = { el: 0, az: 180, mel: -90, maz: 0, phase: 0, night: 0, sky: WX[q.get("sky")] ? q.get("sky") : "clear", wind: 8, wished: false };
  env.wx = WX[env.sky];
  const FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const pacific = (ms) => { const o = {}; for (const p of FMT.formatToParts(new Date(ms))) o[p.type] = +p.value; return o; };
  function look() {
    let ms = Date.now(), p = pacific(ms);
    if (dateArg) { ms += Date.UTC(p.year, dateArg[1] - 1, +dateArg[2]) - Date.UTC(p.year, p.month - 1, p.day); p = pacific(ms); }
    if (hourArg >= 0 && hourArg <= 24) { ms += (hourArg - p.hour - p.minute / 60) * 3600000; p = pacific(ms); }
    ms += warp; p = pacific(ms);
    shift = ms - Date.now(); // how far a previewed date or hour, or the time-lapse, is from the real clock
    env.tree = (p.month === 11 && p.day >= 15) || p.month === 12 || (p.month === 1 && p.day === 1); // the season of the tree and the snow
    env.snow = env.tree || !!(wish && wish.snow); // typing "snow" brings the snow without the tree
    env.santa = p.month === 12 && p.day >= 20 && p.day <= 25; env.eve = env.santa && p.day >= 24; // Christmas Eve and Day get the long flight
    env.fireworks = (p.month === 12 && p.day === 31 && p.hour >= 18) || (p.month === 1 && p.day === 1);
    const d = ms / 86400000 - 10957.5, g = (357.529 + 0.98560028 * d) * RAD, e = (23.439 - 0.00000036 * d) * RAD;
    const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD, lst = ((18.697374558 + 24.06570982441908 * d) * 15 + LON) * RAD;
    const at = (lon) => { // a point on the ecliptic, as height above the horizon and compass bearing
      const ra = Math.atan2(Math.cos(e) * Math.sin(lon), Math.cos(lon)), dec = Math.asin(Math.sin(e) * Math.sin(lon)), ha = lst - ra;
      return [Math.asin(Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(ha)) / RAD,
        (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(LAT) - Math.tan(dec) * Math.cos(LAT)) / RAD + 540) % 360];
    };
    env.phase = (((d - 5.26) / 29.530588853) % 1 + 1) % 1; // 0 new moon, 0.5 full
    [env.el, env.az] = at(L); [env.mel, env.maz] = at(L + env.phase * TAU);
    env.night = clamp((-env.el - 1) / 9, 0, 1);
  }
  // Blend the four palettes for the sun's height, then grey them down for cloud and rain.
  function theme() {
    let k = 0; while (k < 2 && env.el > EL[k + 1]) k++;
    const t = clamp((env.el - EL[k]) / (EL[k + 1] - EL[k]), 0, 1), g = env.wx.g, dark = env.wx.rain ? (env.snow ? 0.06 : 0.24) : g > 0.7 ? 0.1 : 0;
    const tone = (c, a) => { const l = (c & 255) * 0.3 + (c >> 8 & 255) * 0.59 + (c >> 16 & 255) * 0.11; return mix(mix(c, (0xff000000 | Math.min(255, l * 1.08) << 16 | (l * 0.98) << 8 | (l * 0.92)) >>> 0, a), INK, dark); };
    const set = (name, a) => PAL[name][k].map((c, i) => tone(mix(c, PAL[name][k + 1][i], t), a));
    SKY = set("sky", g * 0.85); LAKE = set("lake", g * 0.5); LAKE[LAKE.length - 1] = INK; ROCK = set("rock", g * 0.4);
    for (const n of ["far", "farTop", "mid", "seam", "haze", "rim", "moss", "pine", "gate", "cloud", "cloudLo", "fish", "bird", "tree"]) C[n] = tone(mix(PAL[n][k], PAL[n][k + 1], t), g * 0.4);
    C.snow = mix(WHITE, C.haze, 0.12); C.rim = mix(C.rim, ROCK[2], g * 0.7); C.cloud = mix(C.cloud, C.cloudLo, g * 0.5);
    C.sun = mix(rgb("#ffe7c2"), rgb("#fffbe8"), clamp(env.el / 20, 0, 1));
    WATER = WATER0.map((c) => mix(c, PAL.lake[0][2], 0.3 * env.night + (env.wx.rain ? 0.12 : 0)));
  }

  /* The scenery is painted into `scene` for the current size, sun and weather: a dithered sky with
     the sun or moon, two far ridges, the bridge, a cliff on each side with pines, and the lake below
     the shore line. Each frame copies it and draws the moving parts on top. `skyM` marks the pixels
     that are still open sky, so clouds pass behind everything else. */
  function build() {
    theme();
    const hr = hero.getBoundingClientRect(), nameTop = (name.getBoundingClientRect().top - hr.top - 28) / S;
    shore = Math.round(clamp(Math.min(H * 0.46, nameTop), H * 0.24, H * 0.5)); // the shore line sits just above the name
    scene = new Uint32Array(W * H); skyM = new Uint8Array(W * H).fill(1, 0, shore * W); top = new Int16Array(W).fill(shore);
    const paint = (i, c) => { scene[i] = c; skyM[i] = 0; };
    const V = Math.min(H, shore * 2.2); skyTop = Math.min(36, shore * 0.34); // heights follow the sky, so a short banner keeps its proportions
    const g = env.wx.g, sr = Math.max(8, V * 0.05), hz = shore - V * 0.04, n = SKY.length - 1;
    const lift = (el) => hz - (el < 0 ? el / 80 : Math.pow(Math.min(1, el / 80), 0.75)) * (hz - skyTop - sr), across = (az) => W * (0.4 + (az - 180) / 300); // the view looks south: east on the left, and noon sits over the gap
    const sx = across(env.az), sy = lift(env.el), glow = (1 - g * 0.8) * (2.8 - 1.3 * clamp(env.el / 20, 0, 1)) * clamp((env.el + 9) / 9, 0, 1);
    orbs = sy < shore && g < 0.7 ? [{ x: sx, y: sy, r: sr }] : []; // what a click can land on to play the day
    for (let y = 0; y < shore; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - sx, (y - sy) * 1.15);
      const f = Math.min(n, Math.pow(y / shore, 1.25) * n + Math.max(0, 1 - d / (sr * 5)) * glow), i = Math.floor(f);
      scene[y * W + x] = d < sr && g < 0.7 ? C.sun : SKY[Math.min(n, i + (f - i > BAYER[(y & 3) * 4 + (x & 3)] ? 1 : 0))];
    }
    moonAt = null;
    if (env.mel > 2 && env.el < 5 && g < 0.7) { // the moon, lit on the side that faces the sun
      const mx = Math.round(across(env.maz)), my = Math.round(lift(env.mel)), mr = Math.round(sr * 0.8), c = Math.cos(env.phase * TAU);
      orbs.push({ x: mx, y: my, r: mr }); moonAt = { x: mx, y: my };
      for (let dy = -mr; dy <= mr; dy++) for (let dx = -mr; dx <= mr; dx++) {
        const x = mx + dx, y = my + dy, lim = Math.sqrt(Math.max(0, mr * mr - dy * dy));
        if (x < 0 || x >= W || y < 0 || y >= shore || Math.abs(dx) > lim) continue;
        if (env.phase < 0.5 ? dx > c * lim : dx < -c * lim) scene[y * W + x] = mix(C.moon, SKY[0], 0.35 * clamp(env.el / 5, 0, 1));
      }
    }
    const ridge = (x, s, base, amp) => Math.max(0, Math.round(base - amp * (0.55 * vn(x / (W * 0.11), s) + 0.3 * vn(x / (W * 0.045), s + 7) + 0.15 * vn(x / (W * 0.018), s + 13))));
    for (let x = 0; x < W; x++) {
      let y0 = ridge(x, 11, shore - V * 0.045, V * 0.13);
      for (let y = y0; y < shore; y++) paint(y * W + x, env.snow && y < y0 + 2 ? mix(C.snow, C.far, 0.25) : y === y0 ? C.farTop : C.far);
      y0 = ridge(x, 29, shore - V * 0.012, V * 0.085);
      for (let y = y0; y < shore; y++) paint(y * W + x, C.mid);
    }
    // cliffs: stepped ledges up to a terraced top, with a notch where the river goes over
    const mh = Math.min(V * 0.3, shore * 0.62), ledge = (t) => Math.floor(clamp(t, 0, 1) * 6) / 6, terr = (x, s, a) => Math.floor(vn(x / 26, s) * a / 3) * 3;
    const xr = W * 0.5, xr1 = W * 0.56, xl = W * 0.15, xl1 = W * 0.24;
    const fw = clamp(Math.round(W * 0.04), 10, 30), fx = Math.round(W * (W < 330 ? 0.68 : 0.715));
    falls = [{ x: fx, w: fw }, { x: Math.round(W * 0.07), w: Math.max(5, Math.round(fw * 0.42)) }]; // the main falls and a thin one across the lake
    const inFalls = (x, pad) => falls.some((f) => x >= f.x - pad && x <= f.x + f.w - 1 + pad);
    { // the Golden Gate, far off across the gap between the cliffs: two towers, the cable and its hangers
      const b0 = Math.round(xl + (xl1 - xl) * 0.45), b1 = Math.round(xr + (xr1 - xr) * 0.55), span = b1 - b0, deck = shore - Math.max(5, Math.round(V * 0.028)), th = Math.round(clamp(V * 0.11, 12, Math.min(shore * 0.3, span * 0.4)));
      const leg = W > 500 ? 3 : 2, t1 = Math.round(b0 + span * 0.27), t2 = Math.round(b0 + span * 0.73), tt = deck - th, col = mix(C.gate, C.haze, 0.12), thin = mix(col, C.haze, 0.45);
      const cable = (x) => x < t1 ? tt + (deck - 1 - tt) * Math.pow((t1 - x) / (t1 - b0), 1.25) : x > t2 + leg ? tt + (deck - 1 - tt) * Math.pow((x - t2 - leg) / (b1 - t2 - leg), 1.25)
        : tt + (deck - 2 - tt) * (1 - Math.pow(2 * (x - t1 - leg / 2) / (t2 - t1) - 1, 2));
      lamps = []; beacons = []; gate = { b0, b1, deck };
      for (let x = b0; x <= b1; x++) {
        const cy = Math.round(cable(x));
        if ((x - b0) % 4 === 0) for (let y = cy + 1; y < deck; y++) paint(y * W + x, thin);
        paint(cy * W + x, col); paint(deck * W + x, col); if (W > 500) paint((deck + 1) * W + x, thin);
        if ((x - b0) % 9 === 4) lamps.push((deck - 1) * W + x);
      }
      for (const tx of [t1, t2]) {
        for (let y = tt - 1; y < shore; y++) { paint(y * W + tx, col); paint(y * W + tx + leg, col); }
        for (let k = 0; k < 4; k++) { const y = tt + Math.round((deck - tt) * k / 4); for (let x = tx; x <= tx + leg; x++) paint(y * W + x, col); }
        beacons.push((tt - 2) * W + tx + (leg >> 1));
      }
    }
    for (let x = 0; x < W; x++) {
      let y = shore;
      if (x >= xr) y = shore - Math.round(mh * (x < xr1 ? ledge((x - xr) / (xr1 - xr)) : 1) * 0.84) - (x >= xr1 ? terr(x, 3, mh * 0.2) : 0);
      else if (x < xl1) y = shore - Math.round(mh * 0.5 * (x < xl ? 1 : ledge(1 - (x - xl) / (xl1 - xl)))) - (x < xl ? terr(x, 5, mh * 0.14) : 0);
      if (inFalls(x, 1)) y += 3;
      top[x] = y;
      for (let yy = y; yy < shore; yy++) {
        let c = env.snow && yy <= y + 2 ? (yy === y ? C.snow : mix(C.snow, C.haze, 0.3)) : yy === y ? C.rim : yy <= y + 2 ? C.moss
          : hash(x * 13 + 7) > 0.88 && vn(yy / 9, x) > 0.35 ? C.seam // cracks
          : ROCK[Math.min(2, Math.floor((vn(x / 7, 41) * 0.55 + vn(yy / 5 + Math.floor(x / 6) * 3.7, 77) * 0.45) * 3))];
        if (yy > y + 2 && (yy - y) % 17 === 9 && hash(x * 5 + yy) > 0.3) c = mix(c, C.rim, 0.16); // ledges
        if (shore - yy < 34) c = mix(c, C.haze, 0.3 * (1 - (shore - yy) / 34)); // spray haze near the water
        paint(yy * W + x, c);
      }
    }
    for (let x = 1; x < W - 1; x++) { // rock faces that look toward the sun catch its light
      const side = x > sx ? x - 1 : x + 1;
      for (let y = top[x] + 1; y < top[side]; y++) scene[y * W + x] = mix(scene[y * W + x], C.rim, 0.4);
    }
    for (let x = 4, k = 0; x < W - 4; x += 5 + Math.floor(hash(k * 53 + 9) * 9), k++) { // pines along the tops
      if (top[x] > shore - 8 || inFalls(x, 6) || Math.abs(top[x + 3] - top[x - 3]) > 4) continue;
      const h = 7 + Math.floor(hash(k * 71 + 5) * 9);
      for (let r = 0; r < h; r++) {
        const y = top[x] - h + r, half = r >= h - 2 ? 0 : Math.floor(((r % 4) + 1) * 0.5 + r * 0.2);
        if (y >= 0) for (let d = -half; d <= half; d++) paint(y * W + x + d, env.snow && r % 4 === 0 ? C.snow : C.pine);
      }
    }
    peak = shore; for (let x = 0; x < W; x++) if (top[x] < peak) peak = top[x]; // the highest cliff top
    bulbs = []; star = 0;
    if (env.tree) { // the Christmas tree: three tiers on the right-hand cliff, strung with lights, a star on top
      const tx = Math.round(W * 0.61), h = Math.round(clamp(V * 0.1, 14, 38)), base = top[tx], tier = (h - 2) / 3;
      if (base < shore - 6 && base - h > 3) {
        for (let r = 0; r < h; r++) {
          const y = base - h + r, k = Math.min(2, Math.floor(r / tier)), half = r >= h - 2 ? 0 : Math.round((r - k * tier) * 0.62 + k * 1.6 + 0.5);
          for (let d = -half; d <= half; d++) {
            paint(y * W + tx + d, r >= h - 2 ? C.seam : env.snow && r - k * tier < 1 ? C.snow : C.tree);
            if (r > 1 && r < h - 2 && (r + d) % 3 === 0 && hash(r * 31 + d * 17 + 5) > 0.45) bulbs.push({ i: y * W + tx + d, c: BULBS[Math.floor(hash(r * 7 + d * 3 + 1) * 4)], ph: hash(r + d * 9) * TAU });
          }
        }
        star = (base - h - 1) * W + tx;
      }
    }
    const ln = LAKE.length - 1;
    for (let y = shore; y < H; y++) for (let x = 0; x < W; x++) {
      const f = Math.min(ln, Math.pow((y - shore) / ((H - shore) * 0.92), 0.9) * ln), i = Math.floor(f);
      scene[y * W + x] = LAKE[Math.min(ln, i + (f - i > BAYER[(y & 3) * 4 + (x & 3)] ? 1 : 0))];
    }
    for (let x = 0; x < W; x++) if (top[x] < shore) scene[shore * W + x] = mix(scene[shore * W + x], C.white, 0.22);
    if (env.wx.fog) for (let y = 0; y < shore; y++) { const a = 0.5 * Math.pow(y / shore, 2); for (let x = 0; x < W; x++) scene[y * W + x] = mix(scene[y * W + x], C.haze, a); }
    stars = [];
    for (let k = 0, m = Math.round(W * shore / 1500); k < m; k++) {
      const i = Math.floor(hash(k * 97 + 1) * shore * 0.7) * W + Math.floor(hash(k * 193 + 2) * W);
      if (skyM[i]) stars.push({ i, ph: hash(k * 389 + 3) * TAU, sp: 0.6 + hash(k * 7 + 4) });
    }
    mist = [];
    falls.forEach((f, n) => {
      f.top = top[f.x + (f.w >> 1)];
      f.col = Array.from({ length: f.w }, (_, i) => ({ sp: 0.045 + hash(i * 13 + n * 57 + 1) * 0.05, len: 5 + Math.floor(hash(i * 29 + n * 61 + 2) * 12), ph: hash(i * 41 + n * 67 + 3) * 100 }));
    });
  }

  function size(again) {
    const r = hero.getBoundingClientRect(), w = Math.ceil(r.width / S), h = Math.ceil(r.height / S);
    if (w === W && h === H) { if (again) build(); return; }
    W = w; H = h; cv.width = W; cv.height = H;
    img = ctx.createImageData(W, H); buf = new Uint32Array(img.data.buffer);
    gw = Math.ceil(W / G) + 2; gh = Math.ceil(H / G) + 2; cur = new Float32Array(gw * gh); prev = new Float32Array(gw * gh);
    look(); build();
    const small = W < 330;
    clouds = Array.from({ length: 8 }, (_, i) => { // a row of overlapping ovals cut off flat along the bottom
      const w = Math.round(clamp(W * (0.07 + hash(i * 31 + 2) * 0.09), 24, 104)), h = Math.round(w * (0.2 + hash(i * 37 + 3) * 0.08)) + 3, m = new Uint8Array(w * h), nb = 3 + Math.floor(hash(i * 41 + 4) * 3);
      for (let b = 0; b < nb; b++) {
        const cx = w * (0.2 + 0.6 * (b + hash(i * 43 + b) * 0.5) / nb), rv = h * (0.4 + 0.26 * hash(i * 47 + b * 3)) * (1 - 0.5 * Math.abs(b - (nb - 1) / 2) / nb), rh = rv * 1.6, cy = h - rv * 0.5;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x - cx) / rh) ** 2 + ((y - cy) / rv) ** 2 < 1) m[y * w + x] = y > h * 0.66 ? 2 : 1;
      }
      return { w, h, m, x: hash(i * 53 + 5) * (W + w) - w, band: hash(i * 61 + 7), sp: 0.0016 + hash(i * 59 + 6) * 0.0018 };
    });
    drops = Array.from({ length: Math.round(W * H / 1400) }, () => ({ x: Math.random() * W * 1.15, y: Math.random() * H, sp: 0.3 + Math.random() * 0.22 }));
    // schools follow one wandering path, each fish a little behind and beside the last; the koi go alone
    schools = Array.from({ length: small ? 2 : 3 }, (_, i) => ({ s: i * 2.3, ph: i * 2.1 + 0.7, spd: 0.00011 + i * 0.00002, fx: 0.3 + 0.4 * ((i * 0.41 + 0.2) % 1), fy: 0.34 + 0.4 * ((i * 0.57 + 0.1) % 1), n: small ? 5 : 7 }))
      .concat(Array.from({ length: small ? 1 : 2 }, (_, i) => ({ s: i * 3.1 + 1, ph: i * 1.3 + 4, spd: 0.00006 + i * 0.000015, fx: 0.35 + 0.3 * i, fy: 0.5 - 0.12 * i, n: 1, koi: true })));
    for (const o of schools) if (o.koi) { const [x, y] = swim(o, o.s), [x1, y1] = swim(o, o.s + 0.012), l = Math.hypot(x1 - x, y1 - y) || 1; Object.assign(o, { x, y, ox: 0, oy: 0, dx: (x1 - x) / l, dy: (y1 - y) / l }); }
    jump = birds = santa = null; rockets = []; sparks = [];
    const n = wantRays ? (small ? 2 : 4) : 0;
    rays = Array.from({ length: n }, (_, i) => {
      const f = { k: KIND[i], sz: [2.1, 1.65, 1.3, 1][i], s: i * 2.1, ph: i * 1.7, spd: 0.00017 - i * 0.00002,
        cx: W * (0.3 + 0.4 * ((i * 0.37) % 1)), cy: shore + (H - shore) * (0.36 + 0.34 * ((i * 0.61) % 1)), ax: W * 0.32, ay: (H - shore) * 0.3,
        vx: 0, vy: 0, fl: i * 1.3, wake: 0 };
      const e = i % 4; // each comes in from a different edge
      f.x = e === 0 ? -45 : e === 1 ? W + 45 : Math.random() * W; f.y = e > 1 ? H + 45 : shore + 30 + Math.random() * (H - shore - 30);
      if (reduce) { const t = goal(f); f.x = t.x; f.y = t.y; }
      f.hd = Math.atan2(H / 2 - f.y, W / 2 - f.x);
      f.tail = Array.from({ length: TAIL }, (_, j) => ({ x: f.x - Math.cos(f.hd) * (6 * f.sz + j * 3), y: f.y - Math.sin(f.hd) * (6 * f.sz + j * 3) }));
      return f;
    }).reverse(); // deepest drawn first
  }
  const swim = (o, s) => [W * o.fx + W * 0.3 * Math.sin(s + o.ph) + W * 0.1 * Math.sin(2.3 * s + o.ph * 2),
    clamp(shore + (H - shore) * (o.fy + 0.16 * Math.cos(0.8 * s + o.ph) + 0.07 * Math.sin(1.9 * s + o.ph)), shore + 14, H - 8)];
  const dab = (x, y, c, a) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < W && y < H) { const p = y * W + x; buf[p] = a < 1 ? mix(buf[p], c, a) : c; } };
  const goal = (f) => ({
    x: clamp(f.cx + f.ax * Math.sin(f.s + f.ph) + f.ax * 0.33 * Math.sin(2.7 * f.s + f.ph + 1.3), 24, W - 24),
    y: clamp(f.cy + f.ay * Math.cos(0.9 * f.s + f.ph) + f.ay * 0.42 * Math.sin(1.6 * f.s + f.ph + 0.5), shore + 26, H - 24),
  });
  /* Santa's route is a chain of legs, measured in pixels flown so the team can follow it in file.
     A straight leg swoops from one height to another. A turn is part of a wide flat loop, the way a
     level circle looks from the side: the top is the near side, the bottom the far side, where he
     is drawn dimmer and goes behind the tree and the cliffs. On an ordinary night the route is one
     leg across. On Christmas Eve and Day he laps the tree's star or the moon, flies on, turns back
     along the far side, turns again and leaves in front. */
  function route(dir, big) {
    const segs = [], rnd = Math.random, high = () => skyTop + 4 + rnd() * Math.max(4, peak - 22 - skyTop), out = dir > 0 ? W + 26 : -26;
    let x = dir > 0 ? -26 : W + 26, y = high(), h = dir, far = false;
    const line = (xb, yb) => { segs.push({ len: Math.abs(xb - x), xa: x, ya: y, yb, h, far, amp: (rnd() < 0.5 ? -1 : 1) * (4 + rnd() * 8) }); x = xb; y = yb; };
    const turn = (rx, ry, laps) => { // 1 is a full lap; 0.5 turns him round, onto the far side or back off it
      segs.push({ len: TAU * laps * rx, cx: x, cy: far ? y - ry : y + ry, rx, ry, D: far ? -h : h, t0: far ? Math.PI : 0 });
      if (laps === 0.5) { y += far ? -2 * ry : 2 * ry; h = -h; far = !far; }
    };
    if (big) {
      const spots = [], sy = Math.floor(star / W), rt = clamp(W * 0.07, 18, 44), rx = clamp(W * 0.14, 34, 90); // the lap and both turns are kept on screen
      if (star) { const ry = clamp(sy >> 1, 3, 9); spots.push({ x: star % W, top: sy + 4 - 2 * ry, ry }); } // the far side of the lap passes behind the top of the tree
      if (moonAt && moonAt.y >= 12 && moonAt.x > rx + 8 && moonAt.x < W - rx - 8) { const ry = clamp(moonAt.y - 8, 3, 8); spots.push({ x: moonAt.x, top: moonAt.y - 3 - ry, ry }); }
      if (!spots.length) spots.push({ x: W * 0.5, top: skyTop + 6, ry: 8 });
      const o = spots[Math.floor(rnd() * spots.length)];
      line(o.x, o.top); turn(rx, o.ry, 1);
      line(dir > 0 ? Math.min(W - rt - 6, Math.max(o.x + 40, W * 0.84)) : Math.max(rt + 6, Math.min(o.x - 40, W * 0.16)), high()); turn(rt, 5, 0.5);
      line(dir > 0 ? W * 0.16 : W * 0.84, clamp(peak - 6 + rnd() * 12, skyTop + 16, shore - 18)); turn(rt, 5, 0.5);
    }
    line(out, high());
    return { segs, s: 0, n: big && W >= 330 ? 5 : 3, len: segs.reduce((a, g) => a + g.len, 0) };
  }
  function fly(a, s) { // the spot `s` pixels along the route: where it is, which way it faces, and whether it is on the far side
    let i = 0, g = a.segs[0]; while (i < a.segs.length - 1 && s >= g.len) { s -= g.len; g = a.segs[++i]; }
    if (g.rx) { const th = g.t0 + s / g.rx, c = Math.cos(th); return { x: g.cx + g.D * g.rx * Math.sin(th), y: g.cy - g.ry * c, face: c >= 0 ? g.D : -g.D, far: c < 0 }; }
    const v = clamp(s / g.len, 0, 1);
    return { x: g.xa + g.h * s, y: clamp(g.ya + (g.yb - g.ya) * v * v * (3 - 2 * v) + g.amp * Math.sin(Math.PI * v) ** 2, 3, shore - 12), face: g.h, far: g.far };
  }
  function poke(x, y, a) {
    const i = Math.round((x - 5) / G) + 1, j = Math.round((y - 5) / G) + 1;
    if (i > 0 && j > 0 && i < gw - 1 && j < gh - 1) cur[j * gw + i] -= a;
  }

  function step(dt) {
    for (const f of rays) {
      f.s += f.spd * dt;
      let { x: tx, y: ty } = goal(f), flee = false;
      if (mouse) {
        const dx = f.x - mouse.x, dy = f.y - mouse.y, d = Math.hypot(dx, dy);
        if (d < 70 && d > 0.001) { flee = true; tx = f.x + (dx / d) * (80 - d) * 2; ty = f.y + (dy / d) * (80 - d) * 2; }
      }
      for (const o of rays) { // keep apart
        if (o === f) continue;
        const dx = f.x - o.x, dy = f.y - o.y, d = Math.hypot(dx, dy), m = 13 * (f.sz + o.sz);
        if (d < m && d > 0.001) { tx += (dx / d) * (m - d); ty += (dy / d) * (m - d); }
      }
      let dvx = (tx - f.x) * 0.003, dvy = (ty - f.y) * 0.003;
      const sp = Math.hypot(dvx, dvy), max = (flee ? 0.12 : 0.026 + 0.012 * f.sz);
      if (sp > max) { dvx *= max / sp; dvy *= max / sp; }
      const k = 1 - Math.pow(0.996, dt);
      f.vx += (dvx - f.vx) * k; f.vy += (dvy - f.vy) * k; f.x += f.vx * dt; f.y += f.vy * dt;
      if (f.y < shore + 16 && f.vy < 0) { f.y = shore + 16; f.vy = 0; } // the rays stay in the lake
      const v = Math.hypot(f.vx, f.vy);
      if (v > 0.004) { let d = Math.atan2(f.vy, f.vx) - f.hd; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; f.hd += d * (1 - Math.pow(0.996, dt)); }
      f.fl += (0.002 + v * 0.02) * dt; // slow wing roll, a little quicker when moving fast
      let px = f.x - Math.cos(f.hd) * 6 * f.sz, py = f.y - Math.sin(f.hd) * 6 * f.sz; // tail: each link is dragged by the one before
      for (const t of f.tail) { const dx = t.x - px, dy = t.y - py, d = Math.hypot(dx, dy) || 1; t.x = px + (dx / d) * 3; t.y = py + (dy / d) * 3; px = t.x; py = t.y; }
      f.wake += dt; if (f.wake > 420) { f.wake = 0; poke(f.x, f.y, 0.12 * f.sz); }
    }
    surge *= Math.pow(0.9975, dt); flow += dt * (1 + 2.6 * surge); // scrolling makes the falls pour harder, then they calm
    fallAcc += dt * (1 + 5 * surge); if (fallAcc > 240) { fallAcc = 0; for (const f of falls) poke(f.x + Math.random() * f.w, shore + 7, (0.02 + 0.05 * surge) * f.w); } // the falls keep the lake moving
    mistAcc += dt * (1 + 4 * surge); if (mistAcc > 110 && mist.length < 22 + 26 * surge) { mistAcc = 0; const f = falls[Math.random() < 0.8 ? 0 : 1]; mist.push({ x: f.x - 2 + Math.random() * (f.w + 4), y: shore - 2, vx: (Math.random() - 0.5) * 0.014, vy: -(0.005 + Math.random() * 0.009), life: 1 }); }
    for (const m of mist) { m.x += m.vx * dt; m.y += m.vy * dt; m.life -= dt / 2600; }
    mist = mist.filter((m) => m.life > 0);
    for (const c of clouds) { c.x += c.sp * (1 + env.wind / 15) * dt * (lapse ? 9 : 1); if (c.x > W) c.x = -c.w; }
    for (const o of schools) {
      o.s += o.spd * dt;
      if (!o.koi) continue; // the koi leave their path to come and look at the pointer, circling just short of it
      const [bx, by] = swim(o, o.s); let tx = 0, ty = 0;
      if (mouse && mouse.y > shore + 8) {
        const mx = mouse.x + 11 * Math.cos(o.s * 38 + o.ph), my = mouse.y + 6 * Math.sin(o.s * 38 + o.ph), d = Math.hypot(mx - bx, my - by);
        if (d < 130) { tx = mx - bx; ty = my - by; }
      }
      const k = 1 - Math.pow(0.9978, dt); o.ox += (tx - o.ox) * k; o.oy += (ty - o.oy) * k;
      const x = bx + o.ox, y = clamp(by + o.oy, shore + 12, H - 6), vx = x - o.x, vy = y - o.y, v = Math.hypot(vx, vy);
      if (v > 0.0005 * dt) { const h = 1 - Math.pow(0.994, dt); o.dx += (vx / v - o.dx) * h; o.dy += (vy / v - o.dy) * h; const l = Math.hypot(o.dx, o.dy) || 1; o.dx /= l; o.dy /= l; }
      o.x = x; o.y = y;
    }
    if (env.snow) for (const d of drops) { // flakes fall slowly and sway
      d.y += d.sp * 0.11 * dt; d.x += (Math.sin(d.y * 0.05 + d.sp * 40) * 0.012 - 0.004 - env.wind * 0.0004) * dt;
      if (d.y > H) { d.y -= H; d.x = Math.random() * W * 1.15; } if (d.x < -2) d.x += W + 4;
    } else if (env.wx.rain) {
      const wind = 0.05 + env.wind * 0.003;
      for (const d of drops) { d.y += d.sp * dt; d.x -= wind * dt; if (d.y > H) { d.y -= H; d.x = Math.random() * W * 1.15; } }
      rainAcc += dt; if (rainAcc > 90 / env.wx.rain) { rainAcc = 0; poke(Math.random() * W, shore + 8 + Math.random() * (H - shore - 12), 0.2); }
    }
    if (env.santa) {
      if (santa) { santa.s += 0.062 * dt; if (santa.s > santa.len + 130) { santa = null; santaIn = env.eve ? 3500 + Math.random() * 4500 : 12000 + Math.random() * 16000; } }
      else if ((santaIn -= dt) <= 0) santa = route(Math.random() < 0.5 ? 1 : -1, env.eve);
    } else santa = null;
    if (env.fireworks && (fwIn -= dt) <= 0) { // a rocket goes up from behind the hills
      fwIn = (env.night > 0.5 ? 110 : 650) + Math.random() * (env.night > 0.5 ? 320 : 800);
      rockets.push({ x: W * (0.04 + Math.random() * 0.92), y: shore - 3, ty: skyTop + 4 + Math.random() * Math.max(8, shore * 0.72 - skyTop), c: SPARK[Math.floor(Math.random() * SPARK.length)] });
    }
    for (const r of rockets) {
      r.y -= 0.14 * dt;
      if (r.y <= r.ty) { // and bursts into a ring of sparks that slow, sink and fade
        r.done = true;
        for (let i = 0, n = 30 + Math.floor(Math.random() * 22), sp = 0.04 + Math.random() * 0.035, c2 = SPARK[Math.floor(Math.random() * SPARK.length)]; i < n; i++) {
          const a = TAU * i / n + Math.random() * 0.2, inner = i % 3 === 0, v = sp * (inner ? 0.45 : 0.8 + Math.random() * 0.35);
          sparks.push({ x: r.x, y: r.y, px: r.x, py: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c: inner ? c2 : r.c });
        }
      }
    }
    if (rockets.length) rockets = rockets.filter((r) => !r.done);
    for (const k of sparks) { k.px = k.x; k.py = k.y; k.x += k.vx * dt; k.y += k.vy * dt; k.vy += 0.00004 * dt; k.vx *= 1 - 0.0012 * dt; k.vy *= 1 - 0.0008 * dt; k.life -= dt / 1600; }
    if (sparks.length) sparks = sparks.filter((k) => k.life > 0);
    if (env.wx.bolt && !env.snow) { boltIn -= dt; if (boltIn <= 0) { flash = 1; boltIn = 7000 + Math.random() * 12000; } }
    if (flash > 0) flash -= dt / 260;
    jumpIn -= dt; // now and then a fish leaves the water
    if (!jump && jumpIn <= 0) { jump = { x: W * (0.12 + Math.random() * 0.76), y: shore + 18 + Math.random() * (H - shore) * 0.45, u: 0, dir: Math.random() < 0.5 ? -1 : 1, h: 9 + Math.random() * 8, d: 10 + Math.random() * 8 }; poke(jump.x, jump.y, 1.1); }
    if (jump) { jump.u += dt / 780; if (jump.u >= 1) { poke(jump.x + jump.dir * jump.d, jump.y, 1.4); jump = null; jumpIn = 5000 + Math.random() * 9000; } }
    if (!birds && env.el > 2 && !env.wx.rain && !env.wx.fog) { // birds cross by day in fair weather
      birdIn -= dt;
      if (birdIn <= 0) { const dir = Math.random() < 0.5 ? 1 : -1; birds = { x: dir > 0 ? -24 : W + 24, y: skyTop + 4 + Math.random() * Math.max(10, shore * 0.45 - skyTop), dir, n: 3 + Math.floor(Math.random() * 3), sp: 0.022 + Math.random() * 0.01 }; }
    }
    if (birds) { birds.x += birds.dir * birds.sp * dt; if (birds.x < -60 || birds.x > W + 60) { birds = null; birdIn = 20000 + Math.random() * 25000; } }
    acc += dt; let n = 0;
    while (acc >= 33 && n++ < 4) {
      acc -= 33;
      for (let j = 1; j < gh - 1; j++) for (let i = 1, k = j * gw + 1; i < gw - 1; i++, k++) prev[k] = ((cur[k - 1] + cur[k + 1] + cur[k - gw] + cur[k + gw]) * 0.5 - prev[k]) * 0.95;
      const t = cur; cur = prev; prev = t;
    }
    if (acc >= 33) acc = 0;
  }

  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = c; };
  function drawRay(f) {
    const s = f.sz, c = Math.cos(f.hd), sn = Math.sin(f.hd), k = f.k, R = Math.ceil(18 * s);
    f.tail.forEach((t, j) => { if (j < 7 * s) put(Math.round(t.x), Math.round(t.y), k.mid); });
    const x0 = Math.round(f.x), y0 = Math.round(f.y);
    for (let py = Math.max(0, y0 - R); py <= Math.min(H - 1, y0 + R); py++) for (let px = Math.max(0, x0 - R); px <= Math.min(W - 1, x0 + R); px++) {
      const dx = px - f.x, dy = py - f.y, v = Math.abs(-dx * sn + dy * c) / s; if (v > 15) continue;
      const t = v / 15, u = (dx * c + dy * sn) / s + Math.sin(f.fl - t * 2.2) * 2.2 * t * t; // the tips trail the wave
      // outline: leading edge sweeps back to a pointed tip, trailing edge curves in to the tail
      const lead = v < 1.3 ? 4.4 : v < 2.7 ? 7 - (v - 1.3) * 1.4 : 5 - 6.2 * Math.pow(t, 1.5), trail = -6.5 + 5.3 * Math.pow(t, 0.62);
      if (u > lead || u < trail) continue;
      buf[py * W + px] = v < 0.8 && u < 3 ? k.mid // spine
        : lead - u < 1.1 || (v > 1.3 && v < 2.7 && u > 4.6) ? k.rim // lit leading edge and horn fins
        : v > 2.4 && v < 6.5 - (3.4 - u) * 1.3 && u > 1 && u < 3.4 ? k.mark // shoulder patches
        : k.fill;
    }
  }
  function render(t = 0) {
    buf.set(scene);
    const dusk = env.night * (1 - env.wx.g); // how much of the night shows through
    if (dusk > 0.05) for (const s of stars) buf[s.i] = mix(scene[s.i], C.star, dusk * (Math.sin(t * 0.001 * s.sp + s.ph) > 0.2 ? 1 : 0.35));
    for (let k = 0, nc = Math.ceil(env.wx.clouds * (W < 330 ? 0.6 : 1)); k < nc && k < clouds.length; k++) {
      const c = clouds[k], x0 = Math.round(c.x), y0 = Math.round(skyTop + c.band * Math.max(8, shore * 0.6 - skyTop - c.h));
      for (let y = 0; y < c.h && y0 + y < shore; y++) for (let x = Math.max(0, -x0); x < c.w && x0 + x < W; x++) {
        const v = c.m[y * c.w + x], p = (y0 + y) * W + x0 + x;
        if (v && skyM[p]) buf[p] = v === 1 ? C.cloud : C.cloudLo;
      }
    }
    if (flash > 0) for (let i = 0, a = flash * 0.42, e = shore * W; i < e; i++) if (skyM[i]) buf[i] = mix(buf[i], WHITE, a);
    for (const b of bulbs) buf[b.i] = Math.sin(t * 0.004 + b.ph) > -0.3 ? b.c : mix(b.c, C.tree, 0.7);
    if (star) { const c = Math.sin(t * 0.005) > -0.6 ? GOLD : mix(GOLD, WHITE, 0.6); for (const o of [0, -1, 1, -W, W]) buf[star + o] = c; }
    if (dusk > 0.05) { // lamps along the bridge deck and a slow red light on each tower
      for (const i of lamps) buf[i] = mix(buf[i], LAMP, env.night * 0.9);
      if (Math.floor(t / 900) % 2 === 0) for (const i of beacons) buf[i] = mix(buf[i], KOI[0], env.night);
      if (gate) for (let k = 0, n = W < 330 ? 4 : CARS.length, span = gate.b1 - gate.b0; k < n; k++) { // traffic: headlights one way, tail lights the other
        const c = CARS[k], u = (t * c.sp + c.ph) % 1, x = Math.round(c.dir > 0 ? gate.b0 + u * span : gate.b1 - u * span), i = gate.deck * W + x;
        buf[i] = mix(buf[i], c.dir > 0 ? HEAD : TAILC, env.night * 0.95);
        if (x > gate.b0 && x < gate.b1) buf[i + c.dir] = mix(buf[i + c.dir], c.dir > 0 ? HEAD : TAILC, env.night * 0.4); // the glow ahead of it
      }
    }
    // the lake mirrors what is above the shore, squashed and wobbling, fading into the water
    const RH = Math.min(Math.round(H * 0.11), H - shore - 2);
    for (let k = 0; k < RH; k++) {
      const sy = shore - 1 - Math.round(k * 2.1); if (sy < 0) break;
      const row = (shore + 1 + k) * W, srow = sy * W, wob = Math.round(Math.sin(k * 0.8 + t * 0.0016) * (0.6 + k * 0.05)), a = 0.45 + 0.55 * k / RH;
      for (let x = 0; x < W; x++) buf[row + x] = mix(scene[srow + clamp(x + wob, 0, W - 1)], scene[row + x], a);
      for (const f of falls) for (let x = f.x; x < f.x + f.w; x++) { const p = row + clamp(x - wob, 0, W - 1); buf[p] = mix(buf[p], WATER[1], (1 - k / RH) * 0.3); }
    }
    // falls: every column scrolls its own run of light and dark streaks, with foam where the water lands
    const ft = Math.floor(t / 110);
    for (const f of falls) {
      for (let i = 0; i < f.w; i++) {
        const c = f.col[i], x = f.x + i, off = flow * c.sp + c.ph, edge = i === 0 || i === f.w - 1 ? 1 : 0;
        for (let y = f.top; y < shore; y++) {
          const v = hash(Math.floor((y - off) / c.len) * 7919 + i * 104729);
          buf[y * W + x] = WATER[Math.min(4, (y < f.top + 2 || v < 0.16 ? 0 : v < 0.42 ? 1 : v < 0.74 ? 2 : 3) + edge)];
        }
      }
      const fr = Math.min(5, 2 + (f.w >> 2));
      for (let y = shore - fr; y < shore + fr; y++) for (let x = Math.max(0, f.x - fr); x < Math.min(W, f.x + f.w + fr); x++) {
        const dx = (x - (f.x + f.w / 2)) / (f.w / 2 + fr), dy = (y - shore) / fr, d = dx * dx + dy * dy;
        if (d < 1 && hash(x * 92821 + y * 68917 + ft * 31) > 0.35 + d * 0.6) buf[y * W + x] = hash(x + y * 7 + ft) > 0.5 ? WATER[0] : WATER[1];
      }
    }
    for (const m of mist) {
      const x0 = Math.round(m.x), y0 = Math.round(m.y);
      for (let y = y0; y < y0 + 2; y++) for (let x = x0; x < x0 + 4; x++) if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = mix(buf[y * W + x], C.white, 0.3 * m.life);
    }
    if (env.wx.fog) for (let y = Math.max(0, shore - 30); y < Math.min(H, shore + 16); y++) { // a bank of fog drifting along the shore
      const a = 0.55 * (1 - Math.abs(y - (shore - 7)) / 23), row = y * W;
      for (let x = 0; x < W; x++) buf[row + x] = mix(buf[row + x], C.haze, a * (0.5 + 0.5 * vn(x / 38 + t * 0.00003 + y * 0.07, 5)));
    }
    for (let n = 0; n < schools.length; n++) {
      const o = schools[n], dim = 1 - 0.45 * env.night;
      for (let i = 0; i < o.n; i++) {
        const si = o.s - i * 0.03; let [x, y] = swim(o, si), [x1, y1] = swim(o, si + 0.012), l = Math.hypot(x1 - x, y1 - y) || 1, dx = (x1 - x) / l, dy = (y1 - y) / l;
        if (o.koi) { x = o.x; y = o.y; dx = o.dx; dy = o.dy; }
        const off = o.koi ? 0 : ((i * 7 + n * 3) % 5 - 2) * 2.4 + Math.sin(t * 0.003 + i), hx = x - dy * off, hy = y + dx * off, wag = Math.round(Math.sin(t * 0.012 + i * 2 + n));
        if (o.koi) {
          for (let j = 0; j < 6; j++) { const c = KOI[j === 1 || j === 4 ? 1 : 0]; dab(hx - dx * j, hy - dy * j, c, 0.9 * dim); if (j > 0 && j < 4) dab(hx - dx * j - dy, hy - dy * j + dx, c, 0.9 * dim); }
          dab(hx - dx * 6 - dy * wag, hy - dy * 6 + dx * wag, KOI[0], 0.7 * dim);
        } else {
          for (let j = 0; j < 3; j++) dab(hx - dx * j, hy - dy * j, C.fish, 0.55);
          dab(hx - dx * 3 - dy * wag, hy - dy * 3 + dx * wag, C.fish, 0.4);
        }
      }
    }
    for (let j = 1; j < gh - 1; j++) {
      if ((j - 1) * G + 5 < shore + 5) continue; // dots only on the water
      for (let i = 1; i < gw - 1; i++) {
        const k = j * gw + i, a = Math.abs(cur[k]), l = a > 0.4 ? 3 : a > 0.16 ? 2 : a > 0.05 ? 1 : 0;
        const x = (i - 1) * G + 5 + Math.round(clamp((cur[k - 1] - cur[k + 1]) * 5, -2, 2)), y = (j - 1) * G + 5 + Math.round(clamp((cur[k - gw] - cur[k + gw]) * 5, -2, 2));
        if (x >= 0 && y > shore && x < W && y < H) buf[y * W + x] = mix(buf[y * W + x], DOTC, DOTA[l]);
      }
    }
    for (const f of rays) drawRay(f);
    if (jump) { // an arc out of the water and back in
      const u = jump.u, x = jump.x + jump.dir * jump.d * u, y = jump.y - 4 * jump.h * u * (1 - u), vx = jump.dir * jump.d, vy = -4 * jump.h * (1 - 2 * u), l = Math.hypot(vx, vy) || 1;
      for (let j = 0; j < 4; j++) dab(x - vx / l * j, y - vy / l * j, j ? WATER[1] : WHITE, 1);
      dab(x - vx / l * 4 + vy / l, y - vy / l * 4 - vx / l, WATER[2], 1);
      if (u < 0.3) for (let k = -1; k <= 1; k++) dab(jump.x + k * (2 + u * 14), jump.y - 2 - u * 16 * (1 - u * 1.6), WHITE, 0.8 - u * 2);
    }
    if (birds) for (let i = 0; i < birds.n; i++) {
      const rank = (i + 1) >> 1, bx = birds.x - birds.dir * rank * 7, by = birds.y + (i % 2 ? -1 : 1) * rank * 4, up = Math.sin(t * 0.012 + i) > 0;
      for (let k = -2; k <= 2; k++) dab(bx + k, by - (up ? Math.abs(k) : k === -2 || k === 2 ? 1 : 0), C.bird, 1);
    }
    const spot = (x, y, c, a) => { if (y < shore) dab(x, y, c, a); }; // fireworks stay above the water, with a glint on the lake below
    for (const r of rockets) { spot(r.x, r.y, WHITE, 0.9); spot(r.x, r.y + 2, r.c, 0.5); spot(r.x, r.y + 4, r.c, 0.25); }
    for (const k of sparks) {
      const a = Math.min(1, k.life * 1.6) * (k.life < 0.3 && hash(Math.round(k.x * 7 + k.y * 13) + ft) > 0.5 ? 0.3 : 1); // they flicker as they die
      spot(k.x, k.y, k.c, a); spot(k.px, k.py, k.c, a * 0.45); spot(2 * k.px - k.x, 2 * k.py - k.y, k.c, a * 0.2);
      dab(k.x, shore + 2 + (shore - k.y) * 0.4, k.c, 0.16 * a);
    }
    if (santa) { // the sleigh and each deer follow the route one behind the other, each tipped to its own climb or dive
      const fr = Math.floor(t / 150), n = santa.n, back = (n - 1) * 12 + 15, team = [];
      for (let j = 0; j <= n; j++) { // 0 is the sleigh, n the lead deer
        const at = santa.s - (j ? (n - j) * 12 : back), p = fly(santa, at), q = fly(santa, at + 3), dx = q.x - p.x;
        p.tilt = Math.abs(dx) > 0.6 ? clamp((q.y - p.y) / dx, -0.5, 0.5) : 0; p.x = Math.round(p.x); p.y = Math.round(p.y + (j ? Math.sin(t * 0.011 + j * 1.7) * 0.7 : 0)); // the deer bob as they run
        team.push(p);
      }
      const ink = (p, x, y, c, a) => { x = Math.round(x); y = Math.round(y); if (!p.far) dab(x, y, c, a); else if (x >= 0 && y >= 0 && x < W && y < H && skyM[y * W + x]) dab(x, y, c, a * 0.78); };
      for (let k = 0; k < 8; k++) { const p = fly(santa, santa.s - back - 10 - k * 4 - hash(ft + k) * 3); ink(p, p.x, p.y + 3 + hash(ft * 3 + k) * 4, GOLD, 0.85 - k * 0.1); } // gold dust off the runners
      for (const far of [true, false]) team.forEach((p, j) => {
        if (p.far !== far) return;
        const art = j ? DEER.concat(LEGS[(fr + j) % 2]) : SLEIGH, half = j ? 5 : 7, lift = (o) => Math.round(p.tilt * p.face * o);
        if (j < n) { // the rein to the deer ahead, from Santa's hands or the harness
          const q = team[j + 1], ax = p.x + p.face * (j ? 3 : 2), ay = p.y + (j ? 4 : 3) + lift(j ? 3 : 2), bx = q.x - q.face * 5, by = q.y + 4 - Math.round(q.tilt * q.face * 5), m = Math.max(1, Math.abs(bx - ax), Math.abs(by - ay));
          if (m < 24) for (let k = 0; k <= m; k++) ink(p, ax + (bx - ax) * k / m, ay + (by - ay) * k / m, INKS.l, 0.9);
        }
        for (let r = 0; r < 8; r++) for (let k = 0, row = art[r]; k < row.length; k++) if (row[k] !== ".") ink(p, p.x + p.face * (k - half), p.y + r + lift(k - half), j === n && r === 2 && k === 9 ? INKS.n : INKS[row[k]], 1); // the lead deer has the red nose
      });
    }
    if (env.snow) for (let i = 0, m = Math.round(drops.length * (env.wx.rain > 1 ? 1 : env.wx.rain ? 0.6 : 0.22)); i < m; i++) { const d = drops[i]; dab(d.x, d.y, WHITE, 0.9); if (i % 6 === 0) dab(d.x + 1, d.y, WHITE, 0.6); }
    else if (env.wx.rain) for (let i = 0, m = Math.round(drops.length * env.wx.rain / 2); i < m; i++) { const d = drops[i]; dab(d.x, d.y, RAINC, 0.42); dab(d.x, d.y - 1, RAINC, 0.42); dab(d.x + 1, d.y - 2, RAINC, 0.3); }
    ctx.putImageData(img, 0, 0);
  }
  function frame(now) {
    raf = 0; const dt = Math.min(now - last, 100); last = now;
    if (lapse) { // a whole day in ten seconds, then back to the real clock
      const u = Math.min(1, (now - lapse.t0) / 10000);
      warp = u < 1 ? 86400000 * u * u * (3 - 2 * u) : 0; if (u >= 1) lapse = null;
      if (!lapse || now - lapse.at > 45) { if (lapse) lapse.at = now; look(); build(); tick(); }
    }
    step(dt); render(now);
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  const start = () => { if (!raf && !reduce && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };

  const at = (e) => { const r = hero.getBoundingClientRect(); return { x: (e.clientX - r.left) / S, y: (e.clientY - r.top) / S }; };
  let lastNode = -1;
  const onOrb = (p) => !reduce && orbs.some((o) => Math.hypot(p.x - o.x, p.y - o.y) < Math.max(o.r * 1.5, 11));
  const play = () => { if (!lapse && !reduce) { lapse = { t0: performance.now(), at: 0 }; start(); } };
  hero.addEventListener("pointermove", (e) => {
    const p = at(e); if (e.pointerType === "mouse") { mouse = p; hero.style.cursor = onOrb(p) ? "pointer" : ""; }
    const node = Math.round(p.y / G) * gw + Math.round(p.x / G); if (node !== lastNode && p.y > shore) { lastNode = node; poke(p.x, p.y, 0.18); }
  });
  hero.addEventListener("pointerleave", () => { mouse = null; });
  addEventListener("scroll", () => { const y = scrollY; surge = Math.min(1, surge + Math.abs(y - lastY) / 420); lastY = y; }, { passive: true });
  hero.addEventListener("pointerdown", (e) => { // a click drops a ring into the water and nudges nearby rays away
    const p = at(e); if (onOrb(p)) { play(); return; } poke(p.x, p.y, 2);
    for (const f of rays) { const dx = f.x - p.x, dy = f.y - p.y, d = Math.hypot(dx, dy) || 1; if (d < 130) { f.vx += (dx / d) * 0.07; f.vy += (dy / d) * 0.07; } }
  });
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; start(); }).observe(hero);
  document.addEventListener("visibilitychange", start);
  addEventListener("resize", () => { size(); if (reduce) render(); });
  const refresh = () => { if (!W) return; look(); build(); if (reduce) render(); };
  // The label: the time, temperature and weather in San Francisco, and under it a countdown to
  // Christmas (midnight on the 25th, Pacific) from December 1, then to the new year from the 26th.
  function tick() {
    if (!tag) return;
    const now = Date.now() + shift, p = pacific(now), two = (n) => String(n).padStart(2, "0");
    const status = CLOCK.format(now) + " in San Francisco" + (env.known ? ", " + (env.temp != null ? Math.round(env.temp * 9 / 5 + 32) + "°F and " : "") + (wish && wish.snow ? "snowing" : LABEL[env.sky]) : ""); // one plain sentence
    if (lineNow.textContent !== status) lineNow.textContent = status;
    const to = p.month !== 12 ? null : p.day < 25 ? ["Christmas", Date.UTC(p.year, 11, 25, 8)] : p.day > 25 ? [String(p.year + 1), Date.UTC(p.year + 1, 0, 1, 8)] : null;
    let text = p.month === 12 && p.day === 25 ? "Merry Christmas" : p.month === 1 && p.day === 1 ? "Happy New Year" : "";
    if (to) { const sec = Math.max(0, Math.floor((to[1] - now) / 1000)); text = to[0] + " in " + Math.floor(sec / 86400) + "d " + two(Math.floor(sec % 86400 / 3600)) + "h " + two(Math.floor(sec % 3600 / 60)) + "m" + (reduce ? "" : " " + two(sec % 60) + "s"); }
    if (lineCount.textContent !== text) lineCount.textContent = text;
    lineCount.hidden = !text;
  }
  // The sky shown is the last word typed (for a minute), else a previewed ?sky=, else the real weather.
  function apply() { // `known` is false when the weather file is missing or stale, and then the label shows only the time
    const sky = wish ? wish.sky : WX[q.get("sky")] ? q.get("sky") : real.sky, snow = !!(wish && wish.snow);
    env.known = real.known || !!wish || !!WX[q.get("sky")];
    if (sky !== env.sky || snow !== env.wished) { env.sky = sky; env.wx = WX[sky]; env.wished = snow; refresh(); }
    tick();
  }
  function weather() {
    const use = (sky, wind, temp, known) => { real = { sky, known }; env.wind = wind; env.temp = temp; apply(); };
    fetch("/weather.json", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      const fresh = !!WX[j.sky] && Date.now() - Date.parse(j.at) < 3 * 3600000;
      use(fresh ? j.sky : "clear", clamp(+j.wind || 8, 0, 60), fresh && typeof j.temp === "number" ? j.temp : null, fresh);
    }).catch(() => use("clear", 8, null, false));
  }
  // Weather words: type rain, snow, storm, fog, cloud or sun anywhere on the page and the sky does it for a minute.
  addEventListener("keydown", (e) => {
    const el = e.target;
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) return;
    typed = (typed + e.key.toLowerCase()).slice(-8);
    for (const w in WORDS) if (typed.endsWith(w)) {
      typed = ""; if (wish) clearTimeout(wish.end);
      wish = { sky: WORDS[w], snow: w === "snow", end: setTimeout(() => { wish = null; apply(); }, 60000) };
      apply(); if (WORDS[w] === "storm") flash = 1;
      break;
    }
  });
  setInterval(refresh, 60000); setInterval(weather, 600000); weather();
  size(); if (reduce) render(); else start();
  tick(); setInterval(tick, 1000);
  if (document.fonts) document.fonts.ready.then(() => { size(true); if (reduce) render(); }); // the name moves once its font loads
};
