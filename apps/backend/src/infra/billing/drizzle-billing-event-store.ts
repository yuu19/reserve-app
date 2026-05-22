import type { BillingEventStore } from '@repo/saas-billing-core';
import { and, eq, lt } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import * as dbSchema from '../db/schema.js';

const BILLING_PROVIDER_EVENT_SCOPE = 'billing';

export const createDrizzleBillingEventStore = ({
  database,
}: {
  database: AuthRuntimeDatabase;
}): BillingEventStore => ({
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
        id: crypto.randomUUID(),
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
