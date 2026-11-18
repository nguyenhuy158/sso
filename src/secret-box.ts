const IV_BYTES = 12;
const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromBase64Url = (input: string): Uint8Array => {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(
    atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
    (c) => c.charCodeAt(0),
  );
};

async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** AES-GCM with a random IV; the result is `base64url(iv || ciphertext)`. */
export async function seal(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await aesKey(secret),
      encoder.encode(plain),
    ),
  );
  const out = new Uint8Array(IV_BYTES + cipher.length);
  out.set(iv);
  out.set(cipher, IV_BYTES);
  return toBase64Url(out);
}

/** Returns null when the secret is wrong or the data was changed. */
export async function open(
  secret: string,
  sealed: string,
): Promise<string | null> {
  try {
    const bytes = fromBase64Url(sealed);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, IV_BYTES) },
      await aesKey(secret),
      bytes.slice(IV_BYTES),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
