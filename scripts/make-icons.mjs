#!/usr/bin/env node
/**
 * Generate the PWA icons.
 *
 *     node scripts/make-icons.mjs
 *
 * The icons are generated rather than committed as binaries from a design tool
 * for two reasons. First, they stay in step with the app's own colour token — the
 * sidebar colour below is the `--sidebar` value in `src/index.css`, so a change to
 * the brand is one edit and a re-run rather than an export nobody remembers to do.
 * Second, it keeps the repository free of opaque binaries whose provenance
 * nothing records.
 *
 * Written with `zlib` from the standard library rather than an image library: the
 * output is a handful of flat-coloured shapes, and a PNG encoder for that is
 * about forty lines.
 */
import { deflateSync } from "node:zlib"
import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const OUT = join(ROOT, "public")

/** Matches `--sidebar` in src/index.css: 244 40% 11%. */
const INK = [17, 16, 30]
/** Matches `--sidebar-primary`: 262 80% 66%. */
const ACCENT = [140, 105, 246]

function crc32(buf) {
  let c
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c
    }
    return t
  })())
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** Encode RGBA pixel data as a PNG. */
function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // 10..12: compression, filter, interlace — all zero.

  // Each scanline is prefixed with its filter type; 0 means "none", which keeps
  // the encoder trivial and the files small enough that it does not matter.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const at = y * (width * 4 + 1)
    raw[at] = 0
    rgba.copy(raw, at + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

/**
 * The mark: a rounded square in the brand ink, with a ledger-ish glyph — three
 * rows of decreasing width, the third in the accent colour. It reads as "a
 * statement" at 48px on a home screen, which is the only size that matters.
 */
function drawIcon(size, { maskable }) {
  const px = Buffer.alloc(size * size * 4)

  // A maskable icon is cropped to a circle by the launcher, so the artwork is
  // inset to the safe zone (80% of the canvas) and the background bleeds to the
  // edges. Without that, Android masks the corners off the glyph.
  const inset = maskable ? size * 0.14 : 0
  const radius = maskable ? 0 : size * 0.22

  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const at = (y * size + x) * 4
    px[at] = r
    px[at + 1] = g
    px[at + 2] = b
    px[at + 3] = a
  }

  // Rounded-rect background.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside =
        x >= inset && x < size - inset && y >= inset && y < size - inset
      if (!inside) continue
      let on = true
      if (radius > 0) {
        const cx = Math.min(Math.max(x, radius), size - radius)
        const cy = Math.min(Math.max(y, radius), size - radius)
        on = (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
      }
      if (on) set(x, y, INK)
    }
  }

  // Three rows. The last one is the accent, and shorter — a balance that has been
  // partly settled rather than a full page of uniform lines.
  const inner = size - inset * 2
  const barH = Math.max(2, Math.round(inner * 0.1))
  const gap = Math.max(2, Math.round(inner * 0.075))
  const left = inset + inner * 0.18
  const widths = [0.64, 0.46, 0.3]
  let y = inset + inner * 0.26

  widths.forEach((w, i) => {
    const colour = i === 2 ? ACCENT : [235, 234, 245]
    const barW = Math.round(inner * w)
    for (let dy = 0; dy < barH; dy++) {
      for (let dx = 0; dx < barW; dx++) {
        set(Math.round(left) + dx, Math.round(y) + dy, colour)
      }
    }
    y += barH + gap
  })

  return png(size, size, px)
}

mkdirSync(OUT, { recursive: true })
const targets = [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["icon-maskable-512.png", 512, { maskable: true }],
  // A favicon-sized copy, so the browser tab is not a blank square.
  ["favicon-64.png", 64, {}],
]

for (const [name, size, opts] of targets) {
  const file = join(OUT, name)
  writeFileSync(file, drawIcon(size, opts))
  console.log(`wrote public/${name} (${size}x${size})`)
}
