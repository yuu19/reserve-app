import type { BillingEventStore } from '@repo/saas-billing-core';
import { and, eq, lt } from 'drizzle-orm';
import type { DrizzleBillingDatabase } from './database.js';
import * as dbSchema from './schema.js';

const BILLING_PROVIDER_EVENT_SCOPE = 'billing';

/** 決済プロバイダー webhook event の永続化処理を構成する依存。 */
export type DrizzleBillingEventStoreOptions = {
  /** billing_provider_event table を含む Drizzle database。 */
  database: DrizzleBillingDatabase;
  /** 新規の決済プロバイダーイベント row の ID を生成する関数。未指定時は `crypto.randomUUID()`。 */
  createId?: () => string;
  /** 互換用の時刻取得関数。処理権取得時刻は core の input.now を優先する。 */
  now?: () => Date;
};

/**
 * Drizzle schema 上に決済プロバイダー webhook event の冪等な処理権取得を扱う永続化処理を作る。
 *
 * @param input.database billing_provider_event table を含む Drizzle database。
 * @param input.createId 新規の決済プロバイダーイベント row の ID を生成する関数。
 * @returns `BillingEventStore` の実装。
 */
export const createDrizzleBillingEventStore = ({
  database,
  createId = () => crypto.randomUUID(),
}: DrizzleBillingEventStoreOptions): BillingEventStore => ({
  async claimProviderEvent({
    provider,
    providerEventId,
    eventType,
    payloadHash,
    now,
    staleProcessingAfterMs,
  }) {
    const insertedRows = await database
      .insert(dbSchema.billingProviderEvent)
      .values({
        id: createId(),
        provider,
        providerEventId,
        eventType,
        scope: BILLING_PROVIDER_EVENT_SCOPE,
        payloadHash,
        processingStatus: 'processing',
        receiptStatus: 'received',
        attemptCount: 1,
        processingStartedAt: now,
        lastAttemptAt: now,
        processingStaleAfterMs: staleProcessingAfterMs,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({
        attemptCount: dbSchema.billingProviderEvent.attemptCount,
      });

    if (insertedRows[0]) {
      return {
        kind: 'claimed',
        attempt: insertedRows[0].attemptCount,
      };
    }

    const rows = await database
      .select()
      .from(dbSchema.billingProviderEvent)
      .where(
        and(
          eq(dbSchema.billingProviderEvent.provider, provider),
          eq(dbSchema.billingProviderEvent.providerEventId, providerEventId),
          eq(dbSchema.billingProviderEvent.scope, BILLING_PROVIDER_EVENT_SCOPE),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) {
      return {
        kind: 'claimed',
        attempt: 1,
      };
    }

    if (existing.processingStatus === 'processed') {
      await database
        .update(dbSchema.billingProviderEvent)
        .set({
          duplicateDetected: true,
          duplicateDetectedAt: now,
          receiptStatus: 'duplicate',
          lastAttemptAt: now,
          updatedAt: now,
        })
        .where(eq(dbSchema.billingProviderEvent.id, existing.id));
      return { kind: 'already_processed' };
    }

    const staleBefore = new Date(now.getTime() - staleProcessingAfterMs);
    const isFailedRetry = existing.processingStatus === 'failed';
    const isStaleProcessing =
      existing.processingStatus === 'processing' &&
      (!existing.processingStartedAt ||
        existing.processingStartedAt.getTime() <= staleBefore.getTime());

    // 失敗済み event は再試行し、古い処理中状態は同じ決済プロバイダーイベントの処理権を取り直す。
    if (isFailedRetry || isStaleProcessing) {
      const nextAttempt = existing.attemptCount + 1;
      await database
        .update(dbSchema.billingProviderEvent)
        .set({
          payloadHash,
          processingStatus: 'processing',
          receiptStatus: isFailedRetry ? 'received' : 'duplicate_processing',
          duplicateDetected: isStaleProcessing,
          duplicateDetectedAt: isStaleProcessing ? now : existing.duplicateDetectedAt,
          attemptCount: nextAttempt,
          processingStartedAt: now,
          lastAttemptAt: now,
          processingStaleAfterMs: staleProcessingAfterMs,
          failureReason: null,
          updatedAt: now,
          processedAt: null,
        })
        .where(eq(dbSchema.billingProviderEvent.id, existing.id));
      return {
        kind: 'already_processing_stale_claimed',
        attempt: nextAttempt,
      };
    }

    await database
      .update(dbSchema.billingProviderEvent)
      .set({
        duplicateDetected: true,
        duplicateDetectedAt: now,
        receiptStatus: 'duplicate_processing',
        lastAttemptAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(dbSchema.billingProviderEvent.id, existing.id),
          eq(dbSchema.billingProviderEvent.processingStatus, 'processing'),
          lt(dbSchema.billingProviderEvent.processingStartedAt, now),
        ),
      );

    return { kind: 'already_processing_fresh' };
  },

  async markProviderEventProcessed({ provider, providerEventId, processedAt }) {
    await database
      .update(dbSchema.billingProviderEvent)
      .set({
        processingStatus: 'processed',
        receiptStatus: 'processed',
        failureReason: null,
        processedAt,
        updatedAt: processedAt,
      })
      .where(
        and(
          eq(dbSchema.billingProviderEvent.provider, provider),
          eq(dbSchema.billingProviderEvent.providerEventId, providerEventId),
          eq(dbSchema.billingProviderEvent.scope, BILLING_PROVIDER_EVENT_SCOPE),
        ),
      );
  },

  async markProviderEventFailed({ provider, providerEventId, failedAt, errorMessage }) {
    await database
      .update(dbSchema.billingProviderEvent)
      .set({
        processingStatus: 'failed',
        receiptStatus: 'received',
        failureReason: errorMessage,
        lastFailureReason: errorMessage,
        lastFailureAt: failedAt,
        lastAttemptAt: failedAt,
        updatedAt: failedAt,
        processedAt: null,
      })
      .where(
        and(
          eq(dbSchema.billingProviderEvent.provider, provider),
          eq(dbSchema.billingProviderEvent.providerEventId, providerEventId),
          eq(dbSchema.billingProviderEvent.scope, BILLING_PROVIDER_EVENT_SCOPE),
        ),
      );
  },
});
