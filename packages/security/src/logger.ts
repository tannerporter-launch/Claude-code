/**
 * Structured logger with field-level redaction. Raw email bodies, addresses,
 * tokens, prompts, and credentials must never reach logs (BUILD_BRIEF §12).
 * Redaction is applied by key name, recursively, before serialization.
 */

const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /authorization/i,
  /password/i,
  /secret/i,
  /encryption[_-]?key/i,
  /\bbody\b/i,
  /body[_-]?text/i,
  /raw[_-]?body/i,
  /prompt/i,
  /from[_-]?addr/i,
  /to[_-]?addr/i,
  /cc[_-]?addr/i,
  /\bemail\b/i,
  /address/i,
  /recipient/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value as object)) {
    return '[Circular]';
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(child, seen);
  }
  return out;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  /** Sink for serialized log lines. Defaults to console.log. */
  sink?: (line: string) => void;
  /** Static fields merged (and redacted) into every record. */
  base?: Record<string, unknown>;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const sink = options.sink ?? ((line: string) => console.log(line));
  const base = options.base ?? {};

  function emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    const record = {
      level,
      time: new Date().toISOString(),
      message,
      ...(redact({ ...base, ...fields }) as Record<string, unknown>),
    };
    sink(JSON.stringify(record));
  }

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
  };
}
