// Generates the RSA signing key and prints the private JWK on stdout so it can be
// piped straight into `wrangler secret put JWT_PRIVATE_KEY`. Nothing is written to
// disk, so the private key never lands in the repository.
import { webcrypto } from "node:crypto";

const pair = await webcrypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);

const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
process.stdout.write(JSON.stringify(jwk));
