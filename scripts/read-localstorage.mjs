/*
 * scripts/read-localstorage.mjs — read one localStorage key directly from a
 * Chromium LevelDB (.ldb SSTable) without native deps:
 *   footer → index block → data block (snappy-decompressed) → entry walk.
 * Usage: node read-localstorage.mjs <ldb-file> <key-substring>
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const file = process.argv[2];
const keySub = process.argv[3] || "dsh-skin-matrix-rain:config:v1";
const buf = readFileSync(file);

/* ── varint (LevelDB 格式) ── */
function varint(b, p) {
  let x = 0, s = 0;
  for (;;) {
    const c = b[p++];
    x |= (c & 0x7f) << s;
    if ((c & 0x80) === 0) return [x >>> 0, p];
    s += 7;
  }
}

/* ── snappy 原始格式解码 ── */
function snappyDecompress(b) {
  let [ulen, p] = varint(b, 0);
  const out = Buffer.alloc(ulen);
  let o = 0;
  while (p < b.length) {
    const tag = b[p++];
    const type = tag & 3;
    if (type === 0) { /* literal */
      let len = tag >> 2;
      if (len < 60) { len += 1; }
      else if (len === 60) { len = b[p++] + 1; }
      else if (len === 61) { len = b.readUInt16LE(p) + 1; p += 2; }
      else if (len === 62) { len = b.readUIntLE(p, 3) + 1; p += 3; }
      else { len = b.readUInt32LE(p) + 1; p += 4; }
      b.copy(out, o, p, p + len);
      p += len; o += len;
    } else {
      let len, off;
      if (type === 1) {
        len = 4 + ((tag >> 2) & 7);
        off = ((tag & 0xe0) << 3) | b[p++];
      } else if (type === 2) {
        len = (tag >> 2) + 1;
        off = b.readUInt16LE(p); p += 2;
      } else {
        len = (tag >> 2) + 1;
        off = b.readUInt32LE(p); p += 4;
      }
      for (let i = 0; i < len; i++) out[o + i] = out[o - off + i];
      o += len;
    }
  }
  return out;
}

/* ── 块读取: [data][1B 压缩类型][4B crc] ── */
function readBlock(offset, size) {
  const raw = buf.subarray(offset, offset + size);
  const type = buf[offset + size];
  return type === 1 ? snappyDecompress(raw) : Buffer.from(raw);
}

/* ── 块内条目遍历(前缀压缩,restart 每16条) ── */
function* blockEntries(block) {
  if (block.length < 4) return;
  const restartCount = block.readUInt32LE(block.length - 4);
  const restartOff = block.length - 4 - restartCount * 4;
  let p = 0, key = Buffer.alloc(0);
  while (p < restartOff) {
    let [shared, q] = varint(block, p);
    let [nonShared, q2] = varint(block, q);
    let [vlen, q3] = varint(block, q2);
    const keyDelta = block.subarray(q3, q3 + nonShared);
    key = Buffer.concat([key.subarray(0, shared), keyDelta]);
    const value = block.subarray(q3 + nonShared, q3 + nonShared + vlen);
    yield { key: key.toString("utf8"), value };
    p = q3 + nonShared + vlen;
  }
}

/* ── footer(末48字节): metaindex + index 句柄 + magic ── */
if (buf.length < 48) { console.error("file too small"); process.exit(1); }
const foot = buf.subarray(buf.length - 48);
const magic = foot.readBigUInt64LE(40);
if (magic !== 0xdb4775248b80fb57n) { console.error("bad magic (not an .ldb)"); process.exit(1); }
let [mOff, fp] = varint(foot, 0);
let [mSize, fp2] = varint(foot, fp);
let [iOff, fp3] = varint(foot, fp2);
let [iSize] = varint(foot, fp3);
const indexBlock = readBlock(iOff, iSize);

/* 索引块里找覆盖目标键的数据块(索引键 = 各块末键) */
let target = null;
for (const e of blockEntries(indexBlock)) {
  if (e.key >= "\x00" || e.key.includes(keySub) || true) {
    /* 逐个数据块都看,直到找到精确键 */
    let [o, q] = varint(e.value, 0);
    let [s] = varint(e.value, q);
    const data = readBlock(o, s);
    for (const de of blockEntries(data)) {
      if (de.key.includes(keySub)) { target = de; break; }
    }
    if (target) break;
  }
}

if (!target) { console.error("key not found in this sstable"); process.exit(1); }
console.log("KEY:", JSON.stringify(target.key));
console.log("VALUE:", target.value.toString("utf8"));
