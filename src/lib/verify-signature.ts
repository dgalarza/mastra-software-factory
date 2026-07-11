import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a GitHub webhook signature (X-Hub-Signature-256).
 *
 * GitHub signs the raw request body with HMAC-SHA256 using the webhook
 * secret and sends it as `sha256=<hex digest>`. Verification must run on
 * the raw body bytes — parsing and re-serializing JSON changes the bytes
 * and breaks the signature.
 */
export function verifyGithubSignature(
  secret: string,
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
): boolean {
  if (!secret || !signatureHeader) return false;
  if (!signatureHeader.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = signatureHeader.slice('sha256='.length);

  const expectedBuf = Buffer.from(expected, 'hex');
  // Buffer.from(_, 'hex') stops at the first non-hex character, so malformed
  // input yields a short buffer. timingSafeEqual throws on length mismatch;
  // a wrong-length signature is simply invalid, and the digest length is
  // public, so this check leaks nothing.
  const receivedBuf = Buffer.from(received, 'hex');
  if (receivedBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(expectedBuf, receivedBuf);
}
