// Page-side applier for APT2 edit scripts made by patch_audio.py: rewrites a UnityFS bundle while it streams out
// of the zip's DecompressionStream, before saveBundle stores it. Untouched bytes pass straight through; the header
// is replaced with the precomputed one (uncompressed block info); each touched LZ4 block is decompressed,
// spliced and emitted uncompressed (block flag 0), exactly as `patch_audio.py --rebuild raw` writes it.
// Plain script (no imports): paste into the page, or load it; also usable from Node (module.exports).

// Parse an APT2 file (ArrayBuffer or Uint8Array).
function parseApt(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "APT2") throw new Error("not an APT2 patch");
    const n = dv.getUint32(4, true);
    const apt = {
        newCrc: dv.getUint32(8, true), origCrc: dv.getUint32(12, true),
        origSize: dv.getFloat64(16, true), outSize: dv.getFloat64(24, true),
        origHeadLen: dv.getUint32(32, true), blocks: []
    };
    const headLen = dv.getUint32(36, true);
    apt.head = u8.subarray(40, 40 + headLen);
    let p = 40 + headLen;
    for (let i = 0; i < n; i++) {
        const b = { origOff: dv.getFloat64(p, true), csize: dv.getUint32(p + 8, true), usize: dv.getUint32(p + 12, true),
                    comp: dv.getUint32(p + 16, true), splices: [] };
        const ns = dv.getUint32(p + 20, true);
        p += 24;
        for (let j = 0; j < ns; j++) {
            const off = dv.getUint32(p, true), del = dv.getUint32(p + 4, true), len = dv.getUint32(p + 8, true);
            b.splices.push({ off, del, ins: u8.subarray(p + 12, p + 12 + len) });
            p += 12 + len;
        }
        apt.blocks.push(b);
    }
    if (p !== u8.length) throw new Error("APT2 has trailing bytes");
    return apt;
}

// Raw LZ4 block decompression (no frame), into a buffer of exactly usize bytes.
function lz4Decompress(src, usize) {
    const dst = new Uint8Array(usize);
    let s = 0, d = 0;
    const end = src.length;
    while (s < end) {
        const token = src[s++];
        let lit = token >>> 4;
        if (lit === 15) { let b; do { b = src[s++]; lit += b; } while (b === 255); }
        if (d + lit > usize || s + lit > end) throw new Error("lz4: literal overrun");
        dst.set(src.subarray(s, s + lit), d); s += lit; d += lit;
        if (s >= end) break;                                  // last sequence has no match
        const off = src[s] | (src[s + 1] << 8); s += 2;
        if (off === 0 || off > d) throw new Error("lz4: bad offset");
        let ml = token & 15;
        if (ml === 15) { let b; do { b = src[s++]; ml += b; } while (b === 255); }
        ml += 4;
        if (d + ml > usize) throw new Error("lz4: match overrun");
        let m = d - off;
        if (off >= ml) { dst.copyWithin(d, m, m + ml); d += ml; }
        else { for (let k = 0; k < ml; k++) dst[d++] = dst[m++]; }   // overlapping copy
    }
    if (d !== usize) throw new Error("lz4: got " + d + " bytes, expected " + usize);
    return dst;
}

function applySplices(data, splices) {
    let size = data.length;
    for (const sp of splices) size += sp.ins.length - sp.del;
    const out = new Uint8Array(size);
    let p = 0, o = 0;
    for (const sp of splices) {                               // ascending, non-overlapping (patch_audio.py sorts them)
        if (sp.off < p || sp.off + sp.del > data.length) throw new Error("bad splice");
        out.set(data.subarray(p, sp.off), o); o += sp.off - p;
        out.set(sp.ins, o); o += sp.ins.length;
        p = sp.off + sp.del;
    }
    out.set(data.subarray(p), o);
    return out;
}

// TransformStream: original bundle bytes in, patched bundle bytes out (apt.outSize of them).
function aptTransform(apt) {
    const blocks = apt.blocks;
    let pos = 0, out = 0, bi = 0;                             // input bytes consumed, output bytes emitted, next block
    let hold = null, held = 0;                                // compressed bytes of the touched block being collected
    let first = new Uint8Array(0);                            // first bytes, to check the signature
    const emit = (ctl, bytes) => { if (bytes.length) { ctl.enqueue(bytes); out += bytes.length; } };
    return new TransformStream({
        transform(chunk, ctl) {
            let i = 0;
            const n = chunk.length;
            while (i < n) {
                if (pos < apt.origHeadLen) {                  // original header + block info: dropped, replaced by apt.head
                    const take = Math.min(apt.origHeadLen - pos, n - i);
                    if (first.length < 8) { const f = new Uint8Array(first.length + take); f.set(first); f.set(chunk.subarray(i, i + take), first.length); first = f.subarray(0, Math.min(f.length, 8)); }
                    i += take; pos += take;
                    if (pos === apt.origHeadLen) {
                        if (String.fromCharCode(...first.subarray(0, 7)) !== "UnityFS") throw new Error("not a UnityFS bundle");
                        emit(ctl, apt.head);
                    }
                    continue;
                }
                const b = blocks[bi];
                if (b && pos >= b.origOff) {                  // inside a touched block: collect it whole
                    if (!hold) { hold = new Uint8Array(b.csize); held = 0; }
                    const take = Math.min(b.csize - held, n - i);
                    hold.set(chunk.subarray(i, i + take), held); held += take; i += take; pos += take;
                    if (held === b.csize) {
                        const data = b.comp === 0 ? hold : lz4Decompress(hold, b.usize);
                        if (data.length !== b.usize) throw new Error("block size mismatch");
                        emit(ctl, applySplices(data, b.splices));
                        hold = null; bi++;
                    }
                    continue;
                }
                const stop = b ? Math.min(n, i + (b.origOff - pos)) : n;   // pass through up to the next touched block
                emit(ctl, chunk.subarray(i, stop));
                pos += stop - i; i = stop;
            }
        },
        flush() {
            if (pos !== apt.origSize) throw new Error("audio patch: input was " + pos + " bytes, expected " + apt.origSize);
            if (bi !== blocks.length || out !== apt.outSize) throw new Error("audio patch: output " + out + " bytes, expected " + apt.outSize);
        }
    });
}

if (typeof module !== "undefined") module.exports = { parseApt, lz4Decompress, applySplices, aptTransform };
