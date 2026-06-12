/**
 * @echoloop/gmail
 *
 * Gmail provider abstraction. MUST NOT expose any send operation
 * (BUILD_BRIEF §7.1 — enforced by the static no-send test). Phase 2 surface
 * is read-only; createDraft arrives in Phase 6.
 */
export const PACKAGE_NAME = '@echoloop/gmail';

export * from './provider.js';
export * from './oauth.js';
export * from './mime.js';
export * from './live.js';
export * from './mock.js';
export * from './mimeBuilder.js';
