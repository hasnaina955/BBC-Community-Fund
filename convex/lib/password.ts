/**
 * Password hashing for the Convex Auth Password provider.
 *
 * PBKDF2-SHA256 via Web Crypto, which the Convex runtime provides. The hash
 * format is self-describing so iterations can be raised later without
 * invalidating existing hashes:
 *
 *   pbkdf2-sha256$<iterations>$<saltBase64>$<hashBase64>
 *
 * This replaces the legacy `password` + `hash` + `salt` columns, which stored
 * credentials in the same table the app read from. See docs/RECOVERY.md.
 */

const ALGORITHM = "pbkdf2-sha256"
const ITERATIONS = 210_000
const KEY_BITS = 256
const SALT_BYTES = 16

const encoder = new TextEncoder()

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

/** Constant-time comparison, so a wrong hash cannot be found byte by byte. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function hashSecret(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derive(password, salt, ITERATIONS)
  return [
    ALGORITHM,
    String(ITERATIONS),
    toBase64(salt),
    toBase64(hash),
  ].join("$")
}

export async function verifySecret(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$")
  if (parts.length !== 4) return false

  const [algorithm, iterationsRaw, saltB64, hashB64] = parts
  if (algorithm !== ALGORITHM) return false

  const iterations = Number(iterationsRaw)
  if (!Number.isFinite(iterations) || iterations <= 0) return false

  try {
    const salt = fromBase64(saltB64)
    const expected = fromBase64(hashB64)
    const actual = await derive(password, salt, iterations)
    return timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

/** Mirrors the provider's default rule: at least 8 characters. */
export function validatePasswordRequirements(password: string): void {
  if (!password) throw new Error("Password is required")
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters")
  }
}
