/*
 * Puts games on a NumWorks calculator straight from the page, over USB (WebUSB, Chrome and Edge).
 *
 * The calculator speaks DFU (with ST's DfuSe extensions) while it shows its "connected" screen. We read
 * its software headers to find where third-party apps go, ask the server to link each game for that
 * spot (/games/numworks/api/link), then erase and write the app area one after another.
 *
 *   NWInstall.supported            true when this browser can talk to USB devices
 *   NWInstall.connect()            asks the user to pick the calculator; resolves to its info
 *   NWInstall.install(files, cb)   replaces the calculator's apps with these .nwa files, in order
 */
(function () {
  var SECTOR = 0x10000; // Epsilon lines apps up on 64 KiB boundaries on every model
  var APP_MAGIC = 0xdec0beba, KERNEL_MAGIC = 0xdec00df0, USERLAND_MAGIC = 0xdec0edfe;
  var DNLOAD = 1, UPLOAD = 2, GETSTATUS = 3, CLRSTATUS = 4, ABORT = 6;
  var IDLE = 2, DNBUSY = 4, ERROR = 10;

  var dev = null, ifnum = 0, xfer = 2048, map = [], info = null;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function u32(b, o) { return (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0; }
  function le32(v) { return [v & 255, v >>> 8 & 255, v >>> 16 & 255, v >>> 24 & 255]; }
  function cstr(b, o) { var s = ""; for (var i = o; i < b.length && b[i]; i++) s += String.fromCharCode(b[i]); return s; }
  function hex(v) { return "0x" + v.toString(16); }
  function fail(msg) { var e = new Error(msg); e.friendly = true; throw e; }

  // "@Flash/0x90000000/08*004Kg,01*032Kg,63*064Kg/0x90430000/61*064Kg" -> sectors with what each allows
  function parseMap(name) {
    var out = [], parts = name.split("/");
    for (var i = 1; i + 1 < parts.length; i += 2) {
      var addr = parseInt(parts[i], 16);
      parts[i + 1].split(",").forEach(function (seg) {
        var m = /^(\d+)\*(\d+)([BKM ])(\w)$/.exec(seg.trim());
        if (!m) return;
        var size = +m[2] * ({ B: 1, " ": 1, K: 1024, M: 1048576 })[m[3]];
        var f = m[4].charCodeAt(0) - 96; // a=1 read, b=2 erase, d=4 write
        for (var n = 0; n < +m[1]; n++, addr += size) out.push({ start: addr, size: size, read: !!(f & 1), erase: !!(f & 2), write: !!(f & 4) });
      });
    }
    return out;
  }
  function sectorAt(a) {
    for (var i = 0; i < map.length; i++) if (a >= map[i].start && a < map[i].start + map[i].size) return map[i];
    return null;
  }

  function out(req, value, data) {
    return dev.controlTransferOut({ requestType: "class", recipient: "interface", request: req, value: value || 0, index: ifnum }, data);
  }
  function inp(req, value, len) {
    return dev.controlTransferIn({ requestType: "class", recipient: "interface", request: req, value: value || 0, index: ifnum }, len)
      .then(function (r) { return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength); });
  }
  function status() {
    return inp(GETSTATUS, 0, 6).then(function (b) { return { status: b[0], wait: b[1] | b[2] << 8 | b[3] << 16, state: b[4] }; });
  }
  // Waits out the calculator's busy states after a command, then reports what it ended in.
  async function settle() {
    for (;;) {
      var s = await status();
      if (s.state === ERROR) { await out(CLRSTATUS); fail("The calculator refused a step. Unplug it, plug it back in and try again."); }
      if (s.state !== DNBUSY) return s;
      await sleep(Math.max(s.wait, 1));
    }
  }
  async function idle() {
    var s = await status();
    if (s.state === ERROR) { await out(CLRSTATUS); s = await status(); }
    if (s.state !== IDLE) { await out(ABORT); await status(); }
  }
  async function command(byte, addr) {
    await out(DNLOAD, 0, new Uint8Array([byte].concat(le32(addr))));
    await settle();
  }

  async function read(addr, len) {
    await idle();
    await command(0x21, addr);
    await out(ABORT);
    var buf = new Uint8Array(len), got = 0, block = 2;
    while (got < len) {
      var part = await inp(UPLOAD, block++, Math.min(xfer, len - got));
      if (!part.length) break;
      buf.set(part, got); got += part.length;
    }
    await out(ABORT);
    return buf.subarray(0, got);
  }
  async function erase(addr) {
    var s = sectorAt(addr);
    if (!s || !s.erase || s.start !== addr) fail("This calculator's memory is laid out in a way the installer does not know.");
    await idle();
    await command(0x41, addr);
  }
  async function write(addr, data, onBytes) {
    await idle();
    for (var o = 0; o < data.length; o += xfer) {
      await command(0x21, addr + o);
      await out(DNLOAD, 2, data.subarray(o, Math.min(o + xfer, data.length)));
      await settle();
      if (onBytes) onBytes(Math.min(xfer, data.length - o));
    }
  }

  // DFU's functional descriptor says how big each transfer may be.
  async function transferSize() {
    var head = await dev.controlTransferIn({ requestType: "standard", recipient: "device", request: 6, value: 0x0200, index: 0 }, 9);
    var total = head.data.getUint16(2, true);
    var r = await dev.controlTransferIn({ requestType: "standard", recipient: "device", request: 6, value: 0x0200, index: 0 }, total);
    var b = new Uint8Array(r.data.buffer);
    for (var i = 0; i + 1 < b.length && b[i]; i += b[i]) if (b[i + 1] === 0x21 && b[i] >= 7) return b[i + 5] | b[i + 6] << 8;
    return 2048;
  }

  // Finds the running software's userland header, which says where apps live and what RAM they get.
  async function readLayout() {
    var found = [];
    for (var slot of [0x90000000, 0x90400000]) {
      var s = sectorAt(slot);
      if (!s || !s.read) continue;
      var k = await read(slot, 0x20);
      if (u32(k, 8) !== KERNEL_MAGIC) continue;
      var version = cstr(k, 12);
      for (var off = SECTOR; off <= 4 * SECTOR; off += SECTOR) {
        var hs = sectorAt(slot + off);
        if (!hs || !hs.read) continue;
        var h = await read(slot + off, 0x60);
        if (u32(h, 0) !== USERLAND_MAGIC) continue;
        var foot = -1;
        for (var w = 2; w < 20; w++) if (u32(h, w * 4) === USERLAND_MAGIC) { foot = w; break; }
        if (foot < 9) continue;
        var vec = (foot + 1) * 4, draw = u32(h, vec + 8);
        var L = {
          slot: slot, version: version,
          start: u32(h, 20), end: u32(h, 24), ram: u32(h, 28), ramEnd: u32(h, 32),
          tramp: slot + off + vec + 8,
        };
        if ((draw & 1) && L.start % SECTOR === 0 && L.start < L.end && L.ram < L.ramEnd) found.push(L);
        break;
      }
    }
    if (!found.length) fail("This calculator's software is too old to install games from here. Update it at numworks.com/update, then try again.");
    found.sort(function (a, b) { return b.version.localeCompare(a.version, undefined, { numeric: true }); });
    return found[0];
  }

  async function readApps(L) {
    var apps = [], a = L.start;
    while (a + 32 <= L.end && apps.length < 64) {
      var h = await read(a, 32);
      if (u32(h, 0) !== APP_MAGIC) break;
      var size = u32(h, 24);
      var name = cstr(await read(a + u32(h, 8), 64), 0);
      apps.push({ name: name, at: a, size: size });
      a = Math.ceil((a + size) / SECTOR) * SECTOR;
    }
    return apps;
  }

  function getDescriptor(type, index, lang, len) {
    return dev.controlTransferIn({ requestType: "standard", recipient: "device", request: 6, value: type << 8 | index, index: lang }, len)
      .then(function (r) { return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength); });
  }

  // Every DFU alternate setting with its name. Some browsers leave interfaceName empty, so the names
  // come from the device's own descriptors.
  async function dfuAlternates() {
    var head = await getDescriptor(2, 0, 0, 9);
    var conf = await getDescriptor(2, 0, 0, head[2] | head[3] << 8);
    var alts = [];
    for (var i = 0; i + 1 < conf.length && conf[i]; i += conf[i]) {
      if (conf[i + 1] !== 4 || conf[i + 5] !== 0xfe || conf[i + 6] !== 1) continue;
      var name = "";
      if (conf[i + 8]) {
        var s = await getDescriptor(3, conf[i + 8], 0x0409, 255);
        for (var j = 2; j + 1 < s.length && j < s[0]; j += 2) name += String.fromCharCode(s[j] | s[j + 1] << 8);
      }
      alts.push({ iface: conf[i + 2], alt: conf[i + 3], name: name });
    }
    return alts;
  }

  async function open(device) {
    dev = device;
    await dev.open();
    if (!dev.configuration) await dev.selectConfiguration(1);
    var alts = await dfuAlternates();
    var flash = alts.filter(function (a) { return /^@Flash/.test(a.name); })[0];
    if (!flash) {
      console.warn("NumWorks installer: DFU interfaces seen", alts);
      fail("The calculator is not ready yet. Unplug it, plug it back in, wait for its screen to say it is connected, then click Connect again.");
    }
    ifnum = flash.iface;
    await dev.claimInterface(ifnum);
    await dev.selectAlternateInterface(ifnum, flash.alt);
    map = parseMap(flash.name);
    try { xfer = await transferSize(); } catch (e) { xfer = 2048; }
    var L = await readLayout();
    var bcd = dev.deviceVersionMajor.toString(16) + dev.deviceVersionMinor.toString(16) + dev.deviceVersionSubminor.toString(16);
    info = {
      model: "N0" + ("000" + bcd).slice(-3),
      version: L.version, layout: L,
      space: L.end - L.start,
      apps: await readApps(L),
    };
    return info;
  }

  async function connect() {
    if (dev) { try { await dev.close(); } catch (e) {} dev = null; }
    var d;
    try {
      d = await navigator.usb.requestDevice({ filters: [{ vendorId: 0x0483, productId: 0xa291 }] });
    } catch (e) { return null; } // picker closed
    try { return await open(d); }
    catch (e) {
      if (!e.friendly) e.message = /claim|access/i.test(e.message)
        ? "Another tab or program is using the calculator. Close it, then try again."
        : "The calculator stopped answering. Unplug it, plug it back in and try again.";
      e.friendly = true;
      throw e;
    }
  }

  // progress(phase, done, total): phase is "fetch", "erase" or "write"
  async function install(files, progress) {
    if (!dev || !info) fail("Connect the calculator first.");
    var L = info.layout, at = L.start, images = [];
    progress("fetch", 0, files.length);
    for (var i = 0; i < files.length; i++) {
      var q = "app=" + encodeURIComponent(files[i]) + "&at=" + hex(at) + "&end=" + hex(L.end) +
        "&ram=" + hex(L.ram) + "&ramend=" + hex(L.ramEnd) + "&tramp=" + hex(L.tramp);
      var r = await fetch("/games/numworks/api/link?" + q);
      if (r.status === 422) fail(files[i].replace(/\.nwa$/, "") + " does not fit on this calculator.");
      if (!r.ok) fail("A game could not be prepared. Check your internet and try again.");
      var bin = new Uint8Array(await r.arrayBuffer());
      if (u32(bin, 0) !== APP_MAGIC || at + bin.length > L.end) fail("Those games do not all fit. Pick fewer and try again.");
      images.push({ at: at, data: bin });
      at = Math.ceil((at + bin.length) / SECTOR) * SECTOR;
      progress("fetch", i + 1, files.length);
    }

    // Sectors to clear: everything the new apps cover, plus the next one when an older app starts
    // there, so the calculator's list ends with the new apps.
    var sectors = [];
    images.forEach(function (im) {
      for (var a = im.at; a < im.at + im.data.length; a += SECTOR) sectors.push(a);
    });
    if (at + 32 <= L.end && info.apps.some(function (p) { return p.at === at; })) sectors.push(at);
    if (!images.length && info.apps.length) sectors.push(L.start);

    var total = images.reduce(function (n, im) { return n + im.data.length; }, 0), done = 0;
    for (var s = 0; s < sectors.length; s++) { progress("erase", s, sectors.length); await erase(sectors[s]); }
    progress("erase", sectors.length, sectors.length);
    for (var j = 0; j < images.length; j++) {
      await write(images[j].at, images[j].data, function (n) { done += n; progress("write", done, total); });
    }
    // Check each app's header made it.
    for (var k = 0; k < images.length; k++) {
      var back = await read(images[k].at, 32);
      for (var b = 0; b < 32; b++) if (back[b] !== images[k].data[b]) fail("Writing did not stick. Unplug the calculator, plug it back in and try again.");
    }
    info.apps = await readApps(L);
    return info;
  }

  window.NWInstall = {
    supported: !!(navigator.usb && window.isSecureContext),
    connect: connect,
    install: function (files, progress) {
      return install(files, progress || function () {}).catch(function (e) {
        if (!e.friendly) { e.message = "The calculator was unplugged or stopped answering before it finished. Plug it back in and install again."; e.friendly = true; }
        throw e;
      });
    },
    onDisconnect: function (fn) {
      if (navigator.usb) navigator.usb.addEventListener("disconnect", function (e) { if (e.device === dev) { dev = null; info = null; fn(); } });
    },
  };
})();
