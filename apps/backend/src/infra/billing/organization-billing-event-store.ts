import type {
  BillingEventStore,
  BillingProviderCode,
  ProviderEventClaimResult,
} from '@repo/saas-billing-core';
import { and, eq } from 'drizzle-orm';
import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import * as dbSchema from '../db/schema.js';

const scopeForProvider = (provider: BillingProviderCode) =>
  provider === 'stripe' ? 'organization_billing' : provider;

export const createOrganizationBillingEventStore = (
  database: AuthRuntimeDatabase,
): BillingEventStore => ({
  async claimProviderEvent({
    provider,
    providerEventId,
    eventType,
    now,
    staleProcessingAfterMs,
  }): Promise<ProviderEventClaimResult> {
    const scope = scopeForProvider(provider);
    const insertedRows = await database
      .insert(dbSchema.stripeWebhookEvent)
      .values({
        id: providerEventId,
        eventType,
        scope,
        processingStatus: 'processing',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: dbSchema.stripeWebhookEvent.id });

    if (insertedRows[0]) {
      return { kind: 'claimed', attempt: 1 };
    }

    const existingRows = await database
      .select({
        processingStatus: dbSchema.stripeWebhookEvent.processingStatus,
        createdAt: dbSchema.stripeWebhookEvent.createdAt,
      })
      .from(dbSchema.stripeWebhookEvent)
      .where(
        and(
          eq(dbSchema.stripeWebhookEvent.id, providerEventId),
          eq(dbSchema.stripeWebhookEvent.scope, scope),
        ),
      )
      .limit(1);
    const existing = existingRows[0];
    if (!existing) {
      return { kind: 'claimed', attempt: 1 };
    }

    if (existing.processingStatus === 'processed') {
      return { kind: 'already_processed' };
    }

    const staleBefore = new Date(now.getTime() - staleProcessingAfterMs);
    if (existing.processingStatus === 'failed' || existing.createdAt < staleBefore) {
      await database
        .update(dbSchema.stripeWebhookEvent)
        .set({
          processingStatus: 'processing',
          failureReason: null,
          processedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(dbSchema.stripeWebhookEvent.id, providerEventId),
            eq(dbSchema.stripeWebhookEvent.scope, scope),
          ),
        );
      return { kind: 'already_processing_stale_claimed', attempt: 1 };
    }

    return { kind: 'already_processing_fresh' };
  },

  async markProviderEventProcessed({ provider, providerEventId, processedAt }) {
    await database
      .update(dbSchema.stripeWebhookEvent)
      .set({
        processingStatus: 'processed',
        processedAt,
        receiptStatus: 'processed',
        updatedAt: processedAt,
      })
      .where(
        and(
          eq(dbSchema.stripeWebhookEvent.id, providerEventId),
          eq(dbSchema.stripeWebhookEvent.scope, scopeForProvider(provider)),
        ),
      );
  },

  async markProviderEventFailed({ provider, providerEventId, failedAt, errorMessage }) {
    await database
      .update(dbSchema.stripeWebhookEvent)
      .set({
        processingStatus: 'failed',
        failureReason: errorMessage,
        receiptStatus: 'failed',
        updatedAt: failedAt,
      })
      .where(
        and(
          eq(dbSchema.stripeWebhookEvent.id, providerEventId),
          eq(dbSchema.stripeWebhookEvent.scope, scopeForProvider(provider)),
        ),
      );
  },
});
