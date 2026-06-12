import { gmail, type gmail_v1 } from '@googleapis/gmail';
import type { OAuth2Client } from 'google-auth-library';
import { isInvalidGrant } from './oauth.js';
import {
  GmailAuthError,
  GmailRateLimitError,
  type GmailDraftRef,
  type GmailHistoryEvent,
  type GmailHistoryPage,
  type GmailProvider,
  type GmailRawMessage,
  type GmailThread,
  HistoryCursorInvalidError,
} from './provider.js';

/**
 * Live Gmail provider — the ONLY module that touches the Gmail SDK, and it
 * implements exclusively the approved read-only operations. There is no send
 * operation here and never will be (BUILD_BRIEF §7.1).
 *
 * Reviewers: any change to this file is safety-critical (see CODEOWNERS).
 */

function mapError(err: unknown): never {
  const status =
    (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
  if (isInvalidGrant(err) || status === 401) {
    throw new GmailAuthError(
      status === 401 ? 'unauthorized' : 'reconnect_required',
      err instanceof Error ? err.message : undefined,
    );
  }
  if (status === 404) {
    // For history listing a 404 means the cursor is too old (Gmail semantics).
    throw new HistoryCursorInvalidError();
  }
  if (status === 429) {
    throw new GmailRateLimitError();
  }
  throw err;
}

export function createLiveGmailProvider(auth: OAuth2Client): GmailProvider {
  const client = gmail({ version: 'v1', auth });
  const userId = 'me';

  return {
    async getProfile() {
      try {
        const { data } = await client.users.getProfile({ userId });
        return { emailAddress: data.emailAddress!, historyId: String(data.historyId!) };
      } catch (err) {
        mapError(err);
      }
    },

    async listHistory(startHistoryId, pageToken) {
      try {
        const { data } = await client.users.history.list({
          userId,
          startHistoryId,
          pageToken,
          historyTypes: ['messageAdded'],
        });
        const events: GmailHistoryEvent[] = [];
        for (const h of data.history ?? []) {
          for (const added of h.messagesAdded ?? []) {
            if (added.message?.id && added.message.threadId) {
              events.push({
                historyId: String(h.id),
                type: 'messageAdded',
                message: { id: added.message.id, threadId: added.message.threadId },
              });
            }
          }
        }
        return {
          events,
          nextPageToken: data.nextPageToken ?? undefined,
          latestHistoryId: String(data.historyId ?? startHistoryId),
        } satisfies GmailHistoryPage;
      } catch (err) {
        mapError(err);
      }
    },

    async getMessage(messageId) {
      try {
        const { data } = await client.users.messages.get({ userId, id: messageId, format: 'full' });
        return data as unknown as GmailRawMessage;
      } catch (err) {
        mapError(err);
      }
    },

    async getThread(threadId) {
      try {
        const { data } = await client.users.threads.get({ userId, id: threadId, format: 'full' });
        return data as unknown as GmailThread;
      } catch (err) {
        mapError(err);
      }
    },

    async listDrafts() {
      try {
        const { data } = await client.users.drafts.list({ userId });
        return (data.drafts ?? [])
          .filter((d): d is gmail_v1.Schema$Draft => Boolean(d.id && d.message?.id))
          .map((d) => ({
            id: d.id!,
            message: { id: d.message!.id!, threadId: d.message!.threadId ?? '' },
          })) satisfies GmailDraftRef[];
      } catch (err) {
        mapError(err);
      }
    },

    async getDraft(draftId) {
      try {
        const { data } = await client.users.drafts.get({ userId, id: draftId });
        return {
          id: data.id!,
          message: { id: data.message!.id!, threadId: data.message!.threadId ?? '' },
        };
      } catch (err) {
        mapError(err);
      }
    },

    async revoke() {
      await auth.revokeCredentials().catch(() => {
        // Best effort: a token that is already invalid cannot be revoked again.
      });
    },
  };
}
