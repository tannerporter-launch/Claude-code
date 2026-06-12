import { createLogger, redact } from '@echoloop/security';
import { describe, expect, it } from 'vitest';

describe('redacting logger', () => {
  it('redacts sensitive keys recursively', () => {
    const out = redact({
      ok: 'visible',
      accessToken: 'secret-token',
      nested: { refresh_token: 'r', bodyText: 'raw email body', address: 'a@b.com' },
      list: [{ password: 'p' }, { fine: 1 }],
    }) as Record<string, unknown>;

    const serialized = JSON.stringify(out);
    expect(out.ok).toBe('visible');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('raw email body');
    expect(serialized).not.toContain('a@b.com');
    expect(serialized).not.toContain('"p"');
    expect(serialized).toContain('[REDACTED]');
  });

  it('emits structured JSON with redaction applied', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });
    logger.info('connected', { provider: 'gmail', refreshToken: 'should-not-appear' });

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record.level).toBe('info');
    expect(record.message).toBe('connected');
    expect(record.provider).toBe('gmail');
    expect(record.refreshToken).toBe('[REDACTED]');
    expect(lines[0]).not.toContain('should-not-appear');
  });

  it('handles circular references safely', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => JSON.stringify(redact(obj))).not.toThrow();
  });
});
