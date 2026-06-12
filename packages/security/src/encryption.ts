import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Authenticated symmetric encryption for data at rest (OAuth tokens, retained
 * email bodies, context snapshots). AES-256-GCM with a random 96-bit IV per
 * value. The stored envelope is:
 *
 *   v1:<base64 iv>:<base64 authTag>:<base64 ciphertext>
 *
 * The GCM auth tag makes tampering and wrong-key use fail closed on decrypt.
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface EncryptionService {
  encrypt(plaintext: string): string;
  decrypt(envelope: string): string;
}

function decodeKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be ${KEY_BYTES} bytes (got ${key.length})`);
  }
  return key;
}

export function createEncryptionService(keyBase64: string): EncryptionService {
  const key = decodeKey(keyBase64);

  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return [
        VERSION,
        iv.toString('base64'),
        authTag.toString('base64'),
        ciphertext.toString('base64'),
      ].join(':');
    },

    decrypt(envelope: string): string {
      const parts = envelope.split(':');
      if (parts.length !== 4 || parts[0] !== VERSION) {
        throw new Error('Malformed encryption envelope');
      }
      const [, ivB64, tagB64, ctB64] = parts;
      const iv = Buffer.from(ivB64!, 'base64');
      const authTag = Buffer.from(tagB64!, 'base64');
      const ciphertext = Buffer.from(ctB64!, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      // .final() throws if the auth tag does not verify (tampering / wrong key).
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    },
  };
}

/** Generate a fresh base64-encoded 32-byte key (for local/test setup only). */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}
