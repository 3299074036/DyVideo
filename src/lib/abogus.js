/**
 * a_bogus signature generator for Douyin web API (single-file bundle).
 *
 * Upstream: https://github.com/randallanjie/douyin-api
 *   src/sign/abogus.js + src/sign/_common.js (rc4) + src/lib/sm3.js
 * (vendored copies kept next to this file: sm3.js, _common.js, md5.js,
 *  parity.mjs, config.js, crawler.js, params.js — for traceability).
 * Upstream itself is a port of Evil0ctal/Douyin_TikTok_Download_API's
 * a_bogus.py, byte-verified against the Python reference.
 *
 * Hermes-safe: no window/document/navigator/btoa/Buffer/TextEncoder —
 * UTF-8 encoding is done manually in pure JS. Only needs Math, Date,
 * Math.random, String/Array (available in React Native Hermes).
 *
 * CommonJS: const { getABogus } = require('./abogus.js')
 */
'use strict'
// Pure-JS SM3 hash. The Douyin a_bogus algorithm needs SM3, which
// node:crypto / WebCrypto don't provide, so we implement it here.
// Validated against the official vector
//   sm3("abc") = 66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0
//
// Input: an array (or Uint8Array) of byte ints. Output: 64-char hex.

const IV = [
  0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600,
  0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e
]

const rotl = (x, n) => {
  n %= 32
  return (((x << n) | (x >>> (32 - n))) >>> 0)
}

const p0 = x => (x ^ rotl(x, 9) ^ rotl(x, 17)) >>> 0
const p1 = x => (x ^ rotl(x, 15) ^ rotl(x, 23)) >>> 0
const tj = j => (j < 16 ? 0x79cc4519 : 0x7a879d8a)

const ff = (j, x, y, z) =>
  (j < 16 ? (x ^ y ^ z) : ((x & y) | (x & z) | (y & z))) >>> 0
const gg = (j, x, y, z) =>
  (j < 16 ? (x ^ y ^ z) : ((x & y) | ((~x) & z))) >>> 0

function cf (v, b) {
  const w = new Array(68)
  for (let i = 0; i < 16; i++) {
    w[i] = ((b[4 * i] << 24) | (b[4 * i + 1] << 16) | (b[4 * i + 2] << 8) | b[4 * i + 3]) >>> 0
  }
  for (let j = 16; j < 68; j++) {
    w[j] = (p1((w[j - 16] ^ w[j - 9] ^ rotl(w[j - 3], 15)) >>> 0) ^ rotl(w[j - 13], 7) ^ w[j - 6]) >>> 0
  }
  const w1 = new Array(64)
  for (let j = 0; j < 64; j++) w1[j] = (w[j] ^ w[j + 4]) >>> 0

  let [a, bb, c, d, e, f, g, h] = v
  for (let j = 0; j < 64; j++) {
    const ss1 = rotl((((rotl(a, 12) + e) >>> 0) + rotl(tj(j), j)) >>> 0, 7)
    const ss2 = (ss1 ^ rotl(a, 12)) >>> 0
    const tt1 = (((ff(j, a, bb, c) + d) >>> 0) + ((ss2 + w1[j]) >>> 0)) >>> 0
    const tt2 = (((gg(j, e, f, g) + h) >>> 0) + ((ss1 + w[j]) >>> 0)) >>> 0
    d = c
    c = rotl(bb, 9)
    bb = a
    a = tt1 >>> 0
    h = g
    g = rotl(f, 19)
    f = e
    e = p0(tt2) >>> 0
  }
  const o = [a, bb, c, d, e, f, g, h]
  return o.map((x, i) => (x ^ v[i]) >>> 0)
}

const toHex32 = x => (x >>> 0).toString(16).padStart(8, '0')

function sm3Hash (msg) {
  const length = msg.length * 8
  const m = Array.from(msg)
  m.push(0x80)
  while (m.length % 64 !== 56) m.push(0x00)
  // 64-bit big-endian length. JS bit-ops are 32-bit; the high word is
  // 0 for any realistic message size here, so build it via division.
  for (let i = 0; i < 8; i++) {
    const shift = 8 * (7 - i)
    m.push(Math.floor(length / Math.pow(2, shift)) & 0xFF)
  }

  let v = IV.slice()
  for (let i = 0; i < m.length; i += 64) {
    v = cf(v, m.slice(i, i + 64))
  }
  return v.map(toHex32).join('')
}

// RC4 (from upstream _common.js; key and data are byte-int arrays).
function rc4 (key, data) {
  const s = new Array(256)
  for (let i = 0; i < 256; i++) s[i] = i
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) % 256
    const t = s[i]; s[i] = s[j]; s[j] = t
  }
  const out = new Array(data.length)
  let a = 0; let b = 0
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) % 256
    b = (b + s[a]) % 256
    const t = s[a]; s[a] = s[b]; s[b] = t
    out[k] = data[k] ^ s[(s[a] + s[b]) % 256]
  }
  return out
}

// Pure-JS UTF-8 encoder (replaces TextEncoder, which may not exist in
// older Hermes). Handles the full BMP; astral chars are surrogate-encoded
// (query strings here are ASCII/urlencoded in practice).
function utf8Encode (str) {
  const out = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c < 0x80) {
      out.push(c)
    } else if (c < 0x800) {
      out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F))
    } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
      const lo = str.charCodeAt(i + 1)
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        c = 0x10000 + ((c - 0xD800) << 10) + (lo - 0xDC00)
        out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 0x3F),
          0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F))
        i++
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F))
      }
    } else {
      out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F))
    }
  }
  return out
}

// ua_code is hardcoded in the upstream file for the default Chrome UA
// (the same DEFAULT_USER_AGENT in config.js). It does not vary with
// the UA string in this port.
const UA_CODE = [
  76, 98, 15, 131, 97, 245, 224, 133, 122, 199, 241, 166, 79, 34, 90,
  191, 128, 126, 122, 98, 66, 11, 14, 40, 49, 110, 110, 173, 67, 96, 138, 252
]

const BROWSER = '1536|742|1536|864|0|0|0|0|1536|864|1536|864|1536|742|24|24|MacIntel'
const BROWSER_CODE = Array.from(BROWSER, c => c.charCodeAt(0))
const END_STRING = 'cus'

const S4 = 'Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe'

// SM3 of a utf-8 string (or byte array) -> 32-byte int array.
const sm3ToArrayFromStr = (str) => {
  const bytes = typeof str === 'string'
    ? utf8Encode(str)
    : str
  const hex = sm3Hash(bytes)
  const out = new Array(32)
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
// SM3(SM3(str + "cus")) -> 32 bytes
const doubleSm3 = (str) => sm3ToArrayFromStr(sm3ToArrayFromStr(str + END_STRING))

// random_list — `a` truthy uses it, else random()*10000. We always
// pass an explicit number so it's deterministic.
function randomList (a, b, c, d, e, f, g) {
  const r = a || (Math.random() * 10000)
  const ri = Math.trunc(r)
  const v0 = ri & 255
  const v1 = ri >> 8
  return [
    (v0 & b) | d,
    (v0 & c) | e,
    (v1 & b) | f,
    (v1 & c) | g
  ]
}

const list1 = (n) => randomList(n, 170, 85, 1, 2, 5, 45 & 170)
const list2 = (n) => randomList(n, 170, 85, 1, 0, 0, 0)
const list3 = (n) => randomList(n, 170, 85, 1, 0, 5, 0)

// 64-bit-safe byte extraction: floor(v / 2^sh) mod 256 (JS bit shifts
// are 32-bit; timestamps exceed that).
const b256 = (v, sh) => Math.floor(v / Math.pow(2, sh)) % 256

function list4 (a, b, c, d, e, f, g, h, i, j, k, m, n, o, p, q, r) {
  return [
    44, a, 0, 0, 0, 0, 24, b, n, 0, c, d, 0, 0, 0, 1, 0, 239, e, o, f, g,
    0, 0, 0, 0, h, 0, 0, 14, i, j, 0, k, m, 3, p, 1, q, 1, r, 0, 0, 0
  ]
}

const endCheckNum = (arr) => arr.reduce((acc, x) => acc ^ x, 0)

function generateString2Codes (urlParams, method, startTime, endTime) {
  const paramsArray = doubleSm3(urlParams)
  const methodArray = doubleSm3(method)
  const a = list4(
    b256(endTime, 24), paramsArray[21], UA_CODE[23], b256(endTime, 16),
    paramsArray[22], UA_CODE[24], b256(endTime, 8), b256(endTime, 0),
    b256(startTime, 24), b256(startTime, 16), b256(startTime, 8), b256(startTime, 0),
    methodArray[21], methodArray[22],
    Math.floor(endTime / 4294967296), Math.floor(startTime / 4294967296),
    BROWSER.length
  )
  const e = endCheckNum(a)
  const full = a.concat(BROWSER_CODE)
  full.push(e)
  // RC4 with key "y" ([121]); plaintext codes may exceed 255, output
  // is kept as raw code numbers (no 8-bit truncation).
  return rc4([121], full)
}

function generateResult (codes, table) {
  const r = []
  const js = [18, 12, 6, 0]
  const ks = [0xFC0000, 0x03F000, 0x0FC0, 0x3F]
  for (let i = 0; i < codes.length; i += 3) {
    let n
    if (i + 2 < codes.length) n = (codes[i] << 16) | (codes[i + 1] << 8) | codes[i + 2]
    else if (i + 1 < codes.length) n = (codes[i] << 16) | (codes[i + 1] << 8)
    else n = codes[i] << 16
    for (let t = 0; t < 4; t++) {
      const j = js[t]
      if (j === 6 && i + 1 >= codes.length) break
      if (j === 0 && i + 2 >= codes.length) break
      r.push(table[(n & ks[t]) >> j])
    }
  }
  r.push('='.repeat((4 - (r.length % 4)) % 4))
  return r.join('')
}

// Generate the a_bogus value. `urlParams` is the urlencoded query
// string (same bytes that go in the final URL). opts lets tests pin
// time/random; production leaves them undefined for live values.
function getABogus (urlParams, method = 'GET', opts = {}) {
  const r1 = opts.random1 ?? Math.random()
  const r2 = opts.random2 ?? Math.random()
  const r3 = opts.random3 ?? Math.random()
  const startTime = opts.startTime ?? Date.now()
  const endTime = opts.endTime ?? (startTime + Math.floor(Math.random() * 5) + 4)

  const string1 = list1(r1).concat(list2(r2)).concat(list3(r3))
  const string2 = generateString2Codes(urlParams, method, startTime, endTime)
  const codes = string1.concat(string2)
  return generateResult(codes, S4)
}

module.exports = { getABogus }
