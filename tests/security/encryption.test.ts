import { createEncryptionService, generateEncryptionKey } from '@echoloop/security';
import { describe, expect, it } from 'vitest';

describe('encryption service', () => {
  const key = generateEncryptionKey();
  const enc = createEncryptionService(key);

  it('round-trips plaintext', () => {
    const plaintext = 'sensitive oauth refresh token';
    const envelope = enc.encrypt(plaintext);
    expect(envelope).not.toContain(plaintext);
    expect(envelope.startsWith('v1:')).toBe(true);
    expect(enc.decrypt(envelope)).toBe(plaintext);
  });

  it('produces a different envelope each time (random IV)', () => {
    expect(enc.encrypt('same')).not.toBe(enc.encrypt('same'));
  });

  it('fails closed on tampered ciphertext', () => {
    const envelope = enc.encrypt('value');
    const parts = envelope.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => enc.decrypt(parts.join(':'))).toThrow();
  });

  it('fails closed with the wrong key', () => {
    const envelope = enc.encrypt('value');
    const other = createEncryptionService(generateEncryptionKey());
    expect(() => other.decrypt(envelope)).toThrow();
  });

  it('rejects a key of the wrong length', () => {
    expect(() => createEncryptionService(Buffer.alloc(16).toString('base64'))).toThrow();
  });
});
