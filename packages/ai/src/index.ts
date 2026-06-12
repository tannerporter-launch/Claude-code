/**
 * @echoloop/ai
 *
 * Anthropic provider abstraction. AI output is untrusted until
 * schema-validated; invalid output fails safe.
 */
export const PACKAGE_NAME = '@echoloop/ai';

export * from './provider.js';
export * from './live.js';
export * from './mock.js';
