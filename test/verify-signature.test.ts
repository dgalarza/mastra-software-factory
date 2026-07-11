import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyGithubSignature } from '../src/lib/verify-signature';

const SECRET = 'test-webhook-secret';

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('verifyGithubSignature', () => {
  const body = JSON.stringify({ action: 'opened', number: 42 });

  it('accepts a valid signature', () => {
    expect(verifyGithubSignature(SECRET, body, sign(body))).toBe(true);
  });

  it('accepts a valid signature over a Buffer body', () => {
    expect(verifyGithubSignature(SECRET, Buffer.from(body), sign(body))).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    expect(verifyGithubSignature(SECRET, body, sign(body, 'wrong-secret'))).toBe(false);
  });

  it('rejects a signature for a different body (tampered payload)', () => {
    const tampered = body.replace('42', '43');
    expect(verifyGithubSignature(SECRET, tampered, sign(body))).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(verifyGithubSignature(SECRET, body, null)).toBe(false);
    expect(verifyGithubSignature(SECRET, body, undefined)).toBe(false);
    expect(verifyGithubSignature(SECRET, body, '')).toBe(false);
  });

  it('rejects a header with the wrong scheme', () => {
    const sha1 = `sha1=${createHmac('sha1', SECRET).update(body).digest('hex')}`;
    expect(verifyGithubSignature(SECRET, body, sha1)).toBe(false);
  });

  it('rejects malformed hex digests', () => {
    expect(verifyGithubSignature(SECRET, body, 'sha256=nothex')).toBe(false);
    expect(verifyGithubSignature(SECRET, body, 'sha256=')).toBe(false);
    expect(verifyGithubSignature(SECRET, body, `sha256=${'ab'.repeat(16)}`)).toBe(false); // truncated
  });

  it('rejects when the secret is empty', () => {
    expect(verifyGithubSignature('', body, sign(body))).toBe(false);
  });
});
