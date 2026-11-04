// Nightly snapshot of every game's cloud-save database (/var/lib/<game>-saves/saves.db) into
// /home/ubuntu/backups/saves/<YYYY-MM-DD>/<game>.db.gz, keeping the newest KEEP_DAYS days.
// VACUUM INTO makes a consistent copy while the save services keep running.
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { DatabaseSync } = require("node:sqlite");

const SRC = "/var/lib";
const DEST = "/home/ubuntu/backups/saves";
const KEEP_DAYS = 7;
const MIN_FREE_BYTES = 1024 * 1024 * 1024;

const day = new Date().toISOString().slice(0, 10);
const out = path.join(DEST, day);
fs.mkdirSync(out, { recursive: true });

const { bavail, bsize } = fs.statfsSync(DEST);
if (bavail * bsize < MIN_FREE_BYTES) {
  console.error(`backup-saves: under 1 GB free, skipping ${day}`);
  process.exit(1);
}

let failed = 0;
for (const dir of fs.readdirSync(SRC).filter((d) => d.endsWith("-saves")).sort()) {
  const db = path.join(SRC, dir, "saves.db");
  if (!fs.existsSync(db)) continue;
  const game = dir.slice(0, -"-saves".length);
  const tmp = path.join(out, game + ".db");
  try {
    fs.rmSync(tmp, { force: true });
    const conn = new DatabaseSync(db, { readOnly: true });
    conn.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    conn.close();
    fs.writeFileSync(tmp + ".gz", zlib.gzipSync(fs.readFileSync(tmp)));
    fs.rmSync(tmp);
    console.log(`backup-saves: ${game} -> ${tmp}.gz (${fs.statSync(tmp + ".gz").size} bytes)`);
  } catch (e) {
    failed++;
    console.error(`backup-saves: ${game} FAILED: ${e.message}`);
  }
}

const days = fs.readdirSync(DEST).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
for (const old of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) {
  fs.rmSync(path.join(DEST, old), { recursive: true, force: true });
  console.log(`backup-saves: removed ${old}`);
}
process.exit(failed ? 1 : 0);
