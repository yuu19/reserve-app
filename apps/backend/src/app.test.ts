import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/d1';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from './app/create-app.js';
import { createAuthRuntime } from './auth-runtime.js';
import {
  completeExpiredOrganizationPremiumTrials,
  reconcileProviderLinkedOrganizationBillingStates,
  reconcileRiskyOrganizationBillingStates,
} from './domain/billing/organization-billing-maintenance.js';
import { sendDueBookingReminders } from './features/booking/booking-reminders.js';
import {
  syncReserveAppBillingV2DerivedState,
  upsertReserveAppBillingV2SubscriptionState,
} from './infra/billing/reserve-app-billing-v2-source.js';

type D1DatabaseBinding = Awaited<ReturnType<Miniflare['getD1Database']>>;

let app: ReturnType<typeof createApp>;
let mf: Miniflare;
let d1: D1DatabaseBinding;
const currentDir = path.dirname(fileURLToPath(import.meta.url));

const splitSetCookieHeader = (header: string): string[] => {
  return header.split(/,(?=[^;,\s]+=)/g).map((value) => value.trim());
};

const getSetCookieValues = (response: Response): string[] => {
  const headersWithGetSetCookie = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof headersWithGetSetCookie.getSetCookie === 'function') {
    return headersWithGetSetCookie.getSetCookie();
  }

  const setCookieHeader = response.headers.get('set-cookie');
  return setCookieHeader ? splitSetCookieHeader(setCookieHeader) : [];
};

const createAuthAgent = (application: ReturnType<typeof createApp>) => {
  const cookieJar = new Map<string, string>();

  const refreshCookieHeader = () => {
    return Array.from(cookieJar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  };

  const applyResponseCookies = (response: Response) => {
    for (const setCookie of getSetCookieValues(response)) {
      const firstPart = setCookie.split(';', 1)[0];
      const separator = firstPart.indexOf('=');
      if (separator <= 0) {
        continue;
      }

      const name = firstPart.slice(0, separator);
      const value = firstPart.slice(separator + 1);
      cookieJar.set(name, value);
    }
  };

  const resolveDefaultStoreSlug = async (organizationId: string, storeId?: string | null) => {
    const row = await d1
      .prepare(
        `SELECT organization.slug AS orgSlug, store.slug AS storeSlug
         FROM organization
         INNER JOIN store ON store.organization_id = organization.id
         WHERE organization.id = ?
           AND (? IS NULL OR store.id = ?)
         ORDER BY
           CASE
             WHEN store.slug = organization.slug THEN 0
             WHEN store.id = organization.id THEN 1
             ELSE 2
           END,
           store.created_at ASC
         LIMIT 1`,
      )
      .bind(organizationId, storeId ?? null, storeId ?? null)
      .first<{ orgSlug: string; storeSlug: string }>();

    return row ?? null;
  };

  const resolveStoreSlugByResource = async (
    tableName:
      | 'service'
      | 'slot'
      | 'recurring_schedule'
      | 'booking'
      | 'participant'
      | 'ticket_type'
      | 'ticket_pack'
      | 'ticket_purchase',
    resourceId: string,
  ) => {
    const row = await d1
      .prepare(
        `SELECT organization.slug AS orgSlug, store.slug AS storeSlug
         FROM ${tableName}
         INNER JOIN organization ON organization.id = ${tableName}.organization_id
         INNER JOIN store ON store.id = ${tableName}.store_id
         WHERE ${tableName}.id = ?
         LIMIT 1`,
      )
      .bind(resourceId)
      .first<{ orgSlug: string; storeSlug: string }>();

    return row ?? null;
  };

  const resolveStoreSlugByLegacyResource = async (
    url: URL,
    bodyPayload: Record<string, unknown> | null,
  ) => {
    const readString = (key: string): string | null => {
      const queryValue = url.searchParams.get(key);
      if (queryValue) {
        return queryValue;
      }
      const bodyValue = bodyPayload?.[key];
      return typeof bodyValue === 'string' && bodyValue.length > 0 ? bodyValue : null;
    };

    const resourceLookups: Array<{
      key: string;
      tableName: Parameters<typeof resolveStoreSlugByResource>[0];
    }> = [
      { key: 'serviceId', tableName: 'service' },
      { key: 'slotId', tableName: 'slot' },
      { key: 'recurringScheduleId', tableName: 'recurring_schedule' },
      { key: 'bookingId', tableName: 'booking' },
      { key: 'ticketTypeId', tableName: 'ticket_type' },
      { key: 'ticketPackId', tableName: 'ticket_pack' },
      { key: 'purchaseId', tableName: 'ticket_purchase' },
      { key: 'participantId', tableName: 'participant' },
    ];

    for (const { key, tableName } of resourceLookups) {
      const resourceId = readString(key);
      if (!resourceId) {
        continue;
      }
      const scopedStore = await resolveStoreSlugByResource(tableName, resourceId);
      if (scopedStore) {
        return scopedStore;
      }
    }

    return null;
  };

  const normalizeLegacyReservationRequest = async (
    input: string,
    init: RequestInit,
  ): Promise<{ input: string; init: RequestInit }> => {
    const url = new URL(input, 'http://localhost');
    const legacyPrefix = '/api/v1/auth/organizations';
    if (!url.pathname.startsWith(legacyPrefix)) {
      return { input, init };
    }

    const suffix = url.pathname.slice(legacyPrefix.length);
    if (suffix.startsWith('/services/images/upload/')) {
      return {
        input: `/api/v1/auth/services/images/upload/${suffix.slice('/services/images/upload/'.length)}${url.search}`,
        init,
      };
    }
    if (suffix.startsWith('/services/images/')) {
      return {
        input: `/api/v1/auth/services/images/${suffix.slice('/services/images/'.length)}${url.search}`,
        init,
      };
    }

    const legacyReservationPrefixes = [
      '/participants',
      '/services',
      '/slots',
      '/recurring-schedules',
      '/bookings',
      '/ticket-types',
      '/ticket-packs',
      '/ticket-purchases',
    ] as const;
    if (!legacyReservationPrefixes.some((prefix) => suffix.startsWith(prefix))) {
      return { input, init };
    }

    let bodyPayload: Record<string, unknown> | null = null;
    if (typeof init.body === 'string' && init.body.trim().length > 0) {
      try {
        const parsed = JSON.parse(init.body) as unknown;
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          bodyPayload = parsed as Record<string, unknown>;
        }
      } catch {
        bodyPayload = null;
      }
    }

    const organizationId =
      url.searchParams.get('organizationId') ??
      (typeof bodyPayload?.organizationId === 'string' ? bodyPayload.organizationId : null);
    const storeId =
      url.searchParams.get('storeId') ??
      (typeof bodyPayload?.storeId === 'string' ? bodyPayload.storeId : null);
    const scopedStore = organizationId
      ? await resolveDefaultStoreSlug(organizationId, storeId)
      : await resolveStoreSlugByLegacyResource(url, bodyPayload);
    if (!scopedStore) {
      return { input, init };
    }

    url.searchParams.delete('organizationId');
    url.searchParams.delete('storeId');

    const nextInit = { ...init };
    if (bodyPayload) {
      const { organizationId: _organizationId, storeId: _storeId, ...nextBody } = bodyPayload;
      nextInit.body = JSON.stringify(nextBody);
    }

    return {
      input: `/api/v1/auth/orgs/${encodeURIComponent(scopedStore.orgSlug)}/stores/${encodeURIComponent(
        scopedStore.storeSlug,
      )}${suffix}${url.search}`,
      init: nextInit,
    };
  };

  const request = async (input: string, init: RequestInit = {}) => {
    const normalized = await normalizeLegacyReservationRequest(input, init);
    const headers = new Headers(init.headers);
    const cookieHeader = refreshCookieHeader();
    if (cookieHeader.length > 0) {
      headers.set('cookie', cookieHeader);
    }

    const response = await application.request(normalized.input, {
      ...normalized.init,
      headers,
    });

    applyResponseCookies(response);
    return response;
  };

  return { request };
};

const toJson = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const createStripeSignatureHeader = async (payload: string, secret: string, timestamp?: number) => {
  const signatureTimestamp = timestamp ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${signatureTimestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedPayload),
  );
  const signature = toHex(signatureBuffer);
  return `t=${signatureTimestamp},v1=${signature}`;
};

const selectInvitationStatus = async (invitationId: string) => {
  const row = await d1
    .prepare('SELECT status FROM invitation WHERE id = ?')
    .bind(invitationId)
    .first<{ status: string }>();

  return row?.status ?? null;
};

const selectInvitationActionCount = async (invitationId: string, action: string) => {
  const row = await d1
    .prepare(
      'SELECT COUNT(*) as count FROM invitation_audit_log WHERE invitation_id = ? AND action = ?',
    )
    .bind(invitationId, action)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
};

const selectParticipantInvitationStatus = async (invitationId: string) => {
  const row = await d1
    .prepare("SELECT status FROM invitation WHERE id = ? AND subject_kind = 'participant'")
    .bind(invitationId)
    .first<{ status: string }>();

  return row?.status ?? null;
};

const selectParticipantInvitationActionCount = async (invitationId: string, action: string) => {
  const row = await d1
    .prepare(
      'SELECT COUNT(*) as count FROM invitation_audit_log WHERE invitation_id = ? AND action = ?',
    )
    .bind(invitationId, action)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
};

const selectParticipantCountByEmail = async (organizationId: string, email: string) => {
  const row = await d1
    .prepare('SELECT COUNT(*) as count FROM participant WHERE organization_id = ? AND email = ?')
    .bind(organizationId, email)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
};

const selectParticipantIdByEmail = async (organizationId: string, email: string) => {
  const row = await d1
    .prepare('SELECT id FROM participant WHERE organization_id = ? AND email = ? LIMIT 1')
    .bind(organizationId, email)
    .first<{ id: string }>();

  return row?.id ?? null;
};

const selectSlotReservedCount = async (slotId: string) => {
  const row = await d1
    .prepare('SELECT reserved_count as reservedCount FROM slot WHERE id = ?')
    .bind(slotId)
    .first<{ reservedCount: number | string }>();

  return Number(row?.reservedCount ?? 0);
};

const selectBookingStatus = async (bookingId: string) => {
  const row = await d1
    .prepare('SELECT status FROM booking WHERE id = ?')
    .bind(bookingId)
    .first<{ status: string }>();

  return row?.status ?? null;
};

const selectBookingSlotId = async (bookingId: string) => {
  const row = await d1
    .prepare('SELECT slot_id as slotId FROM booking WHERE id = ?')
    .bind(bookingId)
    .first<{ slotId: string }>();

  return row?.slotId ?? null;
};

const selectBookingAttendance = async (bookingId: string) => {
  const row = await d1
    .prepare(
      'SELECT attendance_status as attendanceStatus, attendance_marked_at as attendanceMarkedAt, attendance_marked_by_user_id as attendanceMarkedByUserId FROM booking WHERE id = ?',
    )
    .bind(bookingId)
    .first<{
      attendanceStatus: string;
      attendanceMarkedAt: number | string | null;
      attendanceMarkedByUserId: string | null;
    }>();

  return row ?? null;
};

const selectBookingChangeLogCount = async (bookingId: string) => {
  const row = await d1
    .prepare('SELECT COUNT(*) as count FROM booking_change_log WHERE booking_id = ?')
    .bind(bookingId)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
};

const selectNotificationLogEventCount = async (bookingId: string, eventType: string) => {
  const row = await d1
    .prepare(
      'SELECT COUNT(*) as count FROM notification_log WHERE booking_id = ? AND event_type = ?',
    )
    .bind(bookingId, eventType)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
};

const selectBookingByPublicId = async (publicId: string) => {
  return d1
    .prepare(
      'SELECT id, public_id as publicId, participant_id as participantId, source, customer_name as customerName, customer_email as customerEmail, customer_phone as customerPhone, participants_count as participantsCount, status FROM booking WHERE public_id = ? LIMIT 1',
    )
    .bind(publicId)
    .first<{
      id: string;
      publicId: string;
      participantId: string | null;
      source: string;
      customerName: string | null;
      customerEmail: string | null;
      customerPhone: string | null;
      participantsCount: number | string;
      status: string;
    }>();
};

const selectFormAnswerRowsByBooking = async (bookingId: string) => {
  const rows = await d1
    .prepare(
      `SELECT
         form_submissions.form_template_id as formTemplateId,
         form_submissions.form_template_version_id as formTemplateVersionId,
         form_submissions.form_type as formType,
         form_submissions.source as source,
         form_submissions.customer_name_snapshot as customerNameSnapshot,
         form_submissions.customer_email_snapshot as customerEmailSnapshot,
         form_answers.field_key as fieldKey,
         form_answers.field_type as fieldType,
         form_answers.label_snapshot as labelSnapshot,
         form_answers.value_json as valueJson
       FROM form_submissions
       INNER JOIN form_answers ON form_answers.form_submission_id = form_submissions.id
       WHERE form_submissions.booking_id = ?
       ORDER BY form_submissions.created_at ASC, form_answers.sort_order ASC`,
    )
    .bind(bookingId)
    .all<{
      formTemplateId: string;
      formTemplateVersionId: string;
      formType: string;
      source: string;
      customerNameSnapshot: string | null;
      customerEmailSnapshot: string | null;
      fieldKey: string;
      fieldType: string;
      labelSnapshot: string;
      valueJson: string;
    }>();

  return rows.results ?? [];
};

const hashPublicActionTokenForTest = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(digest);
};

const insertPublicCancelTokenForTest = async ({
  bookingId,
  token,
  emailSnapshot,
  expiresAt,
}: {
  bookingId: string;
  token: string;
  emailSnapshot: string;
  expiresAt: Date;
}) => {
  await d1
    .prepare(
      "INSERT INTO booking_public_action_token (id, booking_id, purpose, token_hash, email_snapshot, expires_at) VALUES (?, ?, 'cancel', ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      bookingId,
      await hashPublicActionTokenForTest(token),
      emailSnapshot,
      expiresAt.getTime(),
    )
    .run();
};

const selectTicketPackRemaining = async (ticketPackId: string) => {
  const row = await d1
    .prepare('SELECT remaining_count as remainingCount FROM ticket_pack WHERE id = ?')
    .bind(ticketPackId)
    .first<{ remainingCount: number | string }>();

  return Number(row?.remainingCount ?? 0);
};

const selectTicketPackRow = async (ticketPackId: string) => {
  return d1
    .prepare(
      'SELECT id, service_ids_json as serviceIdsJson, initial_count as initialCount, remaining_count as remainingCount, expires_at as expiresAt, status FROM ticket_pack WHERE id = ? LIMIT 1',
    )
    .bind(ticketPackId)
    .first<{
      id: string;
      serviceIdsJson: string | null;
      initialCount: number | string;
      remainingCount: number | string;
      expiresAt: number | string | null;
      status: string;
    }>();
};

const selectTicketLedgerActionCount = async (ticketPackId: string, action: string) => {
  const row = await d1
    .prepare('SELECT COUNT(*) as count FROM ticket_ledger WHERE ticket_pack_id = ? AND action = ?')
    .bind(ticketPackId, action)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
};

const selectTicketPurchaseRow = async (purchaseId: string) => {
  return d1
    .prepare(
      'SELECT id, participant_id as participantId, ticket_type_id as ticketTypeId, service_ids_json as serviceIdsJson, payment_method as paymentMethod, status, ticket_pack_id as ticketPackId, stripe_checkout_session_id as stripeCheckoutSessionId FROM ticket_purchase WHERE id = ? LIMIT 1',
    )
    .bind(purchaseId)
    .first<{
      id: string;
      participantId: string;
      ticketTypeId: string;
      serviceIdsJson: string | null;
      paymentMethod: string;
      status: string;
      ticketPackId: string | null;
      stripeCheckoutSessionId: string | null;
    }>();
};

const countTicketPurchasesForParticipantAndType = async (
  participantId: string,
  ticketTypeId: string,
) => {
  const row = await d1
    .prepare(
      'SELECT COUNT(*) as count FROM ticket_purchase WHERE participant_id = ? AND ticket_type_id = ?',
    )
    .bind(participantId, ticketTypeId)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
};

const ensureBillingFixtureAccountId = async (
  organizationId: string,
  stripeCustomerId: string | null = null,
) => {
  const existing = await d1
    .prepare(
      "SELECT id FROM billing_account WHERE subject_type = 'organization' AND subject_id = ? LIMIT 1",
    )
    .bind(organizationId)
    .first<{ id: string }>();

  if (existing?.id) {
    if (stripeCustomerId) {
      await d1
        .prepare('UPDATE billing_account SET provider_customer_id = ?, updated_at = ? WHERE id = ?')
        .bind(stripeCustomerId, Date.now(), existing.id)
        .run();
    }
    return existing.id;
  }

  const accountId = crypto.randomUUID();
  await d1
    .prepare(
      'INSERT INTO billing_account (id, subject_type, subject_id, provider, provider_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      accountId,
      'organization',
      organizationId,
      'stripe',
      stripeCustomerId,
      Date.now(),
      Date.now(),
    )
    .run();
  return accountId;
};

const selectBillingFixtureSubscriptionId = async (organizationId: string) => {
  const row = await d1
    .prepare(
      "SELECT s.id FROM billing_subscription s INNER JOIN billing_account a ON a.id = s.billing_account_id WHERE a.subject_type = 'organization' AND a.subject_id = ? ORDER BY s.updated_at DESC LIMIT 1",
    )
    .bind(organizationId)
    .first<{ id: string }>();
  return row?.id ?? null;
};

const selectOrganizationBillingRow = async (organizationId: string) => {
  return d1
    .prepare(
      "SELECT s.plan_code as planCode, a.provider_customer_id as stripeCustomerId, s.provider_subscription_id as stripeSubscriptionId, s.price_code as stripePriceId, s.interval as billingInterval, s.status as subscriptionStatus, s.cancel_at_period_end as cancelAtPeriodEnd, s.trial_start as trialStartedAt, CASE WHEN s.trial_start IS NOT NULL AND s.status != 'trialing' THEN s.trial_end ELSE NULL END as trialEndedAt, s.current_period_start as currentPeriodStart, s.current_period_end as currentPeriodEnd, CASE WHEN i.state IN ('past_due_grace_active', 'past_due_grace_expired', 'unpaid', 'incomplete') THEN i.issue_started_at ELSE NULL END as paymentIssueStartedAt, CASE WHEN i.state IN ('past_due_grace_active', 'past_due_grace_expired') THEN i.past_due_grace_ends_at ELSE NULL END as pastDueGraceEndsAt, 'not_required' as billingProfileReadiness, NULL as billingProfileNextAction, NULL as billingProfileCheckedAt, (SELECT bs.created_at FROM billing_signal bs WHERE bs.billing_account_id = a.id AND bs.signal_kind = 'reconciliation' ORDER BY bs.sequence_number DESC, bs.created_at DESC LIMIT 1) as lastReconciledAt, (SELECT bs.source_kind FROM billing_signal bs WHERE bs.billing_account_id = a.id AND bs.signal_kind = 'reconciliation' ORDER BY bs.sequence_number DESC, bs.created_at DESC LIMIT 1) as lastReconciliationReason FROM billing_account a LEFT JOIN billing_subscription s ON s.billing_account_id = a.id LEFT JOIN billing_payment_issue i ON i.billing_account_id = a.id WHERE a.subject_type = 'organization' AND a.subject_id = ? ORDER BY s.updated_at DESC LIMIT 1",
    )
    .bind(organizationId)
    .first<{
      planCode: string;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      stripePriceId: string | null;
      billingInterval: string | null;
      subscriptionStatus: string;
      cancelAtPeriodEnd: number | boolean;
      trialStartedAt: number | null;
      trialEndedAt: number | null;
      currentPeriodStart: number | null;
      currentPeriodEnd: number | null;
      paymentIssueStartedAt: number | null;
      pastDueGraceEndsAt: number | null;
      billingProfileReadiness: string;
      billingProfileNextAction: string | null;
      billingProfileCheckedAt: number | null;
      lastReconciledAt: number | null;
      lastReconciliationReason: string | null;
    }>();
};

const selectStripeWebhookEventRow = async (eventId: string) => {
  return d1
    .prepare(
      "SELECT e.provider_event_id as id, e.event_type as eventType, e.scope, e.processing_status as processingStatus, a.subject_id as organizationId, e.provider_customer_id as stripeCustomerId, e.provider_subscription_id as stripeSubscriptionId, e.failure_reason as failureReason, 'verified' as signatureVerificationStatus, e.duplicate_detected as duplicateDetected, e.receipt_status as receiptStatus FROM billing_provider_event e LEFT JOIN billing_account a ON a.id = e.billing_account_id WHERE e.provider = 'stripe' AND e.provider_event_id = ? AND e.scope = 'billing' LIMIT 1",
    )
    .bind(eventId)
    .first<{
      id: string;
      eventType: string;
      scope: string;
      processingStatus: string;
      organizationId: string | null;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      failureReason: string | null;
      signatureVerificationStatus: string;
      duplicateDetected: number | boolean;
      receiptStatus: string;
    }>();
};

const selectBillingProviderEventRow = async (eventId: string) => {
  return d1
    .prepare(
      'SELECT provider_event_id as providerEventId, event_type as eventType, payload_hash as payloadHash, processing_status as processingStatus, receipt_status as receiptStatus, duplicate_detected as duplicateDetected, attempt_count as attemptCount, processing_started_at as processingStartedAt, last_attempt_at as lastAttemptAt, processed_at as processedAt FROM billing_provider_event WHERE provider = ? AND provider_event_id = ? AND scope = ? LIMIT 1',
    )
    .bind('stripe', eventId, 'billing')
    .first<{
      providerEventId: string;
      eventType: string;
      payloadHash: string;
      processingStatus: string;
      receiptStatus: string;
      duplicateDetected: number | boolean;
      attemptCount: number;
      processingStartedAt: number | null;
      lastAttemptAt: number | null;
      processedAt: number | null;
    }>();
};

const countStripeWebhookEventRows = async (eventId: string) => {
  const row = await d1
    .prepare(
      "SELECT COUNT(*) as count FROM billing_provider_event WHERE provider = 'stripe' AND provider_event_id = ? AND scope = 'billing'",
    )
    .bind(eventId)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
};

const selectStripeWebhookFailureRows = async (eventId: string | null = null) => {
  const statement = eventId
    ? d1
        .prepare(
          "SELECT CASE WHEN e.provider_event_id LIKE 'stripe_billing_failure:%' OR e.provider_event_id LIKE 'legacy_failure:%' THEN NULL ELSE e.provider_event_id END as eventId, e.event_type as eventType, e.failure_stage as failureStage, coalesce(e.last_failure_reason, e.failure_reason) as failureReason, a.subject_id as organizationId FROM billing_provider_event e LEFT JOIN billing_account a ON a.id = e.billing_account_id WHERE e.provider = 'stripe' AND e.scope = 'billing' AND e.failure_stage IS NOT NULL AND e.provider_event_id = ? ORDER BY e.last_failure_at ASC",
        )
        .bind(eventId)
    : d1.prepare(
        "SELECT CASE WHEN e.provider_event_id LIKE 'stripe_billing_failure:%' OR e.provider_event_id LIKE 'legacy_failure:%' THEN NULL ELSE e.provider_event_id END as eventId, e.event_type as eventType, e.failure_stage as failureStage, coalesce(e.last_failure_reason, e.failure_reason) as failureReason, a.subject_id as organizationId FROM billing_provider_event e LEFT JOIN billing_account a ON a.id = e.billing_account_id WHERE e.provider = 'stripe' AND e.scope = 'billing' AND e.failure_stage IS NOT NULL ORDER BY e.last_failure_at ASC",
      );

  const result = await statement.all<{
    eventId: string | null;
    eventType: string | null;
    failureStage: string;
    failureReason: string;
    organizationId: string | null;
  }>();

  return result.results;
};

const selectOrganizationBillingNotificationRows = async (organizationId: string) => {
  const result = await d1
    .prepare(
      "SELECT n.notification_kind as notificationKind, n.channel, n.sequence_number as sequenceNumber, n.delivery_status as deliveryState, n.attempt_number as attemptNumber, n.provider_event_id as stripeEventId, NULLIF(n.recipient_email, 'unassigned') as recipientEmail, n.plan_state as planState, n.subscription_status as subscriptionStatus, n.payment_method_status as paymentMethodStatus, n.failure_reason as failureReason FROM billing_notification n INNER JOIN billing_account a ON a.id = n.billing_account_id WHERE a.subject_type = 'organization' AND a.subject_id = ? ORDER BY n.sequence_number ASC",
    )
    .bind(organizationId)
    .all<{
      notificationKind: string;
      channel: string;
      sequenceNumber: number | string;
      deliveryState: string;
      attemptNumber: number | string;
      stripeEventId: string | null;
      recipientEmail: string | null;
      planState: string;
      subscriptionStatus: string;
      paymentMethodStatus: string;
      failureReason: string | null;
    }>();

  return result.results.map((row) => ({
    ...row,
    sequenceNumber: Number(row.sequenceNumber),
    attemptNumber: Number(row.attemptNumber),
  }));
};

const selectOrganizationBillingAuditEventRows = async (organizationId: string) => {
  const result = await d1
    .prepare(
      "SELECT e.sequence_number as sequenceNumber, e.source_kind as sourceKind, e.provider_event_id as stripeEventId, e.source_context as sourceContext, json_extract(e.previous_snapshot_json, '$.planState') as previousPlanState, json_extract(e.next_snapshot_json, '$.planState') as nextPlanState, json_extract(e.previous_snapshot_json, '$.subscriptionStatus') as previousSubscriptionStatus, json_extract(e.next_snapshot_json, '$.subscriptionStatus') as nextSubscriptionStatus, json_extract(e.previous_snapshot_json, '$.paymentMethodStatus') as previousPaymentMethodStatus, json_extract(e.next_snapshot_json, '$.paymentMethodStatus') as nextPaymentMethodStatus, json_extract(e.previous_snapshot_json, '$.entitlementState') as previousEntitlementState, json_extract(e.next_snapshot_json, '$.entitlementState') as nextEntitlementState FROM billing_audit_event e INNER JOIN billing_account a ON a.id = e.billing_account_id WHERE a.subject_type = 'organization' AND a.subject_id = ? ORDER BY e.sequence_number ASC",
    )
    .bind(organizationId)
    .all<{
      sequenceNumber: number | string;
      sourceKind: string;
      stripeEventId: string | null;
      sourceContext: string | null;
      previousPlanState: string;
      nextPlanState: string;
      previousSubscriptionStatus: string;
      nextSubscriptionStatus: string;
      previousPaymentMethodStatus: string;
      nextPaymentMethodStatus: string;
      previousEntitlementState: string;
      nextEntitlementState: string;
    }>();

  return result.results.map((row) => ({
    ...row,
    sequenceNumber: Number(row.sequenceNumber),
  }));
};

const selectOrganizationBillingSignalRows = async (organizationId: string) => {
  const result = await d1
    .prepare(
      "SELECT s.sequence_number as sequenceNumber, s.signal_kind as signalKind, s.signal_status as signalStatus, s.source_kind as sourceKind, s.reason, s.provider_event_id as stripeEventId, s.provider_plan_state as providerPlanState, s.provider_subscription_status as providerSubscriptionStatus, json_extract(s.app_snapshot_json, '$.planState') as appPlanState, json_extract(s.app_snapshot_json, '$.subscriptionStatus') as appSubscriptionStatus, json_extract(s.app_snapshot_json, '$.paymentMethodStatus') as appPaymentMethodStatus, json_extract(s.app_snapshot_json, '$.entitlementState') as appEntitlementState FROM billing_signal s INNER JOIN billing_account a ON a.id = s.billing_account_id WHERE a.subject_type = 'organization' AND a.subject_id = ? ORDER BY s.sequence_number ASC",
    )
    .bind(organizationId)
    .all<{
      sequenceNumber: number | string;
      signalKind: string;
      signalStatus: string;
      sourceKind: string;
      reason: string;
      stripeEventId: string | null;
      providerPlanState: string | null;
      providerSubscriptionStatus: string | null;
      appPlanState: string;
      appSubscriptionStatus: string;
      appPaymentMethodStatus: string;
      appEntitlementState: string;
    }>();

  return result.results.map((row) => ({
    ...row,
    sequenceNumber: Number(row.sequenceNumber),
  }));
};

const selectOrganizationOperationalRowCounts = async (organizationId: string) => {
  const [storeRow, serviceRow, participantRow, bookingRow] = await Promise.all([
    d1
      .prepare('SELECT COUNT(*) as count FROM store WHERE organization_id = ?')
      .bind(organizationId)
      .first<{ count: number | string }>(),
    d1
      .prepare('SELECT COUNT(*) as count FROM service WHERE organization_id = ?')
      .bind(organizationId)
      .first<{ count: number | string }>(),
    d1
      .prepare('SELECT COUNT(*) as count FROM participant WHERE organization_id = ?')
      .bind(organizationId)
      .first<{ count: number | string }>(),
    d1
      .prepare('SELECT COUNT(*) as count FROM booking WHERE organization_id = ?')
      .bind(organizationId)
      .first<{ count: number | string }>(),
  ]);

  return {
    storeCount: Number(storeRow?.count ?? 0),
    serviceCount: Number(serviceRow?.count ?? 0),
    participantCount: Number(participantRow?.count ?? 0),
    bookingCount: Number(bookingRow?.count ?? 0),
  };
};

const countTicketPacksForParticipantAndType = async (
  participantId: string,
  ticketTypeId: string,
) => {
  const row = await d1
    .prepare(
      'SELECT COUNT(*) as count FROM ticket_pack WHERE participant_id = ? AND ticket_type_id = ?',
    )
    .bind(participantId, ticketTypeId)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
};

const selectBookingAuditActionCount = async (bookingId: string, action: string) => {
  const row = await d1
    .prepare('SELECT COUNT(*) as count FROM booking_audit_log WHERE booking_id = ? AND action = ?')
    .bind(bookingId, action)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
};

const listSlotStartsByRecurringSchedule = async (recurringScheduleId: string) => {
  const rows = await d1
    .prepare(
      'SELECT id, start_at as startAt, status FROM slot WHERE recurring_schedule_id = ? ORDER BY start_at asc',
    )
    .bind(recurringScheduleId)
    .all<{ id: string; startAt: number; status: string }>();

  return rows.results ?? [];
};

const signUpUser = async ({
  agent,
  name,
  email,
}: {
  agent: ReturnType<typeof createAuthAgent>;
  name: string;
  email: string;
}) => {
  const response = await agent.request('/api/v1/auth/sign-up', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name,
      email,
      password: 'password1234',
    }),
  });

  expect(response.status).toBe(200);
};

const createOrganization = async ({
  agent,
  name,
  slug,
}: {
  agent: ReturnType<typeof createAuthAgent>;
  name: string;
  slug: string;
}) => {
  const response = await agent.request('/api/v1/auth/organizations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name, slug }),
  });

  expect(response.status).toBe(200);
  const payload = (await toJson(response)) as { id?: unknown };
  expect(typeof payload?.id).toBe('string');
  return payload.id as string;
};

const createBillingFixtureOwner = async ({
  application = app,
  name,
  email,
  organizationName,
  slug,
  emailVerified = false,
}: {
  application?: ReturnType<typeof createApp>;
  name: string;
  email: string;
  organizationName: string;
  slug: string;
  emailVerified?: boolean;
}) => {
  const agent = createAuthAgent(application);
  await signUpUser({
    agent,
    name,
    email,
  });
  if (emailVerified) {
    await setUserEmailVerified({ email });
  }
  const organizationId = await createOrganization({
    agent,
    name: organizationName,
    slug,
  });
  return {
    agent,
    organizationId,
    userId: (await selectUserIdByEmail(email)) as string,
  };
};

const createPremiumGatedApprovalService = async ({
  agent,
  organizationId,
  name,
}: {
  agent: ReturnType<typeof createAuthAgent>;
  organizationId: string;
  name: string;
}) => {
  return agent.request('/api/v1/auth/organizations/services', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      organizationId,
      name,
      kind: 'single',
      durationMinutes: 45,
      capacity: 4,
      bookingPolicy: 'approval',
      requiresTicket: false,
    }),
  });
};

const selectOrganizationSlugById = async (organizationId: string) => {
  const row = await d1
    .prepare('SELECT slug FROM organization WHERE id = ? LIMIT 1')
    .bind(organizationId)
    .first<{ slug: string }>();
  return row?.slug ?? null;
};

const selectStoreIdBySlug = async (organizationId: string, slug: string) => {
  const row = await d1
    .prepare('SELECT id FROM store WHERE organization_id = ? AND slug = ? LIMIT 1')
    .bind(organizationId, slug)
    .first<{ id: string }>();
  return row?.id ?? null;
};

const selectPublicSiteNotificationSetting = async (organizationId: string, storeId: string) => {
  return d1
    .prepare(
      'SELECT notify_owner as notifyOwner, notify_admins as notifyAdmins, notify_store_managers as notifyStoreManagers, notify_staff as notifyStaff, additional_emails_json as additionalEmailsJson FROM public_site_notification_setting WHERE organization_id = ? AND store_id = ? LIMIT 1',
    )
    .bind(organizationId, storeId)
    .first<{
      notifyOwner: number;
      notifyAdmins: number;
      notifyStoreManagers: number;
      notifyStaff: number;
      additionalEmailsJson: string | null;
    }>();
};

const selectReminderPolicyRows = async (organizationId: string, storeId: string) => {
  const rows = await d1
    .prepare(
      'SELECT id, enabled, minutes_before as minutesBefore, service_id as serviceId FROM reminder_policy WHERE organization_id = ? AND store_id = ? ORDER BY minutes_before DESC',
    )
    .bind(organizationId, storeId)
    .all<{
      id: string;
      enabled: number;
      minutesBefore: number;
      serviceId: string | null;
    }>();

  return rows.results ?? [];
};

const selectReminderLogRowsByBooking = async (bookingId: string) => {
  const rows = await d1
    .prepare(
      'SELECT reminder_policy_id as reminderPolicyId, dedupe_key as dedupeKey, recipient_email as recipientEmail, status, scheduled_for as scheduledFor FROM reminder_log WHERE booking_id = ? ORDER BY created_at ASC',
    )
    .bind(bookingId)
    .all<{
      reminderPolicyId: string | null;
      dedupeKey: string;
      recipientEmail: string;
      status: string;
      scheduledFor: number;
    }>();

  return rows.results ?? [];
};

const insertServiceFixture = async ({
  organizationId,
  storeId,
  name,
}: {
  organizationId: string;
  storeId: string;
  name: string;
}) => {
  const serviceId = crypto.randomUUID();
  await d1
    .prepare(
      'INSERT INTO service (id, organization_id, store_id, name, kind, duration_minutes, capacity, booking_policy, requires_ticket, is_active, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(serviceId, organizationId, storeId, name, 'single', 60, 10, 'instant', 0, 1, 'Asia/Tokyo')
    .run();

  return serviceId;
};

const insertReminderBookingFixture = async ({
  organizationId,
  storeId,
  startAt,
  customerEmail,
}: {
  organizationId: string;
  storeId: string;
  startAt: Date;
  customerEmail: string;
}) => {
  const serviceId = crypto.randomUUID();
  const slotId = crypto.randomUUID();
  const bookingId = crypto.randomUUID();
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
  const bookingOpenAt = new Date(startAt.getTime() - 14 * 24 * 60 * 60 * 1000);
  const bookingCloseAt = new Date(startAt.getTime() - 5 * 60 * 1000);

  await d1
    .prepare(
      'INSERT INTO service (id, organization_id, store_id, name, kind, duration_minutes, capacity, booking_policy, requires_ticket, is_active, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      serviceId,
      organizationId,
      storeId,
      `Reminder Fixture ${serviceId.slice(0, 8)}`,
      'single',
      60,
      10,
      'instant',
      0,
      1,
      'Asia/Tokyo',
    )
    .run();
  await d1
    .prepare(
      'INSERT INTO slot (id, organization_id, store_id, service_id, start_at, end_at, capacity, reserved_count, status, booking_open_at, booking_close_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      slotId,
      organizationId,
      storeId,
      serviceId,
      startAt.getTime(),
      endAt.getTime(),
      10,
      1,
      'open',
      bookingOpenAt.getTime(),
      bookingCloseAt.getTime(),
    )
    .run();
  await d1
    .prepare(
      'INSERT INTO booking (id, organization_id, store_id, slot_id, service_id, source, participants_count, customer_name, customer_email, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      bookingId,
      organizationId,
      storeId,
      slotId,
      serviceId,
      'public',
      1,
      'Reminder Customer',
      customerEmail,
      'confirmed',
    )
    .run();

  return {
    serviceId,
    slotId,
    bookingId,
  };
};

const selectUserIdByEmail = async (email: string) => {
  const row = await d1
    .prepare('SELECT id FROM user WHERE email = ? LIMIT 1')
    .bind(email)
    .first<{ id: string }>();
  return row?.id ?? null;
};

const setUserEmailVerified = async ({
  email,
  verified = true,
}: {
  email: string;
  verified?: boolean;
}) => {
  await d1
    .prepare('UPDATE user SET email_verified = ? WHERE email = ?')
    .bind(verified ? 1 : 0, email)
    .run();
};

type BillingV2SubscriptionStateFixture = Parameters<
  typeof upsertReserveAppBillingV2SubscriptionState
>[0];

const toNullableDate = (value: number | string | null | undefined) =>
  value == null ? null : new Date(Number(value));

const normalizeBillingFixtureSubscriptionStatus = (
  value: string,
): BillingV2SubscriptionStateFixture['subscriptionStatus'] =>
  value === 'trialing' ||
  value === 'active' ||
  value === 'past_due' ||
  value === 'unpaid' ||
  value === 'incomplete' ||
  value === 'canceled'
    ? value
    : 'free';

const buildBillingFixtureEnv = ({
  billingInterval,
  stripePriceId,
}: {
  billingInterval?: 'month' | 'year' | null;
  stripePriceId?: string | null;
}) =>
  billingInterval === 'year'
    ? { STRIPE_PREMIUM_YEARLY_PRICE_ID: stripePriceId ?? undefined }
    : { STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripePriceId ?? undefined };
const setOrganizationBillingState = async ({
  organizationId,
  planCode,
  subscriptionStatus,
  billingInterval,
  currentPeriodEnd,
  stripeCustomerId,
  stripeSubscriptionId,
  stripePriceId,
  cancelAtPeriodEnd,
  currentPeriodStart,
  paymentIssueStartedAt,
  pastDueGraceEndsAt,
}: {
  organizationId: string;
  planCode: 'free' | 'premium';
  subscriptionStatus:
    | 'free'
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'unpaid'
    | 'incomplete'
    | 'canceled';
  billingInterval?: 'month' | 'year' | null;
  currentPeriodEnd?: Date | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  cancelAtPeriodEnd?: boolean;
  currentPeriodStart?: Date | null;
  paymentIssueStartedAt?: Date | null;
  pastDueGraceEndsAt?: Date | null;
  billingProfileReadiness?: 'complete' | 'incomplete' | 'unavailable' | 'not_required';
  billingProfileNextAction?: string | null;
  billingProfileCheckedAt?: Date | null;
  lastReconciledAt?: Date | null;
  lastReconciliationReason?: string | null;
}) => {
  await upsertReserveAppBillingV2SubscriptionState({
    database: drizzle(d1),
    env: buildBillingFixtureEnv({ billingInterval, stripePriceId }),
    organizationId,
    planCode,
    stripeCustomerId: stripeCustomerId ?? null,
    stripeSubscriptionId: stripeSubscriptionId ?? null,
    stripePriceId: stripePriceId ?? null,
    billingInterval: billingInterval ?? null,
    subscriptionStatus,
    cancelAtPeriodEnd: cancelAtPeriodEnd ?? false,
    currentPeriodStart: currentPeriodStart ?? null,
    currentPeriodEnd: currentPeriodEnd ?? null,
    paymentIssueOccurredAt: paymentIssueStartedAt ?? null,
    pastDueGraceEndsAt,
  });
};

const syncOrganizationBillingV2FixtureFromLegacyRow = async (organizationId: string) => {
  const row = await selectOrganizationBillingRow(organizationId);
  if (!row) {
    return;
  }

  const billingInterval =
    row.billingInterval === 'month' || row.billingInterval === 'year' ? row.billingInterval : null;

  await upsertReserveAppBillingV2SubscriptionState({
    database: drizzle(d1),
    env: buildBillingFixtureEnv({ billingInterval, stripePriceId: row.stripePriceId }),
    organizationId,
    planCode: row.planCode === 'premium' ? 'premium' : 'free',
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    stripePriceId: row.stripePriceId,
    billingInterval,
    subscriptionStatus: normalizeBillingFixtureSubscriptionStatus(row.subscriptionStatus),
    cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
    currentPeriodStart: toNullableDate(row.currentPeriodStart),
    currentPeriodEnd: toNullableDate(row.currentPeriodEnd),
    paymentIssueOccurredAt: toNullableDate(row.paymentIssueStartedAt),
    pastDueGraceEndsAt: toNullableDate(row.pastDueGraceEndsAt),
    trialStartedAt: toNullableDate(row.trialStartedAt),
    trialEndedAt: toNullableDate(row.trialEndedAt),
  });
};

const insertOrganizationBillingAuditEventRow = async ({
  organizationId,
  sequenceNumber,
  sourceKind,
  previousPlanCode,
  nextPlanCode,
  previousPlanState,
  nextPlanState,
  previousSubscriptionStatus,
  nextSubscriptionStatus,
  previousPaymentMethodStatus,
  nextPaymentMethodStatus,
  previousEntitlementState,
  nextEntitlementState,
  previousBillingInterval = null,
  nextBillingInterval = null,
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  stripeEventId = null,
  sourceContext = null,
  createdAt,
}: {
  organizationId: string;
  sequenceNumber: number;
  sourceKind: string;
  previousPlanCode: string;
  nextPlanCode: string;
  previousPlanState: string;
  nextPlanState: string;
  previousSubscriptionStatus: string;
  nextSubscriptionStatus: string;
  previousPaymentMethodStatus: string;
  nextPaymentMethodStatus: string;
  previousEntitlementState: string;
  nextEntitlementState: string;
  previousBillingInterval?: string | null;
  nextBillingInterval?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeEventId?: string | null;
  sourceContext?: string | null;
  createdAt?: Date;
}) => {
  const billingAccountId = await ensureBillingFixtureAccountId(organizationId, stripeCustomerId);
  await d1
    .prepare(
      'INSERT INTO billing_audit_event (id, billing_account_id, sequence_number, source_kind, source_context, previous_snapshot_json, next_snapshot_json, provider, provider_event_id, provider_customer_id, provider_subscription_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      crypto.randomUUID(),
      billingAccountId,
      sequenceNumber,
      sourceKind,
      sourceContext,
      JSON.stringify({
        planCode: previousPlanCode,
        planState: previousPlanState,
        subscriptionStatus: previousSubscriptionStatus,
        paymentMethodStatus: previousPaymentMethodStatus,
        entitlementState: previousEntitlementState,
        billingInterval: previousBillingInterval,
        stripeCustomerId,
        stripeSubscriptionId,
      }),
      JSON.stringify({
        planCode: nextPlanCode,
        planState: nextPlanState,
        subscriptionStatus: nextSubscriptionStatus,
        paymentMethodStatus: nextPaymentMethodStatus,
        entitlementState: nextEntitlementState,
        billingInterval: nextBillingInterval,
        stripeCustomerId,
        stripeSubscriptionId,
      }),
      stripeCustomerId || stripeSubscriptionId || stripeEventId ? 'stripe' : null,
      stripeEventId,
      stripeCustomerId,
      stripeSubscriptionId,
      (createdAt ?? new Date()).getTime(),
    )
    .run();
};

const insertOrganizationBillingSignalRow = async ({
  organizationId,
  sequenceNumber,
  signalKind,
  signalStatus,
  sourceKind,
  reason,
  appPlanState,
  appSubscriptionStatus,
  appPaymentMethodStatus,
  appEntitlementState,
  providerPlanState = null,
  providerSubscriptionStatus = null,
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  stripeEventId = null,
  createdAt,
}: {
  organizationId: string;
  sequenceNumber: number;
  signalKind: string;
  signalStatus: string;
  sourceKind: string;
  reason: string;
  appPlanState: string;
  appSubscriptionStatus: string;
  appPaymentMethodStatus: string;
  appEntitlementState: string;
  providerPlanState?: string | null;
  providerSubscriptionStatus?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeEventId?: string | null;
  createdAt?: Date;
}) => {
  const billingAccountId = await ensureBillingFixtureAccountId(organizationId, stripeCustomerId);
  await d1
    .prepare(
      'INSERT INTO billing_signal (id, billing_account_id, sequence_number, signal_kind, signal_status, source_kind, reason, app_snapshot_json, provider, provider_event_id, provider_customer_id, provider_subscription_id, provider_plan_state, provider_subscription_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      crypto.randomUUID(),
      billingAccountId,
      sequenceNumber,
      signalKind,
      signalStatus,
      sourceKind,
      reason,
      JSON.stringify({
        planState: appPlanState,
        subscriptionStatus: appSubscriptionStatus,
        paymentMethodStatus: appPaymentMethodStatus,
        entitlementState: appEntitlementState,
        stripeCustomerId,
        stripeSubscriptionId,
      }),
      stripeCustomerId || stripeSubscriptionId || stripeEventId ? 'stripe' : null,
      stripeEventId,
      stripeCustomerId,
      stripeSubscriptionId,
      providerPlanState,
      providerSubscriptionStatus,
      (createdAt ?? new Date()).getTime(),
    )
    .run();
};

const insertReserveAppBillingNotificationRow = async ({
  organizationId,
  sequenceNumber,
  deliveryState,
  attemptNumber,
  stripeEventId = null,
  recipientEmail = null,
  recipientUserId = null,
  notificationKind = 'trial_will_end_email',
  channel = 'email',
  planState = 'premium_trial',
  subscriptionStatus = 'trialing',
  paymentMethodStatus = 'pending',
  trialEndsAt = null,
  failureReason = null,
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  createdAt,
}: {
  organizationId: string;
  sequenceNumber: number;
  deliveryState: string;
  attemptNumber: number;
  stripeEventId?: string | null;
  recipientEmail?: string | null;
  recipientUserId?: string | null;
  notificationKind?: string;
  channel?: string;
  planState?: string;
  subscriptionStatus?: string;
  paymentMethodStatus?: string;
  trialEndsAt?: Date | null;
  failureReason?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  createdAt?: Date;
}) => {
  const billingAccountId = await ensureBillingFixtureAccountId(organizationId, stripeCustomerId);
  await d1
    .prepare(
      'INSERT INTO billing_notification (id, billing_account_id, recipient_user_id, notification_kind, channel, sequence_number, delivery_status, attempt_number, provider, provider_event_id, provider_customer_id, provider_subscription_id, recipient_email, plan_state, subscription_status, payment_method_status, trial_ends_at, failure_reason, created_at, sent_at, failed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      crypto.randomUUID(),
      billingAccountId,
      recipientUserId,
      notificationKind,
      channel,
      sequenceNumber,
      deliveryState,
      attemptNumber,
      stripeCustomerId || stripeSubscriptionId || stripeEventId ? 'stripe' : null,
      stripeEventId,
      stripeCustomerId,
      stripeSubscriptionId,
      recipientEmail ?? 'unassigned',
      planState,
      subscriptionStatus,
      paymentMethodStatus,
      trialEndsAt ? trialEndsAt.getTime() : null,
      failureReason,
      (createdAt ?? new Date()).getTime(),
      deliveryState === 'sent' ? (createdAt ?? new Date()).getTime() : null,
      deliveryState === 'failed' ? (createdAt ?? new Date()).getTime() : null,
    )
    .run();
};

const insertStripeWebhookEventRow = async ({
  id,
  eventType,
  scope = 'billing',
  processingStatus = 'processed',
  organizationId = null,
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  failureReason = null,
  createdAt,
}: {
  id: string;
  eventType: string;
  scope?: string;
  processingStatus?: string;
  organizationId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  failureReason?: string | null;
  createdAt?: Date;
}) => {
  const timestamp = (createdAt ?? new Date()).getTime();
  let billingAccountId: string | null = null;
  if (organizationId) {
    const existingAccount = await d1
      .prepare(
        "SELECT id FROM billing_account WHERE subject_type = 'organization' AND subject_id = ? LIMIT 1",
      )
      .bind(organizationId)
      .first<{ id: string }>();
    billingAccountId = existingAccount?.id ?? crypto.randomUUID();
    if (!existingAccount) {
      await d1
        .prepare(
          'INSERT INTO billing_account (id, subject_type, subject_id, provider, provider_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          billingAccountId,
          'organization',
          organizationId,
          'stripe',
          stripeCustomerId,
          timestamp,
          timestamp,
        )
        .run();
    }
  }

  await d1
    .prepare(
      'INSERT INTO billing_provider_event (id, provider, provider_event_id, event_type, scope, payload_hash, processing_status, receipt_status, duplicate_detected, duplicate_detected_at, attempt_count, processing_started_at, last_attempt_at, processing_stale_after_ms, failure_reason, billing_account_id, provider_customer_id, provider_subscription_id, created_at, updated_at, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      crypto.randomUUID(),
      'stripe',
      id,
      eventType,
      scope,
      `fixture:${id}:${eventType}`,
      processingStatus,
      processingStatus === 'processed' ? 'processed' : 'received',
      false,
      null,
      1,
      timestamp,
      timestamp,
      120_000,
      failureReason,
      billingAccountId,
      stripeCustomerId,
      stripeSubscriptionId,
      timestamp,
      timestamp,
      processingStatus === 'processed' ? timestamp : null,
    )
    .run();
};

const selectOrganizationBillingOperationAttemptRows = async (organizationId: string) => {
  const result = await d1
    .prepare(
      "SELECT o.id, CASE o.purpose WHEN 'start_trial_subscription' THEN 'trial_start' WHEN 'create_setup_checkout' THEN 'payment_method_setup' WHEN 'create_portal_session' THEN 'billing_portal' ELSE 'paid_checkout' END as purpose, CASE WHEN o.reuse_key LIKE '%:month' THEN 'month' WHEN o.reuse_key LIKE '%:year' THEN 'year' ELSE NULL END as billingInterval, o.state, o.handoff_url as handoffUrl, o.handoff_expires_at as handoffExpiresAt, o.provider_checkout_session_id as stripeCheckoutSessionId, o.provider_portal_session_id as stripePortalSessionId, o.idempotency_key as idempotencyKey, o.failure_reason as failureReason FROM billing_operation_attempt o INNER JOIN billing_account a ON a.id = o.billing_account_id WHERE a.subject_type = 'organization' AND a.subject_id = ? ORDER BY o.created_at ASC",
    )
    .bind(organizationId)
    .all<{
      id: string;
      purpose: string;
      billingInterval: string | null;
      state: string;
      handoffUrl: string | null;
      handoffExpiresAt: number | null;
      stripeCheckoutSessionId: string | null;
      stripePortalSessionId: string | null;
      idempotencyKey: string;
      failureReason: string | null;
    }>();

  return result.results;
};

const selectOrganizationBillingInvoiceEventRows = async (organizationId: string) => {
  const result = await d1
    .prepare(
      "SELECT e.id, e.provider_event_id as stripeEventId, e.event_type as eventType, e.provider_invoice_id as stripeInvoiceId, e.provider_payment_intent_id as stripePaymentIntentId, e.provider_status as providerStatus, e.owner_facing_status as ownerFacingStatus, e.occurred_at as occurredAt, e.created_at as createdAt FROM billing_invoice_event e INNER JOIN billing_account a ON a.id = e.billing_account_id WHERE a.subject_type = 'organization' AND a.subject_id = ? AND e.event_type IN ('invoice_available', 'payment_succeeded', 'payment_failed', 'payment_action_required') ORDER BY e.created_at ASC",
    )
    .bind(organizationId)
    .all<{
      id: string;
      stripeEventId: string | null;
      eventType: string;
      stripeInvoiceId: string | null;
      stripePaymentIntentId: string | null;
      providerStatus: string | null;
      ownerFacingStatus: string;
      occurredAt: number | null;
      createdAt: number;
    }>();

  return result.results;
};

const insertOrganizationBillingInvoiceEventRow = async ({
  organizationId,
  stripeEventId,
  eventType,
  ownerFacingStatus,
  stripeCustomerId = null,
  stripeInvoiceId = null,
  stripePaymentIntentId = null,
  providerStatus = null,
  occurredAt = null,
  createdAt,
}: {
  organizationId: string;
  stripeEventId?: string | null;
  eventType:
    | 'invoice_available'
    | 'payment_succeeded'
    | 'payment_failed'
    | 'payment_action_required';
  ownerFacingStatus:
    | 'available'
    | 'checking'
    | 'missing'
    | 'action_required'
    | 'failed'
    | 'succeeded';
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeInvoiceId?: string | null;
  stripePaymentIntentId?: string | null;
  providerStatus?: string | null;
  occurredAt?: Date | null;
  createdAt?: Date;
}) => {
  const billingAccountId = await ensureBillingFixtureAccountId(organizationId, stripeCustomerId);
  const billingSubscriptionId = await selectBillingFixtureSubscriptionId(organizationId);
  await d1
    .prepare(
      'INSERT INTO billing_invoice_event (id, billing_account_id, billing_subscription_id, event_type, provider, provider_event_id, provider_invoice_id, provider_payment_intent_id, provider_status, owner_facing_status, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      crypto.randomUUID(),
      billingAccountId,
      billingSubscriptionId,
      eventType,
      'stripe',
      stripeEventId ?? null,
      stripeInvoiceId,
      stripePaymentIntentId,
      providerStatus,
      ownerFacingStatus,
      occurredAt ? occurredAt.getTime() : null,
      (createdAt ?? new Date()).getTime(),
    )
    .run();
};

const selectReserveAppBillingDocumentReferenceRows = async (organizationId: string) => {
  const result = await d1
    .prepare(
      "SELECT d.document_kind as documentKind, d.provider_document_id as providerDocumentId, d.hosted_invoice_url as hostedInvoiceUrl, d.invoice_pdf_url as invoicePdfUrl, d.receipt_url as receiptUrl, d.availability, d.owner_facing_status as ownerFacingStatus, d.provider_derived as providerDerived FROM billing_document_reference d INNER JOIN billing_account a ON a.id = d.billing_account_id WHERE a.subject_type = 'organization' AND a.subject_id = ? ORDER BY d.created_at ASC",
    )
    .bind(organizationId)
    .all<{
      documentKind: string;
      providerDocumentId: string;
      hostedInvoiceUrl: string | null;
      invoicePdfUrl: string | null;
      receiptUrl: string | null;
      availability: string;
      ownerFacingStatus: string;
      providerDerived: number | boolean;
    }>();

  return result.results;
};

const selectBillingPaymentIssueRowBySubject = async (organizationId: string) => {
  return d1
    .prepare(
      'SELECT i.state, i.issue_started_at as issueStartedAt, i.issue_started_at_source as issueStartedAtSource, i.past_due_grace_ends_at as pastDueGraceEndsAt, i.latest_provider_event_id as latestProviderEventId, i.latest_invoice_id as latestInvoiceId, i.latest_payment_intent_id as latestPaymentIntentId FROM billing_payment_issue i INNER JOIN billing_account a ON a.id = i.billing_account_id WHERE a.subject_type = ? AND a.subject_id = ? LIMIT 1',
    )
    .bind('organization', organizationId)
    .first<{
      state: string;
      issueStartedAt: number | null;
      issueStartedAtSource: string;
      pastDueGraceEndsAt: number | null;
      latestProviderEventId: string | null;
      latestInvoiceId: string | null;
      latestPaymentIntentId: string | null;
    }>();
};

const selectBillingPaymentIssueEventRowsBySubject = async (organizationId: string) => {
  const result = await d1
    .prepare(
      'SELECT e.event_type as eventType, e.provider_event_id as providerEventId, e.provider_invoice_id as providerInvoiceId, e.provider_payment_intent_id as providerPaymentIntentId, e.occurred_at as occurredAt FROM billing_invoice_event e INNER JOIN billing_account a ON a.id = e.billing_account_id WHERE a.subject_type = ? AND a.subject_id = ? ORDER BY e.created_at ASC',
    )
    .bind('organization', organizationId)
    .all<{
      eventType: string;
      providerEventId: string | null;
      providerInvoiceId: string | null;
      providerPaymentIntentId: string | null;
      occurredAt: number | null;
    }>();

  return result.results;
};

const selectBillingNotificationRowsBySubject = async (organizationId: string) => {
  const result = await d1
    .prepare(
      "SELECT n.notification_kind as notificationKind, n.recipient_email as recipientEmail, n.delivery_status as deliveryStatus, n.failure_reason as failureReason, n.provider_event_id as providerEventId, n.provider_invoice_id as providerInvoiceId FROM billing_notification n INNER JOIN billing_account a ON a.id = n.billing_account_id WHERE a.subject_type = ? AND a.subject_id = ? AND n.delivery_status = 'sent' ORDER BY n.created_at ASC",
    )
    .bind('organization', organizationId)
    .all<{
      notificationKind: string;
      recipientEmail: string;
      deliveryStatus: string;
      failureReason: string | null;
      providerEventId: string | null;
      providerInvoiceId: string | null;
    }>();

  return result.results;
};

const selectBillingDocumentReferenceRowsBySubject = async (organizationId: string) => {
  const result = await d1
    .prepare(
      'SELECT d.document_kind as documentKind, d.provider_document_id as providerDocumentId, d.availability, d.owner_facing_status as ownerFacingStatus, d.provider_derived as providerDerived FROM billing_document_reference d INNER JOIN billing_account a ON a.id = d.billing_account_id WHERE a.subject_type = ? AND a.subject_id = ? ORDER BY d.created_at ASC',
    )
    .bind('organization', organizationId)
    .all<{
      documentKind: string;
      providerDocumentId: string;
      availability: string;
      ownerFacingStatus: string;
      providerDerived: number | boolean;
    }>();

  return result.results;
};

const selectBillingSignalRowsBySubject = async (organizationId: string) => {
  const result = await d1
    .prepare(
      'SELECT s.signal_kind as signalKind, s.signal_status as signalStatus, s.source_kind as sourceKind, s.reason, s.provider_event_id as providerEventId, s.provider_plan_state as providerPlanState, s.provider_subscription_status as providerSubscriptionStatus FROM billing_signal s INNER JOIN billing_account a ON a.id = s.billing_account_id WHERE a.subject_type = ? AND a.subject_id = ? ORDER BY s.created_at ASC',
    )
    .bind('organization', organizationId)
    .all<{
      signalKind: string;
      signalStatus: string;
      sourceKind: string;
      reason: string;
      providerEventId: string | null;
      providerPlanState: string | null;
      providerSubscriptionStatus: string | null;
    }>();

  return result.results;
};

const insertStripeWebhookFailureRow = async ({
  eventId,
  eventType,
  scope = 'billing',
  failureStage,
  failureReason,
  organizationId = null,
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  createdAt,
}: {
  eventId?: string | null;
  eventType?: string | null;
  scope?: string;
  failureStage: string;
  failureReason: string;
  organizationId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  createdAt?: Date;
}) => {
  const billingAccountId = organizationId
    ? await ensureBillingFixtureAccountId(organizationId, stripeCustomerId)
    : null;
  const providerEventId = eventId ?? `stripe_billing_failure:${crypto.randomUUID()}`;
  const timestamp = (createdAt ?? new Date()).getTime();
  await d1
    .prepare(
      'INSERT INTO billing_provider_event (id, provider, provider_event_id, event_type, scope, payload_hash, processing_status, receipt_status, duplicate_detected, attempt_count, processing_started_at, last_attempt_at, processing_stale_after_ms, failure_reason, failure_stage, last_failure_reason, last_failure_at, billing_account_id, provider_customer_id, provider_subscription_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(provider, provider_event_id, scope) DO UPDATE SET event_type = excluded.event_type, processing_status = excluded.processing_status, receipt_status = excluded.receipt_status, last_attempt_at = excluded.last_attempt_at, failure_reason = excluded.failure_reason, failure_stage = excluded.failure_stage, last_failure_reason = excluded.last_failure_reason, last_failure_at = excluded.last_failure_at, billing_account_id = excluded.billing_account_id, provider_customer_id = excluded.provider_customer_id, provider_subscription_id = excluded.provider_subscription_id, updated_at = excluded.updated_at',
    )
    .bind(
      crypto.randomUUID(),
      'stripe',
      providerEventId,
      eventType ?? `stripe.webhook.${failureStage}`,
      scope,
      'test-unavailable',
      'failed',
      failureStage === 'signature_verification' ? 'rejected' : 'received',
      0,
      1,
      timestamp,
      timestamp,
      120000,
      failureReason,
      failureStage,
      failureReason,
      timestamp,
      billingAccountId,
      stripeCustomerId,
      stripeSubscriptionId,
      timestamp,
      timestamp,
    )
    .run();
};

const createPaymentIssueBillingFixture = async ({
  application = app,
  name,
  email,
  organizationName,
  slug,
  subscriptionStatus = 'past_due',
  paymentIssueStartedAt = new Date('2026-05-01T00:00:00.000Z'),
  pastDueGraceEndsAt = new Date('2026-05-08T00:00:00.000Z'),
  stripeCustomerId,
  stripeSubscriptionId,
  stripePriceId = null,
  emailVerified = true,
}: {
  application?: ReturnType<typeof createApp>;
  name: string;
  email: string;
  organizationName: string;
  slug: string;
  subscriptionStatus?: 'past_due' | 'unpaid' | 'incomplete' | 'active';
  paymentIssueStartedAt?: Date | null;
  pastDueGraceEndsAt?: Date | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  emailVerified?: boolean;
}) => {
  const fixture = await createBillingFixtureOwner({
    application,
    name,
    email,
    organizationName,
    slug,
    emailVerified,
  });
  const resolvedStripeCustomerId =
    stripeCustomerId === undefined
      ? `cus_payment_issue_${fixture.organizationId}`
      : stripeCustomerId;
  const resolvedStripeSubscriptionId =
    stripeSubscriptionId === undefined
      ? `sub_payment_issue_${fixture.organizationId}`
      : stripeSubscriptionId;

  await setOrganizationBillingState({
    organizationId: fixture.organizationId,
    planCode: 'premium',
    subscriptionStatus,
    billingInterval: 'month',
    currentPeriodStart: new Date('2026-04-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-06-01T00:00:00.000Z'),
    stripeCustomerId: resolvedStripeCustomerId,
    stripeSubscriptionId: resolvedStripeSubscriptionId,
    stripePriceId,
    paymentIssueStartedAt,
    pastDueGraceEndsAt,
  });

  return {
    ...fixture,
    stripeCustomerId: resolvedStripeCustomerId,
    stripeSubscriptionId: resolvedStripeSubscriptionId,
    stripePriceId,
  };
};

const enablePremiumForOrganization = async (organizationId: string) => {
  await setOrganizationBillingState({
    organizationId,
    planCode: 'premium',
    subscriptionStatus: 'active',
    billingInterval: 'month',
    currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
};

const insertOrganizationMember = async ({
  organizationId,
  userId,
  role,
}: {
  organizationId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
}) => {
  await d1
    .prepare(
      'INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(crypto.randomUUID(), organizationId, userId, role, Date.now())
    .run();
};

const buildOrgInvitationPath = (organizationSlug: string) =>
  `/api/v1/auth/orgs/${encodeURIComponent(organizationSlug)}/invitations`;

const buildStoreInvitationPath = (organizationSlug: string, storeSlug: string) =>
  `/api/v1/auth/orgs/${encodeURIComponent(organizationSlug)}/stores/${encodeURIComponent(storeSlug)}/invitations`;

const buildInvitationDetailPath = (invitationId: string) =>
  `/api/v1/auth/invitations/${encodeURIComponent(invitationId)}`;

const buildInvitationActionPath = (invitationId: string, action: 'accept' | 'reject' | 'cancel') =>
  `/api/v1/auth/invitations/${encodeURIComponent(invitationId)}/${action}`;

const acceptInvitation = async ({
  agent,
  invitationId,
}: {
  agent: ReturnType<typeof createAuthAgent>;
  invitationId: string;
}) => {
  return agent.request(buildInvitationActionPath(invitationId, 'accept'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      invitationId,
    }),
  });
};

const createInvitation = async ({
  agent,
  email,
  role,
  organizationId,
  resend,
}: {
  agent: ReturnType<typeof createAuthAgent>;
  email: string;
  role: 'admin' | 'member' | 'owner';
  organizationId: string;
  resend?: boolean;
}) => {
  const organizationSlug = await selectOrganizationSlugById(organizationId);
  expect(organizationSlug).toBeTruthy();

  const response = await agent.request(buildOrgInvitationPath(organizationSlug as string), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email,
      role,
      resend,
    }),
  });

  return {
    response,
    payload: (await toJson(response)) as Record<string, unknown> | null,
  };
};

const createParticipantInvitation = async ({
  agent,
  email,
  participantName,
  organizationId,
  resend,
}: {
  agent: ReturnType<typeof createAuthAgent>;
  email: string;
  participantName: string;
  organizationId: string;
  resend?: boolean;
}) => {
  const organizationSlug = await selectOrganizationSlugById(organizationId);
  expect(organizationSlug).toBeTruthy();

  const response = await agent.request(
    buildStoreInvitationPath(organizationSlug as string, organizationSlug as string),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email,
        role: 'participant',
        participantName,
        resend,
      }),
    },
  );

  return {
    response,
    payload: (await toJson(response)) as Record<string, unknown> | null,
  };
};

const createStoreOperatorInvitation = async ({
  agent,
  email,
  role,
  organizationId,
  resend,
}: {
  agent: ReturnType<typeof createAuthAgent>;
  email: string;
  role: 'manager' | 'staff';
  organizationId: string;
  resend?: boolean;
}) => {
  const organizationSlug = await selectOrganizationSlugById(organizationId);
  expect(organizationSlug).toBeTruthy();

  const response = await agent.request(
    buildStoreInvitationPath(organizationSlug as string, organizationSlug as string),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email,
        role,
        resend,
      }),
    },
  );

  return {
    response,
    payload: (await toJson(response)) as Record<string, unknown> | null,
  };
};

type AiSourceVisibilityFixture =
  | 'public'
  | 'authenticated'
  | 'participant'
  | 'staff'
  | 'manager'
  | 'admin'
  | 'owner';

type AiKnowledgeFixtureInput = {
  sourceKind?: 'docs' | 'specs' | 'faq';
  title?: string;
  sourcePath?: string;
  content?: string;
  visibility?: AiSourceVisibilityFixture;
  internalOnly?: boolean;
  organizationId?: string | null;
  storeId?: string | null;
  indexStatus?: 'pending' | 'indexed' | 'failed' | 'stale' | 'deleted';
  vectorStatus?: 'pending' | 'upserted' | 'failed' | 'deleted';
  indexedAt?: Date;
  lastError?: string | null;
};

type AiTestRuntimeOptions = {
  answer?: string;
  matchedChunkIds?: string[];
  retrievalShouldFail?: boolean;
  operatorEmails?: string;
};

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const uniqueAiTestToken = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

const createAiTestRuntime = ({
  answer = 'AI統合テストの回答です。',
  matchedChunkIds = [],
  retrievalShouldFail = false,
  operatorEmails,
}: AiTestRuntimeOptions = {}) => {
  let currentMatchedChunkIds = [...matchedChunkIds];
  let shouldFailRetrieval = retrievalShouldFail;
  const answerPrompts: Array<{ systemPrompt: string; userPrompt: string }> = [];

  const aiRun = vi.fn(
    async (
      _model: string,
      inputs: Record<string, unknown>,
      _options?: Record<string, unknown>,
    ): Promise<unknown> => {
      if (Array.isArray(inputs.messages)) {
        const messages = inputs.messages.filter(isRecordValue);
        const readContent = (role: string) => {
          const message = messages.find((entry) => entry.role === role);
          return typeof message?.content === 'string' ? message.content : '';
        };
        answerPrompts.push({
          systemPrompt: readContent('system'),
          userPrompt: readContent('user'),
        });

        return {
          response: JSON.stringify({
            answer,
            confidence: 86,
            needsHumanSupport: false,
            suggestedActions: [
              {
                label: '予約運用を開く',
                href: '/admin/bookings',
                actionKind: 'open_page',
              },
            ],
          }),
          usage: {
            input_tokens: 21,
            output_tokens: 8,
          },
          headers: {
            get: (name: string) => (name.toLowerCase() === 'cf-aig-log-id' ? 'log-ai-test' : null),
          },
        };
      }

      return {
        data: [[0.11, 0.22, 0.33]],
        shape: [1, 3],
      };
    },
  );

  const query = vi.fn(
    async (): Promise<{
      matches: Array<{ id: string; score: number; metadata: Record<string, never> }>;
    }> => {
      if (shouldFailRetrieval) {
        throw new Error('vectorize_unavailable');
      }

      return {
        matches: currentMatchedChunkIds.map((id, index) => ({
          id,
          score: 0.92 - index * 0.08,
          metadata: {},
        })),
      };
    },
  );

  const env = {
    BETTER_AUTH_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
    BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
    GOOGLE_CLIENT_ID: 'test-google-client-id',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    INTERNAL_OPERATOR_EMAILS: operatorEmails,
    AI: {
      run: aiRun,
    },
    AI_KNOWLEDGE_INDEX: {
      query,
    },
    AI_ANSWER_MODEL: 'test-answer-model',
    AI_EMBEDDING_MODEL: 'test-embedding-model',
  };

  const authRuntime = createAuthRuntime({
    database: drizzle(d1),
    env,
  });

  return {
    application: createApp(authRuntime),
    aiRun,
    query,
    answerPrompts,
    setMatchedChunkIds: (chunkIds: string[]) => {
      currentMatchedChunkIds = [...chunkIds];
    },
    setRetrievalShouldFail: (value: boolean) => {
      shouldFailRetrieval = value;
    },
  };
};

const createAiOwnerFixture = async ({
  application,
  prefix,
  emailVerified = false,
}: {
  application: ReturnType<typeof createApp>;
  prefix: string;
  emailVerified?: boolean;
}) => {
  const token = uniqueAiTestToken(prefix);
  const email = `${token}@example.com`;
  const slug = token;
  const agent = createAuthAgent(application);

  await signUpUser({
    agent,
    name: `AI Owner ${token}`,
    email,
  });
  if (emailVerified) {
    await setUserEmailVerified({ email });
  }
  const organizationId = await createOrganization({
    agent,
    name: `AI Org ${token}`,
    slug,
  });
  const storeId = await selectStoreIdBySlug(organizationId, slug);
  expect(storeId).toBeTruthy();

  return {
    agent,
    email,
    userId: (await selectUserIdByEmail(email)) as string,
    organizationId,
    organizationSlug: slug,
    storeId: storeId as string,
  };
};

const createAiAuthenticatedUser = async ({
  application,
  prefix,
  emailVerified = false,
}: {
  application: ReturnType<typeof createApp>;
  prefix: string;
  emailVerified?: boolean;
}) => {
  const token = uniqueAiTestToken(prefix);
  const email = `${token}@example.com`;
  const agent = createAuthAgent(application);

  await signUpUser({
    agent,
    name: `AI User ${token}`,
    email,
  });
  if (emailVerified) {
    await setUserEmailVerified({ email });
  }

  return {
    agent,
    email,
    userId: (await selectUserIdByEmail(email)) as string,
  };
};

const createAiParticipantFixture = async ({
  application,
  organizationId,
  storeId,
  prefix,
}: {
  application: ReturnType<typeof createApp>;
  organizationId: string;
  storeId: string;
  prefix: string;
}) => {
  const user = await createAiAuthenticatedUser({
    application,
    prefix,
  });

  await d1
    .prepare(
      'INSERT INTO participant (id, organization_id, store_id, user_id, email, name) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(
      crypto.randomUUID(),
      organizationId,
      storeId,
      user.userId,
      user.email,
      `AI Participant ${prefix}`,
    )
    .run();

  return user;
};

const insertAiStoreFixture = async ({
  organizationId,
  slug,
  name,
}: {
  organizationId: string;
  slug: string;
  name: string;
}) => {
  const id = crypto.randomUUID();
  await d1
    .prepare('INSERT INTO store (id, organization_id, slug, name) VALUES (?, ?, ?, ?)')
    .bind(id, organizationId, slug, name)
    .run();
  return id;
};

const insertAiKnowledgeFixture = async ({
  sourceKind = 'docs',
  title = 'AI test knowledge',
  sourcePath,
  content = 'AI test knowledge content',
  visibility = 'authenticated',
  internalOnly = false,
  organizationId = null,
  storeId = null,
  indexStatus = 'indexed',
  vectorStatus = 'upserted',
  indexedAt = new Date('2026-05-20T00:00:00.000Z'),
  lastError = null,
}: AiKnowledgeFixtureInput = {}) => {
  const documentId = crypto.randomUUID();
  const chunkId = crypto.randomUUID();
  const resolvedSourcePath = sourcePath ?? `ai-test/${documentId}.md`;
  const now = Date.now();

  await d1
    .prepare(
      'INSERT INTO ai_knowledge_document (id, source_kind, source_path, title, locale, visibility, internal_only, organization_id, store_id, feature, checksum, index_status, indexed_at, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      documentId,
      sourceKind,
      resolvedSourcePath,
      title,
      'ja',
      visibility,
      internalOnly ? 1 : 0,
      organizationId,
      storeId,
      'ai-test',
      `checksum-${documentId}`,
      indexStatus,
      indexedAt.getTime(),
      lastError,
      now,
      now,
    )
    .run();

  await d1
    .prepare(
      'INSERT INTO ai_knowledge_chunk (id, document_id, chunk_index, content, content_hash, title, source_kind, source_path, locale, visibility, internal_only, organization_id, store_id, feature, tags_json, indexed_at, vector_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      chunkId,
      documentId,
      0,
      content,
      `hash-${chunkId}`,
      title,
      sourceKind,
      resolvedSourcePath,
      'ja',
      visibility,
      internalOnly ? 1 : 0,
      organizationId,
      storeId,
      'ai-test',
      JSON.stringify(['ai-test']),
      indexedAt.getTime(),
      vectorStatus,
    )
    .run();

  return {
    documentId,
    chunkId,
    sourcePath: resolvedSourcePath,
    title,
    indexedAt,
  };
};

const postAiChat = async (
  agent: ReturnType<typeof createAuthAgent>,
  body: Record<string, unknown>,
) =>
  agent.request('/api/v1/ai/chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

const postAiFeedback = async ({
  agent,
  messageId,
  body,
}: {
  agent: ReturnType<typeof createAuthAgent>;
  messageId: string;
  body: Record<string, unknown>;
}) =>
  agent.request(`/api/v1/ai/messages/${encodeURIComponent(messageId)}/feedback`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

const selectAiOperationRowCounts = async (organizationId: string) => {
  const [bookingRow, ticketPurchaseRow, ticketPackRow, invitationRow] = await Promise.all([
    d1
      .prepare('SELECT COUNT(*) as count FROM booking WHERE organization_id = ?')
      .bind(organizationId)
      .first<{ count: number | string }>(),
    d1
      .prepare('SELECT COUNT(*) as count FROM ticket_purchase WHERE organization_id = ?')
      .bind(organizationId)
      .first<{ count: number | string }>(),
    d1
      .prepare(
        'SELECT COUNT(*) as count FROM ticket_pack WHERE participant_id IN (SELECT id FROM participant WHERE organization_id = ?)',
      )
      .bind(organizationId)
      .first<{ count: number | string }>(),
    d1
      .prepare('SELECT COUNT(*) as count FROM invitation WHERE organization_id = ?')
      .bind(organizationId)
      .first<{ count: number | string }>(),
  ]);

  return {
    bookingCount: Number(bookingRow?.count ?? 0),
    ticketPurchaseCount: Number(ticketPurchaseRow?.count ?? 0),
    ticketPackCount: Number(ticketPackRow?.count ?? 0),
    invitationCount: Number(invitationRow?.count ?? 0),
  };
};

const selectAiConversationRow = async (conversationId: string) =>
  d1
    .prepare(
      'SELECT id, actor_user_id as actorUserId, subject_id as subjectId, store_id as storeId, title FROM ai_conversation WHERE id = ? LIMIT 1',
    )
    .bind(conversationId)
    .first<{
      id: string;
      actorUserId: string;
      subjectId: string;
      storeId: string | null;
      title: string | null;
    }>();

const selectAiMessagesForConversation = async (conversationId: string) => {
  const result = await d1
    .prepare(
      'SELECT id, role, content, sources_json as sourcesJson, retrieved_context_json as retrievedContextJson, generation_status as generationStatus, error_code as errorCode, error_summary as errorSummary FROM ai_message WHERE conversation_id = ? ORDER BY created_at ASC',
    )
    .bind(conversationId)
    .all<{
      id: string;
      role: string;
      content: string;
      sourcesJson: string | null;
      retrievedContextJson: string | null;
      generationStatus: string | null;
      errorCode: string | null;
      errorSummary: string | null;
    }>();

  return result.results;
};

const selectAiUsageEventsForConversation = async (conversationId: string) => {
  const result = await d1
    .prepare(
      'SELECT id, message_id as messageId, generation_status as generationStatus, error_code as errorCode, error_summary as errorSummary FROM ai_usage_event WHERE conversation_id = ? ORDER BY created_at ASC',
    )
    .bind(conversationId)
    .all<{
      id: string;
      messageId: string | null;
      generationStatus: string;
      errorCode: string | null;
      errorSummary: string | null;
    }>();

  return result.results;
};

const selectAiFeedbackRowsForMessage = async (messageId: string) => {
  const result = await d1
    .prepare(
      'SELECT id, message_id as messageId, user_id as userId, rating, comment FROM ai_feedback WHERE message_id = ? ORDER BY created_at ASC',
    )
    .bind(messageId)
    .all<{
      id: string;
      messageId: string;
      userId: string;
      rating: string;
      comment: string | null;
    }>();

  return result.results;
};

const insertAiFeedbackFixture = async ({
  messageId,
  userId,
  rating,
  comment,
  createdAt,
}: {
  messageId: string;
  userId: string;
  rating: 'helpful' | 'unhelpful';
  comment?: string | null;
  createdAt: Date;
}) => {
  await d1
    .prepare(
      'INSERT INTO ai_feedback (id, message_id, user_id, rating, comment, resolved, created_at, aggregate_retention_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      crypto.randomUUID(),
      messageId,
      userId,
      rating,
      comment ?? null,
      0,
      createdAt.getTime(),
      createdAt.getTime() + 365 * 24 * 60 * 60 * 1000,
    )
    .run();
};

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { async fetch() { return new Response("ok"); } }',
    d1Databases: ['DB'],
  });

  d1 = await mf.getD1Database('DB');
  const migrationDir = path.resolve(currentDir, '../drizzle');
  const migrationFiles = (await fs.readdir(migrationDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  for (const migrationFile of migrationFiles) {
    const migrationPath = path.join(migrationDir, migrationFile);
    const migrationSql = await fs.readFile(migrationPath, 'utf8');
    const statements = migrationSql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    for (const statement of statements) {
      await d1.prepare(statement).run();
    }
  }

  const authRuntime = createAuthRuntime({
    database: drizzle(d1),
    env: {
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
      BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    },
  });

  app = createApp(authRuntime);
});

afterAll(async () => {
  await mf.dispose();
});

describe('バックエンドアプリ', () => {
  it('GET / で hello メッセージを返す', async () => {
    const response = await app.request('/');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hono + Better Auth API');
  });

  it('GET /api/health でヘルスレスポンスを返す', async () => {
    const response = await app.request('/api/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('API レスポンスを検索エンジンのインデックス対象外にする', async () => {
    const response = await app.request('/api/health');

    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
  });

  it('API ドメインのクロールを許可しない', async () => {
    const response = await app.request('/robots.txt');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('User-agent: *\nDisallow: /\n');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
  });

  it('OAuth コールバック URL のキャッシュとリファラー漏えいを防ぐ', async () => {
    const response = await app.request('/api/auth/callback/google');

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
  });

  it('RPC 認証セッションエンドポイントを公開する', async () => {
    const response = await app.request('/api/v1/auth/session');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('null');
  });

  it('Google OIDC 開始エンドポイントは既定でリダイレクトする', async () => {
    const response = await app.request(
      '/api/v1/auth/oidc/google?callbackURL=http%3A%2F%2Flocalhost%3A5173%2F',
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
  });

  it('Google OIDC 開始エンドポイントで oauth_state Cookie を設定する', async () => {
    const response = await app.request(
      '/api/v1/auth/oidc/google?callbackURL=http%3A%2F%2Flocalhost%3A5173%2F',
    );

    expect(response.status).toBe(302);
    const setCookies = getSetCookieValues(response);
    expect(setCookies.some((cookie) => /oauth_state=/.test(cookie))).toBe(true);
  });

  it('ローカル HTTP 開発では oauth_state Cookie を非 Secure にする', async () => {
    const response = await app.request(
      '/api/v1/auth/oidc/google?callbackURL=http%3A%2F%2Flocalhost%3A5173%2F',
    );

    expect(response.status).toBe(302);
    const setCookies = getSetCookieValues(response);
    const oauthStateCookie = setCookies.find((cookie) => /oauth_state=/.test(cookie));
    expect(oauthStateCookie).toBeDefined();
    expect(oauthStateCookie).not.toContain('Secure');
  });

  it('Google OIDC 開始エンドポイントで disableRedirect=true のとき JSON レスポンスを維持する', async () => {
    const response = await app.request(
      '/api/v1/auth/oidc/google?callbackURL=http%3A%2F%2Flocalhost%3A5173%2F&disableRedirect=true',
    );

    expect(response.status).toBe(200);

    const body = (await toJson(response)) as { redirect?: unknown; url?: unknown };
    expect(body.redirect).toBe(false);
    expect(typeof body.url).toBe('string');
    expect((body.url as string) || '').toContain('https://accounts.google.com/o/oauth2/v2/auth');
  });

  it('未登録メールのサインイン失敗は Better Auth の日本語 message を返す', async () => {
    const response = await app.request('/api/v1/auth/sign-in', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'auth-i18n-missing-user@example.com',
        password: 'password1234',
      }),
    });

    expect(response.status).toBe(401);
    expect(await toJson(response)).toMatchObject({
      code: 'INVALID_EMAIL_OR_PASSWORD',
      message: 'メールアドレスまたはパスワードが正しくありません。',
      originalMessage: 'Invalid email or password',
    });
  });

  it('既存メールのサインアップ失敗は Better Auth の日本語 message を返す', async () => {
    const agent = createAuthAgent(app);
    await signUpUser({
      agent,
      name: 'Auth I18n Existing User',
      email: 'auth-i18n-existing-user@example.com',
    });

    const response = await agent.request('/api/v1/auth/sign-up', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Auth I18n Duplicate User',
        email: 'auth-i18n-existing-user@example.com',
        password: 'password1234',
      }),
    });

    expect(response.status).toBe(422);
    expect(await toJson(response)).toMatchObject({
      code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
      message: 'このメールアドレスは既に使用されています。別のメールアドレスを使用してください。',
      originalMessage: 'User already exists. Use another email.',
    });
  });

  it('同じ slug の組織作成失敗は Better Auth の日本語 message を返す', async () => {
    const agent = createAuthAgent(app);
    await signUpUser({
      agent,
      name: 'Auth I18n Organization Owner',
      email: 'auth-i18n-org-owner@example.com',
    });
    await createOrganization({
      agent,
      name: 'Auth I18n Organization',
      slug: 'auth-i18n-organization',
    });

    const response = await agent.request('/api/v1/auth/organizations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Auth I18n Duplicate Organization',
        slug: 'auth-i18n-organization',
      }),
    });

    expect(response.status).toBe(400);
    expect(await toJson(response)).toMatchObject({
      code: 'ORGANIZATION_ALREADY_EXISTS',
      message: '組織は既に存在します。',
      originalMessage: 'Organization already exists',
    });
  });

  it('組織エンドポイントに認証を要求する', async () => {
    const response = await app.request('/api/v1/auth/organizations');

    expect(response.status).toBe(401);
  });

  it('組織アクセスエンドポイントに認証を要求する', async () => {
    const response = await app.request('/api/v1/auth/orgs/access-tree');
    expect(response.status).toBe(401);
  });

  it('招待エンドポイントに認証を要求する', async () => {
    const response = await app.request('/api/v1/auth/orgs/demo/stores/demo/invitations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'member@example.com',
        role: 'staff',
      }),
    });

    expect(response.status).toBe(401);
  });

  it('招待詳細・拒否エンドポイントに認証を要求する', async () => {
    const detailResponse = await app.request(buildInvitationDetailPath('dummy-id'));
    expect(detailResponse.status).toBe(401);

    const rejectResponse = await app.request(buildInvitationActionPath('dummy-id', 'reject'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        invitationId: 'dummy-id',
      }),
    });

    expect(rejectResponse.status).toBe(401);
  });

  it('参加者招待エンドポイントに認証を要求する', async () => {
    const listResponse = await app.request('/api/v1/auth/orgs/demo/stores/demo/invitations');
    expect(listResponse.status).toBe(401);

    const createResponse = await app.request('/api/v1/auth/orgs/demo/stores/demo/invitations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'participant@example.com',
        role: 'participant',
        participantName: 'Participant',
      }),
    });
    expect(createResponse.status).toBe(401);

    const detailResponse = await app.request(buildInvitationDetailPath('dummy-id'));
    expect(detailResponse.status).toBe(401);
  });

  describe('AI ルート連携', () => {
    it('未認証または不正なチャットリクエストを拒否する', async () => {
      const runtime = createAiTestRuntime();

      const unauthenticatedResponse = await runtime.application.request('/api/v1/ai/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: '予約枠の作り方を教えてください',
        }),
      });
      expect(unauthenticatedResponse.status).toBe(401);
      expect(await toJson(unauthenticatedResponse)).toEqual({
        message: 'Unauthorized or forbidden.',
      });

      const owner = await createAiOwnerFixture({
        application: runtime.application,
        prefix: 'ai-invalid-chat',
      });
      const invalidBodyResponse = await postAiChat(owner.agent, {
        message: '',
        organizationId: owner.organizationId,
      });
      expect(invalidBodyResponse.status).toBe(400);
    });

    it('根拠付きチャット回答をソースと使用量つきで保存し操作系の副作用を発生させない', async () => {
      const runtime = createAiTestRuntime({
        answer: '予約枠は予約運用画面から作成できます。',
      });
      const owner = await createAiOwnerFixture({
        application: runtime.application,
        prefix: 'ai-chat-success',
      });
      const knowledge = await insertAiKnowledgeFixture({
        title: '予約枠の作成手順',
        sourcePath: `docs/ai-chat-success-${crypto.randomUUID()}.md`,
        content: '予約枠は管理画面の予約運用から作成します。',
        visibility: 'authenticated',
        organizationId: owner.organizationId,
        storeId: owner.storeId,
      });
      runtime.setMatchedChunkIds([knowledge.chunkId]);

      const beforeCounts = await selectAiOperationRowCounts(owner.organizationId);
      const response = await postAiChat(owner.agent, {
        message: '予約枠の作り方を教えてください',
        organizationId: owner.organizationId,
      });

      expect(response.status).toBe(200);
      const payload = (await toJson(response)) as Record<string, unknown>;
      expect(typeof payload.conversationId).toBe('string');
      expect(typeof payload.messageId).toBe('string');
      expect(payload).toMatchObject({
        answer: '予約枠は予約運用画面から作成できます。',
        confidence: 86,
        needsHumanSupport: false,
      });
      expect(payload.rateLimit).toMatchObject({
        userRemainingThisHour: expect.any(Number),
        organizationRemainingToday: expect.any(Number),
      });
      expect(payload.suggestedActions).toEqual([
        {
          label: '予約運用を開く',
          href: '/admin/bookings',
          actionKind: 'open_page',
        },
      ]);

      const sources = payload.sources as Array<Record<string, unknown>>;
      expect(sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: knowledge.title,
            sourcePath: knowledge.sourcePath,
            chunkId: knowledge.chunkId,
            visibility: 'authenticated',
          }),
          expect.objectContaining({
            sourceKind: 'db_summary',
            title: '現在の業務データ',
          }),
        ]),
      );

      const conversation = await selectAiConversationRow(payload.conversationId as string);
      expect(conversation).toMatchObject({
        id: payload.conversationId,
        actorUserId: owner.userId,
        subjectId: owner.organizationId,
        storeId: owner.storeId,
      });

      const messages = await selectAiMessagesForConversation(payload.conversationId as string);
      expect(messages).toHaveLength(2);
      expect(messages.find((message) => message.role === 'user')).toMatchObject({
        content: '予約枠の作り方を教えてください',
      });
      const assistantMessage = messages.find((message) => message.role === 'assistant');
      expect(assistantMessage).toMatchObject({
        id: payload.messageId,
        content: '予約枠は予約運用画面から作成できます。',
        generationStatus: 'generated',
        errorCode: null,
      });
      expect(JSON.parse(assistantMessage?.sourcesJson ?? '[]')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            chunkId: knowledge.chunkId,
          }),
        ]),
      );

      const usageEvents = await selectAiUsageEventsForConversation(
        payload.conversationId as string,
      );
      expect(usageEvents).toEqual([
        expect.objectContaining({
          messageId: payload.messageId,
          generationStatus: 'generated',
          errorCode: null,
        }),
      ]);
      expect(await selectAiOperationRowCounts(owner.organizationId)).toEqual(beforeCounts);
      expect(runtime.answerPrompts[0]?.userPrompt).toContain('Retrieved docs:');
    });

    it('Vectorize 検索失敗時に検索フォールバック状態を保存する', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const runtime = createAiTestRuntime({
          retrievalShouldFail: true,
        });
        const owner = await createAiOwnerFixture({
          application: runtime.application,
          prefix: 'ai-chat-retrieval-fallback',
        });

        const response = await postAiChat(owner.agent, {
          message: '予約状況を確認したいです',
          organizationId: owner.organizationId,
        });

        expect(response.status).toBe(200);
        const payload = (await toJson(response)) as Record<string, unknown>;
        expect(payload.answer).toContain('ナレッジ検索が一時的に利用できないため');
        expect(payload.needsHumanSupport).toBe(true);
        expect(payload.confidence).toBe(30);

        const messages = await selectAiMessagesForConversation(payload.conversationId as string);
        const assistantMessage = messages.find((message) => message.role === 'assistant');
        expect(assistantMessage).toMatchObject({
          id: payload.messageId,
          generationStatus: 'fallback_retrieval_failed',
          errorCode: 'retrieval_failed',
        });
        expect(assistantMessage?.errorSummary).toContain('vectorize_unavailable');
        expect(JSON.parse(assistantMessage?.retrievedContextJson ?? '{}')).toMatchObject({
          retrievalErrorSummary: expect.stringContaining('vectorize_unavailable'),
        });

        const usageEvents = await selectAiUsageEventsForConversation(
          payload.conversationId as string,
        );
        expect(usageEvents).toEqual([
          expect.objectContaining({
            messageId: payload.messageId,
            generationStatus: 'fallback_retrieval_failed',
            errorCode: 'retrieval_failed',
          }),
        ]);
        expect(runtime.answerPrompts).toHaveLength(0);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('組織をまたぐチャットとスコープ外の会話再利用を拒否する', async () => {
      const runtime = createAiTestRuntime();
      const owner = await createAiOwnerFixture({
        application: runtime.application,
        prefix: 'ai-cross-org-owner',
      });
      const otherOwner = await createAiOwnerFixture({
        application: runtime.application,
        prefix: 'ai-cross-org-other',
      });

      const crossOrganizationResponse = await postAiChat(owner.agent, {
        message: '別組織の情報を見せてください',
        organizationId: otherOwner.organizationId,
      });
      expect(crossOrganizationResponse.status).toBe(401);
      expect(await toJson(crossOrganizationResponse)).toEqual({
        message: 'Unauthorized or forbidden.',
      });

      const firstChatResponse = await postAiChat(owner.agent, {
        message: '最初の会話です',
        organizationId: owner.organizationId,
      });
      expect(firstChatResponse.status).toBe(200);
      const firstChatPayload = (await toJson(firstChatResponse)) as Record<string, unknown>;

      const secondOrganizationSlug = uniqueAiTestToken('ai-conversation-scope');
      const secondOrganizationId = await createOrganization({
        agent: owner.agent,
        name: 'AI Conversation Scope Org',
        slug: secondOrganizationSlug,
      });

      const reuseResponse = await postAiChat(owner.agent, {
        message: '別組織で同じ会話を使います',
        organizationId: secondOrganizationId,
        conversationId: firstChatPayload.conversationId,
      });
      expect(reuseResponse.status).toBe(403);
      expect(await toJson(reuseResponse)).toEqual({
        message: 'Conversation scope is not permitted.',
      });
    });

    it('店舗スコープをリクエストされた組織内に限定する', async () => {
      const runtime = createAiTestRuntime();
      const owner = await createAiOwnerFixture({
        application: runtime.application,
        prefix: 'ai-store-scope',
      });
      const secondStoreId = await insertAiStoreFixture({
        organizationId: owner.organizationId,
        slug: uniqueAiTestToken('ai-second-room'),
        name: 'AI Second Room',
      });
      const otherOwner = await createAiOwnerFixture({
        application: runtime.application,
        prefix: 'ai-other-store-owner',
      });

      const wrongOrganizationStoreResponse = await postAiChat(owner.agent, {
        message: '別組織の店舗を見せてください',
        organizationId: owner.organizationId,
        storeId: otherOwner.storeId,
      });
      expect(wrongOrganizationStoreResponse.status).toBe(401);

      const knowledge = await insertAiKnowledgeFixture({
        title: '第二店舗の予約案内',
        sourcePath: `docs/ai-second-room-${crypto.randomUUID()}.md`,
        content: '第二店舗では予約枠の公開前に定員を確認します。',
        visibility: 'authenticated',
        organizationId: owner.organizationId,
        storeId: secondStoreId,
      });
      runtime.setMatchedChunkIds([knowledge.chunkId]);

      const response = await postAiChat(owner.agent, {
        message: '第二店舗の予約運用を教えてください',
        organizationId: owner.organizationId,
        storeId: secondStoreId,
      });
      expect(response.status).toBe(200);
      const payload = (await toJson(response)) as Record<string, unknown>;
      const conversation = await selectAiConversationRow(payload.conversationId as string);
      expect(conversation?.storeId).toBe(secondStoreId);
      expect(payload.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            chunkId: knowledge.chunkId,
            sourcePath: knowledge.sourcePath,
          }),
        ]),
      );
    });

    it('currentPage をヒントとして扱い参加者の課金情報やソースアクセスを拡張しない', async () => {
      const runtime = createAiTestRuntime({
        answer: '請求の詳細はownerへ確認してください。',
      });
      const owner = await createAiOwnerFixture({
        application: runtime.application,
        prefix: 'ai-participant-redaction',
      });
      await setOrganizationBillingState({
        organizationId: owner.organizationId,
        planCode: 'premium',
        subscriptionStatus: 'active',
        billingInterval: 'month',
        currentPeriodStart: new Date('2026-05-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-06-01T00:00:00.000Z'),
        stripeCustomerId: `cus_${crypto.randomUUID()}`,
        stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
        stripePriceId: `price_${crypto.randomUUID()}`,
      });
      const participant = await createAiParticipantFixture({
        application: runtime.application,
        organizationId: owner.organizationId,
        storeId: owner.storeId,
        prefix: 'ai-participant-redaction-user',
      });
      const participantKnowledge = await insertAiKnowledgeFixture({
        title: '参加者向け予約案内',
        sourcePath: `docs/ai-participant-${crypto.randomUUID()}.md`,
        content: '参加者は予約確認画面で自分の予約状況を確認できます。',
        visibility: 'participant',
        organizationId: owner.organizationId,
        storeId: owner.storeId,
      });
      const ownerOnlyKnowledge = await insertAiKnowledgeFixture({
        title: 'Owner billing detail',
        sourcePath: `docs/ai-owner-billing-${crypto.randomUUID()}.md`,
        content:
          'Owner-only billing detail: 課金プラン premium 契約状態 active 支払い問題開始 なし',
        visibility: 'owner',
        organizationId: owner.organizationId,
        storeId: owner.storeId,
      });
      const internalKnowledge = await insertAiKnowledgeFixture({
        title: 'Internal participant note',
        sourcePath: `docs/ai-internal-${crypto.randomUUID()}.md`,
        content: 'Internal-only participant note should not be exposed.',
        visibility: 'participant',
        internalOnly: true,
        organizationId: owner.organizationId,
        storeId: owner.storeId,
      });
      runtime.setMatchedChunkIds([
        ownerOnlyKnowledge.chunkId,
        internalKnowledge.chunkId,
        participantKnowledge.chunkId,
      ]);

      const response = await postAiChat(participant.agent, {
        message: '請求と予約状況について教えてください',
        organizationId: owner.organizationId,
        storeId: owner.storeId,
        currentPage: '/admin/billing?tab=payment',
      });

      expect(response.status).toBe(200);
      const payload = (await toJson(response)) as Record<string, unknown>;
      const sources = payload.sources as Array<Record<string, unknown>>;
      expect(sources.some((source) => source.chunkId === participantKnowledge.chunkId)).toBe(true);
      expect(sources.some((source) => source.chunkId === ownerOnlyKnowledge.chunkId)).toBe(false);
      expect(sources.some((source) => source.chunkId === internalKnowledge.chunkId)).toBe(false);

      const prompt = runtime.answerPrompts.at(-1)?.userPrompt ?? '';
      expect(prompt).toContain('currentPageHint: /admin/billing?tab=payment');
      expect(prompt).toContain('課金情報: ownerのみ詳細を確認できます。ownerへ確認してください。');
      expect(prompt).not.toContain('Owner-only billing detail');
      expect(prompt).not.toContain('課金プラン: premium');
      expect(prompt).not.toContain('契約状態: active');
      expect(prompt).not.toContain('支払い問題開始:');
    });

    it('メッセージ所有者のフィードバックだけを upsert しペイロードを検証する', async () => {
      const runtime = createAiTestRuntime();
      const owner = await createAiOwnerFixture({
        application: runtime.application,
        prefix: 'ai-feedback-owner',
      });
      const chatResponse = await postAiChat(owner.agent, {
        message: '予約枠の見方を教えてください',
        organizationId: owner.organizationId,
      });
      expect(chatResponse.status).toBe(200);
      const chatPayload = (await toJson(chatResponse)) as Record<string, unknown>;
      const messageId = chatPayload.messageId as string;

      const helpfulResponse = await postAiFeedback({
        agent: owner.agent,
        messageId,
        body: {
          rating: 'helpful',
          comment: 'わかりやすいです',
        },
      });
      expect(helpfulResponse.status).toBe(200);
      expect(await toJson(helpfulResponse)).toMatchObject({
        messageId,
        rating: 'helpful',
      });
      expect(await selectAiFeedbackRowsForMessage(messageId)).toEqual([
        expect.objectContaining({
          userId: owner.userId,
          rating: 'helpful',
          comment: 'わかりやすいです',
        }),
      ]);

      const updatedResponse = await postAiFeedback({
        agent: owner.agent,
        messageId,
        body: {
          rating: 'unhelpful',
          comment: '根拠が足りません',
        },
      });
      expect(updatedResponse.status).toBe(200);
      const updatedRows = await selectAiFeedbackRowsForMessage(messageId);
      expect(updatedRows).toHaveLength(1);
      expect(updatedRows[0]).toMatchObject({
        userId: owner.userId,
        rating: 'unhelpful',
        comment: '根拠が足りません',
      });

      const sameOrganizationUser = await createAiAuthenticatedUser({
        application: runtime.application,
        prefix: 'ai-feedback-same-org',
      });
      await insertOrganizationMember({
        organizationId: owner.organizationId,
        userId: sameOrganizationUser.userId,
        role: 'member',
      });
      const setSameOrganizationActiveResponse = await sameOrganizationUser.agent.request(
        '/api/v1/auth/organizations/set-active',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            organizationId: owner.organizationId,
          }),
        },
      );
      expect(setSameOrganizationActiveResponse.status).toBe(200);
      const sameOrganizationResponse = await postAiFeedback({
        agent: sameOrganizationUser.agent,
        messageId,
        body: {
          rating: 'helpful',
        },
      });
      expect(sameOrganizationResponse.status).toBe(403);
      expect(await selectAiFeedbackRowsForMessage(messageId)).toHaveLength(1);

      const otherOwner = await createAiOwnerFixture({
        application: runtime.application,
        prefix: 'ai-feedback-other-org',
      });
      const otherOrganizationResponse = await postAiFeedback({
        agent: otherOwner.agent,
        messageId,
        body: {
          rating: 'helpful',
        },
      });
      expect(otherOrganizationResponse.status).toBe(403);
      expect(await selectAiFeedbackRowsForMessage(messageId)).toHaveLength(1);

      const invalidRatingResponse = await postAiFeedback({
        agent: owner.agent,
        messageId,
        body: {
          rating: 'neutral',
        },
      });
      expect(invalidRatingResponse.status).toBe(400);

      const invalidCommentResponse = await postAiFeedback({
        agent: owner.agent,
        messageId,
        body: {
          rating: 'helpful',
          comment: 'a'.repeat(1001),
        },
      });
      expect(invalidCommentResponse.status).toBe(400);
      expect(await selectAiFeedbackRowsForMessage(messageId)).toEqual(updatedRows);
    });

    it('内部 AI エンドポイントを保護しナレッジ鮮度とフィードバックテーマを返す', async () => {
      const operatorEmail = `${uniqueAiTestToken('ai-operator')}@example.com`;
      const runtime = createAiTestRuntime({
        operatorEmails: operatorEmail,
      });
      const indexedAt = new Date('2026-05-22T03:04:05.000Z');
      const knowledge = await insertAiKnowledgeFixture({
        title: 'Internal freshness fixture',
        sourcePath: `docs/internal-freshness-${crypto.randomUUID()}.md`,
        visibility: 'owner',
        indexStatus: 'indexed',
        indexedAt,
        lastError: null,
      });

      const owner = await createAiOwnerFixture({
        application: runtime.application,
        prefix: 'ai-feedback-theme-owner',
      });
      const firstChatResponse = await postAiChat(owner.agent, {
        message: '低評価テーマ用の回答1',
        organizationId: owner.organizationId,
      });
      const secondChatResponse = await postAiChat(owner.agent, {
        message: '低評価テーマ用の回答2',
        organizationId: owner.organizationId,
      });
      expect(firstChatResponse.status).toBe(200);
      expect(secondChatResponse.status).toBe(200);
      const firstChatPayload = (await toJson(firstChatResponse)) as Record<string, unknown>;
      const secondChatPayload = (await toJson(secondChatResponse)) as Record<string, unknown>;
      const longComment =
        '回答が古く、予約運用の現在仕様と異なります。画面名と手順を最新化してください。'.repeat(2);
      await insertAiFeedbackFixture({
        messageId: firstChatPayload.messageId as string,
        userId: owner.userId,
        rating: 'unhelpful',
        comment: longComment,
        createdAt: new Date('2026-05-23T00:00:00.000Z'),
      });
      await insertAiFeedbackFixture({
        messageId: secondChatPayload.messageId as string,
        userId: owner.userId,
        rating: 'unhelpful',
        comment: longComment,
        createdAt: new Date('2026-05-24T00:00:00.000Z'),
      });

      const unauthenticatedKnowledgeResponse = await runtime.application.request(
        '/api/v1/internal/ai/knowledge',
      );
      expect(unauthenticatedKnowledgeResponse.status).toBe(401);
      const unauthenticatedThemesResponse = await runtime.application.request(
        '/api/v1/internal/ai/feedback-themes',
      );
      expect(unauthenticatedThemesResponse.status).toBe(401);

      const normalUser = await createAiAuthenticatedUser({
        application: runtime.application,
        prefix: 'ai-internal-normal',
      });
      const normalKnowledgeResponse = await normalUser.agent.request(
        '/api/v1/internal/ai/knowledge',
      );
      expect(normalKnowledgeResponse.status).toBe(403);
      const normalThemesResponse = await normalUser.agent.request(
        '/api/v1/internal/ai/feedback-themes',
      );
      expect(normalThemesResponse.status).toBe(403);

      const operatorAgent = createAuthAgent(runtime.application);
      await signUpUser({
        agent: operatorAgent,
        name: 'AI Internal Operator',
        email: operatorEmail,
      });
      await setUserEmailVerified({ email: operatorEmail });

      const knowledgeResponse = await operatorAgent.request('/api/v1/internal/ai/knowledge');
      expect(knowledgeResponse.status).toBe(200);
      const knowledgePayload = (await toJson(knowledgeResponse)) as {
        documents?: Array<Record<string, unknown>>;
      };
      expect(knowledgePayload.documents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            documentId: knowledge.documentId,
            sourceKind: 'docs',
            title: 'Internal freshness fixture',
            sourcePath: knowledge.sourcePath,
            visibility: 'owner',
            internalOnly: false,
            indexStatus: 'indexed',
            indexedAt: indexedAt.toISOString(),
            lastError: null,
          }),
        ]),
      );

      const themesResponse = await operatorAgent.request('/api/v1/internal/ai/feedback-themes');
      expect(themesResponse.status).toBe(200);
      const themesPayload = (await toJson(themesResponse)) as {
        themes?: Array<Record<string, unknown>>;
      };
      expect(themesPayload.themes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            theme: longComment.slice(0, 80),
            count: 2,
            latestAt: new Date('2026-05-24T00:00:00.000Z').toISOString(),
          }),
        ]),
      );
    });
  });

  it('初回登録者とオーナーの組織作成を許可し招待ユーザーはブロックする', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Initial Owner',
      email: 'initial-owner@example.com',
    });

    const firstOrganizationResponse = await owner.request('/api/v1/auth/organizations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'First Org', slug: 'first-org' }),
    });
    expect(firstOrganizationResponse.status).toBe(200);

    const invalidOrganizationSlugResponse = await owner.request('/api/v1/auth/organizations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Invalid Org', slug: 'Invalid Org' }),
    });
    expect(invalidOrganizationSlugResponse.status).toBe(400);

    const secondOrganizationResponse = await owner.request('/api/v1/auth/organizations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Second Org', slug: 'second-org' }),
    });
    expect(secondOrganizationResponse.status).toBe(200);

    const inviter = createAuthAgent(app);
    await signUpUser({
      agent: inviter,
      name: 'Inviter',
      email: 'org-inviter@example.com',
    });
    const invitedOrganizationId = await createOrganization({
      agent: inviter,
      name: 'Invited Org',
      slug: 'invited-org',
    });
    await enablePremiumForOrganization(invitedOrganizationId);

    const invite = await createInvitation({
      agent: inviter,
      email: 'invited-user@example.com',
      role: 'admin',
      organizationId: invitedOrganizationId,
    });
    expect(invite.response.status).toBe(200);
    const invitationId = String(invite.payload?.id ?? '');
    expect(invitationId.length).toBeGreaterThan(0);

    const invitedUser = createAuthAgent(app);
    await signUpUser({
      agent: invitedUser,
      name: 'Invited User',
      email: 'invited-user@example.com',
    });

    const pendingCreateResponse = await invitedUser.request('/api/v1/auth/organizations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Blocked Org', slug: 'blocked-org-pending' }),
    });
    expect(pendingCreateResponse.status).toBe(403);

    const acceptResponse = await invitedUser.request(
      buildInvitationActionPath(invitationId, 'accept'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ invitationId }),
      },
    );
    expect(acceptResponse.status).toBe(200);

    const acceptedCreateResponse = await invitedUser.request('/api/v1/auth/organizations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Blocked Org Again', slug: 'blocked-org-accepted' }),
    });
    expect(acceptedCreateResponse.status).toBe(403);
  });

  it('無料課金行を作成し Stripe 経由でプレミアム購読状態を同期する', async () => {
    const stripeSecretKey = 'sk_test_billing';
    const stripeWebhookSecret = 'whsec_test_billing';
    const stripeMonthlyPriceId = 'price_premium_monthly';
    const stripeYearlyPriceId = 'price_premium_yearly';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
        STRIPE_PREMIUM_YEARLY_PRICE_ID: stripeYearlyPriceId,
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);

    const originalFetch = globalThis.fetch;
    let latestOrganizationSubscriptionPayload: Record<string, unknown> = {
      id: 'sub_test_org',
      customer: 'cus_test_org',
      status: 'active',
      cancel_at_period_end: false,
      items: {
        data: [
          {
            current_period_start: 1775000000,
            current_period_end: 1777688400,
            price: {
              id: stripeMonthlyPriceId,
            },
          },
        ],
      },
    };
    let lastPortalSessionBody = '';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === 'https://api.stripe.com/v1/customers') {
        return new Response(JSON.stringify({ id: 'cus_test_org' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'https://api.stripe.com/v1/checkout/sessions') {
        return new Response(
          JSON.stringify({
            id: 'cs_test_org_subscription',
            url: 'https://checkout.stripe.com/c/pay/cs_test_org_subscription',
            status: 'open',
            payment_status: 'unpaid',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url === 'https://api.stripe.com/v1/billing_portal/sessions') {
        lastPortalSessionBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(
          JSON.stringify({
            url: 'https://billing.stripe.com/p/session/test_portal',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url.startsWith('https://api.stripe.com/v1/subscriptions/sub_test_org')) {
        return new Response(JSON.stringify(latestOrganizationSubscriptionPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: owner,
        name: 'Billing Owner',
        email: 'billing-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Billing Org',
        slug: 'billing-org',
      });

      const billingAfterCreate = await selectOrganizationBillingRow(organizationId);
      expect(billingAfterCreate?.planCode).toBe('free');
      expect(billingAfterCreate?.subscriptionStatus).toBe('free');

      const admin = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: admin,
        name: 'Billing Admin',
        email: 'billing-admin@example.com',
      });
      const member = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: member,
        name: 'Billing Member',
        email: 'billing-member@example.com',
      });

      await insertOrganizationMember({
        organizationId,
        userId: (await selectUserIdByEmail('billing-admin@example.com')) as string,
        role: 'admin',
      });
      await insertOrganizationMember({
        organizationId,
        userId: (await selectUserIdByEmail('billing-member@example.com')) as string,
        role: 'member',
      });

      const ownerBillingResponse = await owner.request(
        `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
      );
      expect(ownerBillingResponse.status).toBe(200);
      const ownerBillingPayload = (await toJson(ownerBillingResponse)) as Record<string, unknown>;
      expect(ownerBillingPayload.planCode).toBe('free');
      expect(ownerBillingPayload.planState).toBe('free');
      expect(ownerBillingPayload.canViewBilling).toBe(true);
      expect(ownerBillingPayload.canManageBilling).toBe(true);
      expect(ownerBillingPayload.trialEndsAt).toBeNull();
      expect(ownerBillingPayload.history).toEqual([]);
      expect(ownerBillingPayload.paymentDocuments).toEqual({
        aggregateRoot: 'billing_account',
        organizationId,
        provider: 'stripe',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        ownerAccess: 'owner_only',
        persistenceStrategy: 'provider_reference_only',
        documents: [],
      });

      const adminBillingResponse = await admin.request(
        `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
      );
      expect(adminBillingResponse.status).toBe(200);
      const adminBillingPayload = (await toJson(adminBillingResponse)) as Record<string, unknown>;
      expect(adminBillingPayload.planState).toBe('free');
      expect(adminBillingPayload.canViewBilling).toBe(true);
      expect(adminBillingPayload.canManageBilling).toBe(false);
      expect(adminBillingPayload.history).toBeNull();
      expect(adminBillingPayload.paymentDocuments).toBeNull();

      const memberBillingResponse = await member.request(
        `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
      );
      expect(memberBillingResponse.status).toBe(200);
      const memberBillingPayload = (await toJson(memberBillingResponse)) as Record<string, unknown>;
      expect(memberBillingPayload.planCode).toBe('free');
      expect(memberBillingPayload.planState).toBe('free');
      expect(memberBillingPayload.canViewBilling).toBe(true);
      expect(memberBillingPayload.canManageBilling).toBe(false);
      expect(memberBillingPayload.history).toBeNull();
      expect(memberBillingPayload.paymentDocuments).toBeNull();

      const adminCheckoutResponse = await admin.request(
        '/api/v1/auth/organizations/billing/checkout',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            organizationId,
            billingInterval: 'month',
          }),
        },
      );
      expect(adminCheckoutResponse.status).toBe(403);

      const memberCheckoutResponse = await member.request(
        '/api/v1/auth/organizations/billing/checkout',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            organizationId,
            billingInterval: 'month',
          }),
        },
      );
      expect(memberCheckoutResponse.status).toBe(403);

      const ownerCheckoutResponse = await owner.request(
        '/api/v1/auth/organizations/billing/checkout',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            organizationId,
            billingInterval: 'month',
          }),
        },
      );
      expect(ownerCheckoutResponse.status).toBe(200);
      const ownerCheckoutPayload = (await toJson(ownerCheckoutResponse)) as Record<string, unknown>;
      expect(ownerCheckoutPayload.url).toBe(
        'https://checkout.stripe.com/c/pay/cs_test_org_subscription',
      );

      const checkoutCompletedPayload = JSON.stringify({
        id: 'evt_org_checkout_completed',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_org_subscription',
            customer: 'cus_test_org',
            subscription: 'sub_test_org',
            metadata: {
              billingPurpose: 'organization_plan',
              organizationId,
              planCode: 'premium',
              billingInterval: 'month',
            },
          },
        },
      });
      const checkoutCompletedSignature = await createStripeSignatureHeader(
        checkoutCompletedPayload,
        stripeWebhookSecret,
      );
      const checkoutCompletedResponse = await appWithStripe.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': checkoutCompletedSignature,
        },
        body: checkoutCompletedPayload,
      });
      expect(checkoutCompletedResponse.status).toBe(200);

      const billingAfterCheckout = await selectOrganizationBillingRow(organizationId);
      expect(billingAfterCheckout?.planCode).toBe('premium');
      expect(billingAfterCheckout?.stripeCustomerId).toBe('cus_test_org');
      expect(billingAfterCheckout?.stripeSubscriptionId).toBe('sub_test_org');
      expect(billingAfterCheckout?.billingInterval).toBe('month');
      expect(billingAfterCheckout?.subscriptionStatus).toBe('incomplete');

      const subscriptionActivePayload = JSON.stringify({
        id: 'evt_org_subscription_active',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_test_org',
            customer: 'cus_test_org',
            status: 'active',
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  current_period_start: 1775000000,
                  current_period_end: 1777688400,
                  price: {
                    id: stripeMonthlyPriceId,
                  },
                },
              ],
            },
          },
        },
      });
      const subscriptionActiveSignature = await createStripeSignatureHeader(
        subscriptionActivePayload,
        stripeWebhookSecret,
      );
      const subscriptionActiveStartedAt = Date.now();
      const subscriptionActiveResponse = await appWithStripe.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': subscriptionActiveSignature,
        },
        body: subscriptionActivePayload,
      });
      expect(subscriptionActiveResponse.status).toBe(200);

      const subscriptionActiveDuplicateResponse = await appWithStripe.request(
        '/api/webhooks/stripe',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'stripe-signature': subscriptionActiveSignature,
          },
          body: subscriptionActivePayload,
        },
      );
      expect(subscriptionActiveDuplicateResponse.status).toBe(200);

      const billingAfterSubscription = await selectOrganizationBillingRow(organizationId);
      expect(billingAfterSubscription?.planCode).toBe('premium');
      expect(billingAfterSubscription?.subscriptionStatus).toBe('active');
      expect(billingAfterSubscription?.billingInterval).toBe('month');
      expect(billingAfterSubscription?.stripePriceId).toBe(stripeMonthlyPriceId);
      expect(billingAfterSubscription?.currentPeriodEnd).toBe(1777688400000);
      expect(await countStripeWebhookEventRows('evt_org_subscription_active')).toBe(1);
      expect(
        (await selectStripeWebhookEventRow('evt_org_subscription_active'))?.processingStatus,
      ).toBe('processed');

      const activeBillingResponse = await owner.request(
        `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
      );
      expect(activeBillingResponse.status).toBe(200);
      const activeBillingPayload = (await toJson(activeBillingResponse)) as Record<string, unknown>;
      expect(activeBillingPayload.planCode).toBe('premium');
      expect(activeBillingPayload.planState).toBe('premium_paid');
      expect(activeBillingPayload.paidTier).toMatchObject({
        code: 'premium_default',
        label: 'Premium',
        resolution: 'known_price',
        capabilities: ['organization_premium_features'],
      });
      expect(activeBillingPayload.trialEndsAt).toBeNull();
      expect(Date.now() - subscriptionActiveStartedAt).toBeLessThan(60_000);

      const adminPortalResponse = await admin.request('/api/v1/auth/organizations/billing/portal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
        }),
      });
      expect(adminPortalResponse.status).toBe(403);

      const ownerPortalResponse = await owner.request('/api/v1/auth/organizations/billing/portal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
        }),
      });
      expect(ownerPortalResponse.status).toBe(200);
      const ownerPortalPayload = (await toJson(ownerPortalResponse)) as Record<string, unknown>;
      expect(ownerPortalPayload.url).toBe('https://billing.stripe.com/p/session/test_portal');
      const portalParams = new URLSearchParams(lastPortalSessionBody);
      expect(portalParams.get('customer')).toBe('cus_test_org');
      expect(portalParams.get('return_url')).toBe('http://localhost:5173/admin/contracts');
      expect(portalParams.get('flow_data[type]')).toBe('subscription_update');
      expect(portalParams.get('flow_data[subscription_update][subscription]')).toBe('sub_test_org');
      expect(portalParams.get('flow_data[after_completion][type]')).toBe('redirect');
      expect(portalParams.get('flow_data[after_completion][redirect][return_url]')).toBe(
        'http://localhost:5173/admin/contracts?subscription=success',
      );

      latestOrganizationSubscriptionPayload = {
        id: 'sub_test_org',
        customer: 'cus_test_org',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1777688400,
        current_period_end: 1780280400,
        items: {
          data: [
            {
              price: {
                id: stripeYearlyPriceId,
              },
            },
          ],
        },
      };

      const subscriptionPlanChangedPayload = JSON.stringify({
        id: 'evt_org_subscription_plan_changed',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_test_org',
            customer: 'cus_test_org',
            status: 'active',
            cancel_at_period_end: false,
            current_period_start: 1777688400,
            current_period_end: 1780280400,
            items: {
              data: [
                {
                  price: {
                    id: stripeYearlyPriceId,
                  },
                },
              ],
            },
          },
        },
      });
      const subscriptionPlanChangedSignature = await createStripeSignatureHeader(
        subscriptionPlanChangedPayload,
        stripeWebhookSecret,
      );
      const subscriptionPlanChangedResponse = await appWithStripe.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': subscriptionPlanChangedSignature,
        },
        body: subscriptionPlanChangedPayload,
      });
      expect(subscriptionPlanChangedResponse.status).toBe(200);

      const billingAfterPlanChange = await selectOrganizationBillingRow(organizationId);
      expect(billingAfterPlanChange?.planCode).toBe('premium');
      expect(billingAfterPlanChange?.subscriptionStatus).toBe('active');
      expect(billingAfterPlanChange?.billingInterval).toBe('year');
      expect(billingAfterPlanChange?.stripePriceId).toBe(stripeYearlyPriceId);
      expect(billingAfterPlanChange?.currentPeriodStart).toBe(1777688400000);
      expect(billingAfterPlanChange?.currentPeriodEnd).toBe(1780280400000);
      const planChangedSummaryResponse = await owner.request(
        `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
      );
      expect(planChangedSummaryResponse.status).toBe(200);
      const planChangedSummaryPayload = (await toJson(planChangedSummaryResponse)) as Record<
        string,
        unknown
      >;
      expect(planChangedSummaryPayload.planState).toBe('premium_paid');
      expect(planChangedSummaryPayload.billingInterval).toBe('year');
      expect(planChangedSummaryPayload.paidTier).toMatchObject({
        code: 'premium_default',
        resolution: 'known_price',
      });

      latestOrganizationSubscriptionPayload = {
        id: 'sub_test_org',
        customer: 'cus_test_org',
        status: 'canceled',
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: {
                id: stripeYearlyPriceId,
              },
            },
          ],
        },
      };

      const subscriptionDeletedPayload = JSON.stringify({
        id: 'evt_org_subscription_deleted',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_test_org',
            customer: 'cus_test_org',
            status: 'canceled',
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  price: {
                    id: stripeMonthlyPriceId,
                  },
                },
              ],
            },
          },
        },
      });
      const subscriptionDeletedSignature = await createStripeSignatureHeader(
        subscriptionDeletedPayload,
        stripeWebhookSecret,
      );
      const subscriptionDeletedResponse = await appWithStripe.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': subscriptionDeletedSignature,
        },
        body: subscriptionDeletedPayload,
      });
      expect(subscriptionDeletedResponse.status).toBe(200);

      const billingAfterDelete = await selectOrganizationBillingRow(organizationId);
      expect(billingAfterDelete?.planCode).toBe('free');
      expect(billingAfterDelete?.subscriptionStatus).toBe('canceled');
      expect(billingAfterDelete?.stripeSubscriptionId).toBeNull();
      expect(billingAfterDelete?.billingInterval).toBeNull();
      expect(
        (await selectStripeWebhookEventRow('evt_org_subscription_deleted'))?.processingStatus,
      ).toBe('processed');

      const freePortalResponse = await owner.request('/api/v1/auth/organizations/billing/portal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
        }),
      });
      expect(freePortalResponse.status).toBe(409);

      await setOrganizationBillingState({
        organizationId,
        planCode: 'premium',
        subscriptionStatus: 'active',
        stripeCustomerId: 'cus_missing_subscription',
        stripeSubscriptionId: null,
      });
      const missingSubscriptionPortalResponse = await owner.request(
        '/api/v1/auth/organizations/billing/portal',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            organizationId,
          }),
        },
      );
      expect(missingSubscriptionPortalResponse.status).toBe(409);
      const billingAfterMissingSubscriptionPortal =
        await selectOrganizationBillingRow(organizationId);
      expect(billingAfterMissingSubscriptionPortal?.stripeSubscriptionId).toBeNull();

      const trialPeriodEnd = Date.now() + 7 * 24 * 60 * 60 * 1000;
      await setOrganizationBillingState({
        organizationId,
        planCode: 'premium',
        subscriptionStatus: 'trialing',
        currentPeriodEnd: new Date(trialPeriodEnd),
      });

      const trialBillingResponse = await owner.request(
        `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
      );
      expect(trialBillingResponse.status).toBe(200);
      const trialBillingPayload = (await toJson(trialBillingResponse)) as Record<string, unknown>;
      expect(trialBillingPayload.planCode).toBe('premium');
      expect(trialBillingPayload.subscriptionStatus).toBe('trialing');
      expect(trialBillingPayload.planState).toBe('premium_trial');
      expect(trialBillingPayload.trialEndsAt).toBe(new Date(trialPeriodEnd).toISOString());
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('課金 Webhook の Stripe 署名エラーとペイロードエラーを記録する', async () => {
    const stripeWebhookSecret = 'whsec_test_failure_records';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        STRIPE_SECRET_KEY: 'sk_test_failure_records',
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);
    const failureCountBefore = (await selectStripeWebhookFailureRows()).length;

    const missingSignatureResponse = await appWithStripe.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'evt_missing_signature_record',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_missing_signature' } },
      }),
    });
    expect(missingSignatureResponse.status).toBe(400);

    const invalidSignatureResponse = await appWithStripe.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'invalid-header',
      },
      body: JSON.stringify({
        id: 'evt_invalid_signature_record',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_invalid_signature' } },
      }),
    });
    expect(invalidSignatureResponse.status).toBe(400);

    const mismatchedSignaturePayload = JSON.stringify({
      id: 'evt_mismatched_signature_record',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_mismatched_signature' } },
    });
    const mismatchedSignatureResponse = await appWithStripe.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=invalid`,
      },
      body: mismatchedSignaturePayload,
    });
    expect(mismatchedSignatureResponse.status).toBe(400);

    const expiredSignaturePayload = JSON.stringify({
      id: 'evt_expired_signature_record',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_expired_signature' } },
    });
    const expiredSignature = await createStripeSignatureHeader(
      expiredSignaturePayload,
      stripeWebhookSecret,
      Math.floor(Date.now() / 1000) - 1_000,
    );
    const expiredSignatureResponse = await appWithStripe.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': expiredSignature,
      },
      body: expiredSignaturePayload,
    });
    expect(expiredSignatureResponse.status).toBe(400);

    const invalidPayloadBody = 'not-json';
    const invalidPayloadSignature = await createStripeSignatureHeader(
      invalidPayloadBody,
      stripeWebhookSecret,
    );
    const invalidPayloadResponse = await appWithStripe.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': invalidPayloadSignature,
      },
      body: invalidPayloadBody,
    });
    expect(invalidPayloadResponse.status).toBe(400);

    const newFailures = (await selectStripeWebhookFailureRows()).slice(failureCountBefore);
    expect(newFailures).toHaveLength(5);
    expect(newFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: null,
          failureStage: 'signature_verification',
          failureReason: 'signature_missing',
        }),
        expect.objectContaining({
          eventId: null,
          failureStage: 'signature_verification',
          failureReason: 'invalid_signature',
        }),
        expect.objectContaining({
          eventId: null,
          failureStage: 'signature_verification',
          failureReason: 'signature_mismatched',
        }),
        expect.objectContaining({
          eventId: null,
          failureStage: 'signature_verification',
          failureReason: 'signature_expired',
        }),
        expect.objectContaining({
          eventId: null,
          failureStage: 'payload_parse',
          failureReason: 'invalid_payload',
        }),
      ]),
    );
  });

  it('強化されたプレミアム制限状態を適用し課金を組織行に限定する', async () => {
    const { agent: owner, organizationId } = await createBillingFixtureOwner({
      name: 'Billing Hardening Gate Owner',
      email: 'billing-hardening-gate-owner@example.com',
      organizationName: 'Billing Hardening Gate Org',
      slug: `billing-hardening-gate-${crypto.randomUUID().slice(0, 8)}`,
    });
    const now = Date.now();
    const futureGraceEnd = new Date(now + 2 * 24 * 60 * 60 * 1000);
    const expiredGraceEnd = new Date(now - 60_000);

    const legacyTableInfo = await d1
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'organization_billing'",
      )
      .all<{ name: string }>();
    expect(legacyTableInfo.results).toHaveLength(0);
    const legacyWebhookTableInfo = await d1
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('stripe_webhook_event', 'stripe_webhook_failure')",
      )
      .all<{ name: string }>();
    expect(legacyWebhookTableInfo.results).toHaveLength(0);
    const billingAccountTableInfo = await d1
      .prepare('PRAGMA table_info(billing_account)')
      .all<{ name: string }>();
    const billingAccountColumns = billingAccountTableInfo.results.map((row) => row.name);
    expect(billingAccountColumns).toContain('subject_id');
    expect(billingAccountColumns).not.toContain('store_id');
    const readForeignKeys = async (tableName: string) => {
      const result = await d1
        .prepare(`PRAGMA foreign_key_list(${tableName})`)
        .all<{ from: string; table: string }>();
      return result.results;
    };
    const readIndexes = async (tableName: string) => {
      const result = await d1
        .prepare(`PRAGMA index_list(${tableName})`)
        .all<{ name: string; unique: number }>();
      return result.results;
    };
    const expectNoUserForeignKey = async ({
      tableName,
      columnName,
    }: {
      tableName: string;
      columnName: string;
    }) => {
      const foreignKeys = await readForeignKeys(tableName);
      expect(foreignKeys.some((row) => row.from === columnName && row.table === 'user')).toBe(
        false,
      );
      expect(
        foreignKeys.some(
          (row) => row.from === 'billing_account_id' && row.table === 'billing_account',
        ),
      ).toBe(true);
    };
    const expectUniqueIndex = async ({
      tableName,
      indexName,
    }: {
      tableName: string;
      indexName: string;
    }) => {
      const indexes = await readIndexes(tableName);
      expect(indexes).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: indexName, unique: 1 })]),
      );
    };
    await expectNoUserForeignKey({
      tableName: 'billing_operation_attempt',
      columnName: 'created_by_user_id',
    });
    await expectNoUserForeignKey({
      tableName: 'billing_audit_event',
      columnName: 'actor_user_id',
    });
    await expectNoUserForeignKey({
      tableName: 'billing_notification',
      columnName: 'recipient_user_id',
    });
    await expectUniqueIndex({
      tableName: 'billing_operation_attempt',
      indexName: 'billing_operation_attempt_idempotency_uidx',
    });
    await expectUniqueIndex({
      tableName: 'billing_operation_attempt',
      indexName: 'billing_operation_attempt_reuse_attempt_uidx',
    });
    await expectUniqueIndex({
      tableName: 'billing_audit_event',
      indexName: 'billing_audit_event_account_sequence_uidx',
    });
    await expectUniqueIndex({
      tableName: 'billing_notification',
      indexName: 'billing_notification_dedupe_uidx',
    });
    await expectUniqueIndex({
      tableName: 'billing_notification',
      indexName: 'billing_notification_account_sequence_uidx',
    });

    const assertPremiumGate = async ({
      subscriptionStatus,
      expectedStatus,
      expectedReason,
      pastDueGraceEndsAt = null,
      cancelAtPeriodEnd = false,
    }: {
      subscriptionStatus: 'active' | 'past_due' | 'unpaid' | 'incomplete' | 'canceled';
      expectedStatus: number;
      expectedReason?: string;
      pastDueGraceEndsAt?: Date | null;
      cancelAtPeriodEnd?: boolean;
    }) => {
      await setOrganizationBillingState({
        organizationId,
        planCode: 'premium',
        subscriptionStatus,
        billingInterval: 'month',
        currentPeriodStart: new Date(now - 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(now + 29 * 24 * 60 * 60 * 1000),
        paymentIssueStartedAt:
          subscriptionStatus === 'past_due' ||
          subscriptionStatus === 'unpaid' ||
          subscriptionStatus === 'incomplete'
            ? new Date(now - 60_000)
            : null,
        pastDueGraceEndsAt,
        cancelAtPeriodEnd,
      });

      const response = await createPremiumGatedApprovalService({
        agent: owner,
        organizationId,
        name: `Premium gated ${subscriptionStatus} ${crypto.randomUUID().slice(0, 6)}`,
      });
      expect(response.status).toBe(expectedStatus);
      const payload = (await toJson(response)) as Record<string, unknown>;
      if (expectedReason) {
        expect(payload).toMatchObject({
          code: 'organization_premium_required',
          reason: expectedReason,
          entitlementState: 'free_only',
        });
      } else {
        expect(payload).toHaveProperty('id');
      }
    };

    await assertPremiumGate({
      subscriptionStatus: 'incomplete',
      expectedStatus: 403,
      expectedReason: 'premium_paid_incomplete',
    });
    await assertPremiumGate({
      subscriptionStatus: 'past_due',
      pastDueGraceEndsAt: futureGraceEnd,
      expectedStatus: 200,
    });
    await assertPremiumGate({
      subscriptionStatus: 'past_due',
      pastDueGraceEndsAt: expiredGraceEnd,
      expectedStatus: 403,
      expectedReason: 'premium_paid_past_due_grace_expired',
    });
    await assertPremiumGate({
      subscriptionStatus: 'unpaid',
      expectedStatus: 403,
      expectedReason: 'premium_paid_unpaid',
    });
    await assertPremiumGate({
      subscriptionStatus: 'canceled',
      expectedStatus: 403,
      expectedReason: 'premium_paid_canceled',
    });
    await assertPremiumGate({
      subscriptionStatus: 'active',
      cancelAtPeriodEnd: true,
      expectedStatus: 200,
    });

    const profileGapAllowedResponse = await createPremiumGatedApprovalService({
      agent: owner,
      organizationId,
      name: `Premium gated profile ${crypto.randomUUID().slice(0, 6)}`,
    });
    expect(profileGapAllowedResponse.status).toBe(200);

    const defaultStore = await d1
      .prepare('SELECT id FROM store WHERE organization_id = ? LIMIT 1')
      .bind(organizationId)
      .first<{ id: string }>();
    expect(defaultStore?.id).toBeTruthy();
    const accidentalStoreBillingRows = await d1
      .prepare(
        "SELECT COUNT(*) as count FROM billing_account WHERE subject_type = 'organization' AND subject_id = ?",
      )
      .bind(defaultStore?.id)
      .first<{ count: number | string }>();
    if (defaultStore?.id !== organizationId) {
      expect(Number(accidentalStoreBillingRows?.count ?? 0)).toBe(0);
    }
  });

  it('支払い問題サマリー項目を返し猶予状態と終端状態でプレミアムを制御する', async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const issueStartedAt = new Date(Date.now() - 4 * dayMs);
    const activeGraceEndsAt = new Date(issueStartedAt.getTime() + 7 * dayMs);
    const {
      agent: owner,
      organizationId,
      stripeCustomerId,
      stripeSubscriptionId,
    } = await createPaymentIssueBillingFixture({
      name: 'Payment Issue Summary Owner',
      email: 'payment-issue-summary-owner@example.com',
      organizationName: 'Payment Issue Summary Org',
      slug: `payment-issue-summary-${crypto.randomUUID().slice(0, 8)}`,
      paymentIssueStartedAt: issueStartedAt,
      pastDueGraceEndsAt: activeGraceEndsAt,
    });
    await insertOrganizationBillingInvoiceEventRow({
      organizationId,
      stripeEventId: 'evt_payment_issue_summary_failed',
      eventType: 'payment_failed',
      ownerFacingStatus: 'failed',
      stripeCustomerId,
      stripeSubscriptionId,
      stripeInvoiceId: 'in_payment_issue_summary',
      stripePaymentIntentId: 'pi_payment_issue_summary',
      providerStatus: 'open',
      occurredAt: issueStartedAt,
    });

    const activeGraceSummaryResponse = await owner.request(
      `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
    );
    expect(activeGraceSummaryResponse.status).toBe(200);
    expect(await toJson(activeGraceSummaryResponse)).toMatchObject({
      subscriptionStatus: 'past_due',
      paymentIssueState: 'past_due_grace_active',
      paymentIssueTiming: {
        issueStartedAt: issueStartedAt.toISOString(),
        issueStartedAtSource: 'provider_issue_time',
        graceEndsAt: activeGraceEndsAt.toISOString(),
      },
      premiumEligible: true,
      entitlementReason: 'premium_paid_past_due_grace_active',
      nextOwnerAction: null,
    });

    const activeGracePremiumResponse = await createPremiumGatedApprovalService({
      agent: owner,
      organizationId,
      name: `Payment issue grace ${crypto.randomUUID().slice(0, 6)}`,
    });
    expect(activeGracePremiumResponse.status).toBe(200);

    const expiredGraceEndsAt = new Date(Date.now() - 60_000);
    await setOrganizationBillingState({
      organizationId,
      planCode: 'premium',
      subscriptionStatus: 'past_due',
      billingInterval: 'month',
      currentPeriodStart: new Date(Date.now() - dayMs),
      currentPeriodEnd: new Date(Date.now() + 29 * dayMs),
      stripeCustomerId,
      stripeSubscriptionId,
      stripePriceId: null,
      paymentIssueStartedAt: issueStartedAt,
      pastDueGraceEndsAt: expiredGraceEndsAt,
    });

    const expiredSummaryResponse = await owner.request(
      `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
    );
    expect(expiredSummaryResponse.status).toBe(200);
    expect(await toJson(expiredSummaryResponse)).toMatchObject({
      paymentIssueState: 'past_due_grace_expired',
      premiumEligible: false,
      entitlementReason: 'premium_paid_past_due_grace_expired',
    });

    const expiredPremiumResponse = await createPremiumGatedApprovalService({
      agent: owner,
      organizationId,
      name: `Payment issue expired ${crypto.randomUUID().slice(0, 6)}`,
    });
    expect(expiredPremiumResponse.status).toBe(403);
    expect(await toJson(expiredPremiumResponse)).toMatchObject({
      code: 'organization_premium_required',
      reason: 'premium_paid_past_due_grace_expired',
    });
  });

  it('共通の課金アクション応答を返し 30 分以内のオーナーハンドオフを再利用する', async () => {
    const stripeMonthlyPriceId = 'price_handoff_monthly';
    const stripeYearlyPriceId = 'price_handoff_yearly';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        STRIPE_SECRET_KEY: 'sk_test_handoff',
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
        STRIPE_PREMIUM_YEARLY_PRICE_ID: stripeYearlyPriceId,
        STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED: 'true',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);
    const originalFetch = globalThis.fetch;
    let checkoutCounter = 0;
    let setupCounter = 0;
    let portalCounter = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const body = typeof init?.body === 'string' ? init.body : '';
      const params = new URLSearchParams(body);

      if (url === 'https://api.stripe.com/v1/customers') {
        const organizationSuffix =
          params.get('metadata[organizationId]')?.replace(/[^a-zA-Z0-9_]/g, '_') ?? 'handoff_trial';
        return new Response(JSON.stringify({ id: `cus_${organizationSuffix}` }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'https://api.stripe.com/v1/subscriptions') {
        return new Response(
          JSON.stringify({
            id: 'sub_handoff_trial',
            customer: 'cus_handoff_trial',
            status: 'trialing',
            trial_start: 1775000000,
            trial_end: 1775604800,
            items: {
              data: [
                {
                  price: { id: stripeMonthlyPriceId },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url === 'https://api.stripe.com/v1/checkout/sessions') {
        const mode = params.get('mode');
        if (mode === 'setup') {
          setupCounter += 1;
          return new Response(
            JSON.stringify({
              id: `cs_setup_${setupCounter}`,
              url: `https://checkout.stripe.com/c/setup-${setupCounter}`,
              status: 'open',
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          );
        }

        checkoutCounter += 1;
        return new Response(
          JSON.stringify({
            id: `cs_checkout_${checkoutCounter}`,
            url: `https://checkout.stripe.com/c/checkout-${checkoutCounter}`,
            status: 'open',
            payment_status: 'unpaid',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url === 'https://api.stripe.com/v1/billing_portal/sessions') {
        portalCounter += 1;
        return new Response(
          JSON.stringify({
            id: `bps_${portalCounter}`,
            url: `https://billing.stripe.com/p/session-${portalCounter}`,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url.startsWith('https://api.stripe.com/v1/customers/')) {
        return new Response(
          JSON.stringify({
            id: 'cus_handoff_trial',
            invoice_settings: { default_payment_method: null },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return originalFetch(input, init);
    });

    try {
      const { agent: owner, organizationId } = await createBillingFixtureOwner({
        application: appWithStripe,
        name: 'Billing Handoff Owner',
        email: 'billing-handoff-owner@example.com',
        organizationName: 'Billing Handoff Org',
        slug: `billing-handoff-${crypto.randomUUID().slice(0, 8)}`,
      });

      const initialSummaryResponse = await owner.request(
        `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
      );
      expect(initialSummaryResponse.status).toBe(200);
      const initialSummary = (await toJson(initialSummaryResponse)) as Record<string, unknown>;
      expect(initialSummary).toMatchObject({
        actionAvailability: {
          canStartTrial: true,
          canStartPaidCheckout: true,
          availableIntervals: ['month', 'year'],
          nextOwnerAction: 'start_trial',
        },
      });

      const trialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      expect(trialResponse.status).toBe(200);
      const trialPayload = (await toJson(trialResponse)) as Record<string, unknown>;
      expect(trialPayload).toMatchObject({
        status: 'succeeded',
        handoff: null,
        billing: {
          planState: 'premium_trial',
          subscriptionStatus: 'trialing',
          actionAvailability: {
            canStartTrial: false,
            canRegisterPaymentMethod: true,
          },
        },
      });
      expect(
        (await selectOrganizationBillingOperationAttemptRows(organizationId)).filter(
          (row) => row.purpose === 'trial_start',
        ),
      ).toHaveLength(1);

      const firstSetupResponse = await owner.request(
        '/api/v1/auth/organizations/billing/payment-method',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId }),
        },
      );
      expect(firstSetupResponse.status).toBe(200);
      const firstSetupPayload = (await toJson(firstSetupResponse)) as Record<string, unknown>;
      expect(firstSetupPayload).toMatchObject({
        status: 'processing',
        url: 'https://checkout.stripe.com/c/setup-1',
        handoff: {
          purpose: 'payment_method_setup',
          reused: false,
        },
      });

      const reusedSetupResponse = await owner.request(
        '/api/v1/auth/organizations/billing/payment-method',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId }),
        },
      );
      expect(reusedSetupResponse.status).toBe(200);
      expect(await toJson(reusedSetupResponse)).toMatchObject({
        url: 'https://checkout.stripe.com/c/setup-1',
        handoff: {
          purpose: 'payment_method_setup',
          reused: true,
        },
      });

      await d1
        .prepare(
          "UPDATE billing_operation_attempt SET handoff_expires_at = ?, idempotency_key = idempotency_key || ':expired' WHERE billing_account_id IN (SELECT id FROM billing_account WHERE subject_type = 'organization' AND subject_id = ?) AND purpose = 'create_setup_checkout'",
        )
        .bind(Date.now() - 1_000, organizationId)
        .run();
      const recreatedSetupResponse = await owner.request(
        '/api/v1/auth/organizations/billing/payment-method',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId }),
        },
      );
      expect(recreatedSetupResponse.status).toBe(200);
      expect(await toJson(recreatedSetupResponse)).toMatchObject({
        url: 'https://checkout.stripe.com/c/setup-2',
        handoff: {
          purpose: 'payment_method_setup',
          reused: false,
        },
      });

      const { agent: checkoutOwner, organizationId: checkoutOrganizationId } =
        await createBillingFixtureOwner({
          application: appWithStripe,
          name: 'Billing Checkout Handoff Owner',
          email: 'billing-checkout-handoff-owner@example.com',
          organizationName: 'Billing Checkout Handoff Org',
          slug: `billing-checkout-handoff-${crypto.randomUUID().slice(0, 8)}`,
        });
      await d1
        .prepare(
          "UPDATE billing_subscription SET trial_start = ?, updated_at = ? WHERE billing_account_id = (SELECT id FROM billing_account WHERE subject_type = 'organization' AND subject_id = ? LIMIT 1)",
        )
        .bind(Date.now() - 7 * 24 * 60 * 60 * 1000, Date.now(), checkoutOrganizationId)
        .run();
      await syncOrganizationBillingV2FixtureFromLegacyRow(checkoutOrganizationId);

      const trialUsedSummaryResponse = await checkoutOwner.request(
        `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(checkoutOrganizationId)}`,
      );
      expect(trialUsedSummaryResponse.status).toBe(200);
      expect(await toJson(trialUsedSummaryResponse)).toMatchObject({
        actionAvailability: {
          canStartTrial: false,
          canStartPaidCheckout: true,
          trialUsed: true,
          availableIntervals: ['month', 'year'],
        },
      });

      const firstCheckoutResponse = await checkoutOwner.request(
        '/api/v1/auth/organizations/billing/checkout',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            organizationId: checkoutOrganizationId,
            billingInterval: 'month',
          }),
        },
      );
      expect(firstCheckoutResponse.status).toBe(200);
      expect(await toJson(firstCheckoutResponse)).toMatchObject({
        url: 'https://checkout.stripe.com/c/checkout-1',
        handoff: {
          purpose: 'paid_checkout',
          reused: false,
        },
      });

      const reusedCheckoutResponse = await checkoutOwner.request(
        '/api/v1/auth/organizations/billing/checkout',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            organizationId: checkoutOrganizationId,
            billingInterval: 'month',
          }),
        },
      );
      expect(reusedCheckoutResponse.status).toBe(200);
      expect(await toJson(reusedCheckoutResponse)).toMatchObject({
        url: 'https://checkout.stripe.com/c/checkout-1',
        handoff: {
          purpose: 'paid_checkout',
          reused: true,
        },
      });

      const { agent: portalOwner, organizationId: portalOrganizationId } =
        await createBillingFixtureOwner({
          application: appWithStripe,
          name: 'Billing Portal Handoff Owner',
          email: 'billing-portal-handoff-owner@example.com',
          organizationName: 'Billing Portal Handoff Org',
          slug: `billing-portal-handoff-${crypto.randomUUID().slice(0, 8)}`,
        });
      await setOrganizationBillingState({
        organizationId: portalOrganizationId,
        planCode: 'premium',
        subscriptionStatus: 'past_due',
        billingInterval: 'month',
        stripeCustomerId: 'cus_portal_handoff',
        stripeSubscriptionId: 'sub_portal_handoff',
        stripePriceId: stripeMonthlyPriceId,
        paymentIssueStartedAt: new Date(Date.now() - 60_000),
        pastDueGraceEndsAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
      });

      const firstPortalResponse = await portalOwner.request(
        '/api/v1/auth/organizations/billing/portal',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId: portalOrganizationId }),
        },
      );
      expect(firstPortalResponse.status).toBe(200);
      expect(await toJson(firstPortalResponse)).toMatchObject({
        url: 'https://billing.stripe.com/p/session-1',
        handoff: {
          purpose: 'billing_portal',
          reused: false,
        },
      });

      const reusedPortalResponse = await portalOwner.request(
        '/api/v1/auth/organizations/billing/portal',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId: portalOrganizationId }),
        },
      );
      expect(reusedPortalResponse.status).toBe(200);
      expect(await toJson(reusedPortalResponse)).toMatchObject({
        url: 'https://billing.stripe.com/p/session-1',
        handoff: {
          purpose: 'billing_portal',
          reused: true,
        },
      });

      await d1
        .prepare(
          "UPDATE billing_operation_attempt SET handoff_expires_at = ?, idempotency_key = idempotency_key || ':expired' WHERE billing_account_id IN (SELECT id FROM billing_account WHERE subject_type = 'organization' AND subject_id = ?) AND purpose = 'create_portal_session'",
        )
        .bind(Date.now() - 1_000, portalOrganizationId)
        .run();
      const recreatedPortalResponse = await portalOwner.request(
        '/api/v1/auth/organizations/billing/portal',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId: portalOrganizationId }),
        },
      );
      expect(recreatedPortalResponse.status).toBe(200);
      expect(await toJson(recreatedPortalResponse)).toMatchObject({
        url: 'https://billing.stripe.com/p/session-2',
        handoff: {
          purpose: 'billing_portal',
          reused: false,
        },
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('Stripe 価格がない場合も課金情報は読み取り可能にしつつオーナーハンドオフをブロックする', async () => {
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        STRIPE_SECRET_KEY: 'sk_test_missing_prices',
        STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED: 'true',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);
    const { agent: owner, organizationId } = await createBillingFixtureOwner({
      application: appWithStripe,
      name: 'Missing Price Owner',
      email: 'missing-price-owner@example.com',
      organizationName: 'Missing Price Org',
      slug: `missing-price-${crypto.randomUUID().slice(0, 8)}`,
    });

    const summaryResponse = await owner.request(
      `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
    );
    expect(summaryResponse.status).toBe(200);
    expect(await toJson(summaryResponse)).toMatchObject({
      actionAvailability: {
        canStartTrial: false,
        canStartPaidCheckout: false,
        availableIntervals: [],
        readOnlyReason: 'billing_price_not_configured',
      },
    });

    const checkoutResponse = await owner.request('/api/v1/auth/organizations/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId, billingInterval: 'month' }),
    });
    expect(checkoutResponse.status).toBe(422);
    expect(await toJson(checkoutResponse)).toMatchObject({
      status: 'failed',
      message: 'Stripe premium month price id is not configured.',
    });

    const trialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId }),
    });
    expect(trialResponse.status).toBe(422);
    expect(await toJson(trialResponse)).toMatchObject({
      status: 'failed',
      message: 'Stripe premium trial price id is not configured.',
    });
  });

  it('トライアル設定失敗とポータル課金操作試行を即座に失敗として記録する', async () => {
    const stripeMonthlyPriceId = 'price_operation_failure_monthly';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        STRIPE_SECRET_KEY: 'sk_test_operation_failure',
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
        STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED: 'true',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const body = typeof init?.body === 'string' ? init.body : '';
      const params = new URLSearchParams(body);

      if (url === 'https://api.stripe.com/v1/customers') {
        const organizationSuffix =
          params.get('metadata[organizationId]')?.replace(/[^a-zA-Z0-9_]/g, '_') ??
          crypto.randomUUID().replace(/-/g, '_');
        return new Response(JSON.stringify({ id: `cus_failure_${organizationSuffix}` }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'https://api.stripe.com/v1/subscriptions') {
        return new Response(
          JSON.stringify({
            error: { message: 'Stripe trial subscription failed.' },
          }),
          {
            status: 500,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url === 'https://api.stripe.com/v1/checkout/sessions') {
        return new Response(
          JSON.stringify({
            error: { message: 'Stripe setup checkout failed.' },
          }),
          {
            status: 500,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url === 'https://api.stripe.com/v1/billing_portal/sessions') {
        return new Response(
          JSON.stringify({
            error: { message: 'Stripe billing portal failed.' },
          }),
          {
            status: 500,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: owner,
        name: 'Operation Failure Owner',
        email: 'operation-failure-owner@example.com',
      });

      const trialOrganizationId = await createOrganization({
        agent: owner,
        name: 'Operation Failure Trial Org',
        slug: `operation-failure-trial-${crypto.randomUUID().slice(0, 8)}`,
      });
      const trialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: trialOrganizationId }),
      });
      expect(trialResponse.status).toBe(500);
      expect(await toJson(trialResponse)).toMatchObject({
        status: 'failed',
        message: 'Stripe trial subscription failed.',
      });

      const retryTrialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: trialOrganizationId }),
      });
      expect(retryTrialResponse.status).toBe(500);
      const trialAttempts =
        await selectOrganizationBillingOperationAttemptRows(trialOrganizationId);
      expect(trialAttempts).toHaveLength(2);
      expect(new Set(trialAttempts.map((attempt) => attempt.idempotencyKey)).size).toBe(2);
      expect(trialAttempts).toEqual([
        expect.objectContaining({
          purpose: 'trial_start',
          state: 'failed',
          failureReason: 'Stripe trial subscription failed.',
        }),
        expect.objectContaining({
          purpose: 'trial_start',
          state: 'failed',
          failureReason: 'Stripe trial subscription failed.',
        }),
      ]);

      const setupOrganizationId = await createOrganization({
        agent: owner,
        name: 'Operation Failure Setup Org',
        slug: `operation-failure-setup-${crypto.randomUUID().slice(0, 8)}`,
      });
      await setOrganizationBillingState({
        organizationId: setupOrganizationId,
        planCode: 'premium',
        subscriptionStatus: 'trialing',
        billingInterval: 'month',
        currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      const setupResponse = await owner.request(
        '/api/v1/auth/organizations/billing/payment-method',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId: setupOrganizationId }),
        },
      );
      expect(setupResponse.status).toBe(500);
      expect(await toJson(setupResponse)).toMatchObject({
        status: 'failed',
        message: 'Stripe setup checkout failed.',
      });
      expect(await selectOrganizationBillingOperationAttemptRows(setupOrganizationId)).toEqual([
        expect.objectContaining({
          purpose: 'payment_method_setup',
          state: 'failed',
          failureReason: 'Stripe setup checkout failed.',
        }),
      ]);

      const portalOrganizationId = await createOrganization({
        agent: owner,
        name: 'Operation Failure Portal Org',
        slug: `operation-failure-portal-${crypto.randomUUID().slice(0, 8)}`,
      });
      await setOrganizationBillingState({
        organizationId: portalOrganizationId,
        planCode: 'premium',
        subscriptionStatus: 'active',
        billingInterval: 'month',
        currentPeriodStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000),
        stripeCustomerId: 'cus_operation_failure_portal',
        stripeSubscriptionId: 'sub_operation_failure_portal',
        stripePriceId: stripeMonthlyPriceId,
      });
      const portalResponse = await owner.request('/api/v1/auth/organizations/billing/portal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: portalOrganizationId }),
      });
      expect(portalResponse.status).toBe(500);
      expect(await toJson(portalResponse)).toMatchObject({
        status: 'failed',
        message: 'Stripe billing portal failed.',
      });
      expect(await selectOrganizationBillingOperationAttemptRows(portalOrganizationId)).toEqual([
        expect.objectContaining({
          purpose: 'billing_portal',
          state: 'failed',
          failureReason: 'Stripe billing portal failed.',
        }),
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('請求書支払い Webhook を正規化し重複を抑止して支払い問題通知を記録する', async () => {
    const stripeWebhookSecret = 'whsec_test_invoice_payment_events';
    const stripeMonthlyPriceId = 'price_invoice_payment_monthly';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        STRIPE_SECRET_KEY: 'sk_test_invoice_payment_events',
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
        RESEND_API_KEY: 'test-resend-api-key',
        RESEND_FROM_EMAIL: 'no-reply@example.com',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);
    const resendRequests: Array<{ to: string[]; subject: string }> = [];
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === 'https://api.resend.com/emails') {
        const payloadText = typeof init?.body === 'string' ? init.body : '{}';
        const payload = JSON.parse(payloadText) as { to?: unknown; subject?: unknown };
        resendRequests.push({
          to: Array.isArray(payload.to)
            ? payload.to.filter((value): value is string => typeof value === 'string')
            : [],
          subject: typeof payload.subject === 'string' ? payload.subject : '',
        });

        return new Response(JSON.stringify({ id: crypto.randomUUID() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.startsWith('https://api.stripe.com/v1/customers/')) {
        return new Response(
          JSON.stringify({
            id: 'cus_invoice_payment',
            invoice_settings: { default_payment_method: 'pm_card_visa' },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return originalFetch(input, init);
    });

    const sendInvoiceWebhook = async ({
      eventId,
      eventType,
      invoiceId,
      customerId,
      subscriptionId,
      paymentIntentId,
      chargeId,
      created,
    }: {
      eventId: string;
      eventType:
        | 'invoice.finalized'
        | 'invoice.payment_succeeded'
        | 'invoice.payment_failed'
        | 'invoice.payment_action_required';
      invoiceId: string;
      customerId: string;
      subscriptionId: string;
      paymentIntentId: string;
      chargeId?: string;
      created: number;
    }) => {
      const payload = JSON.stringify({
        id: eventId,
        type: eventType,
        data: {
          object: {
            id: invoiceId,
            customer: customerId,
            subscription: subscriptionId,
            payment_intent: {
              id: paymentIntentId,
              latest_charge: chargeId
                ? {
                    id: chargeId,
                    customer: customerId,
                    receipt_url: `https://pay.stripe.com/receipts/${chargeId}`,
                  }
                : null,
            },
            status: eventType === 'invoice.payment_failed' ? 'open' : 'paid',
            created,
            hosted_invoice_url: `https://invoice.stripe.com/i/${invoiceId}`,
            invoice_pdf: `https://invoice.stripe.com/i/${invoiceId}.pdf`,
          },
        },
      });
      const signature = await createStripeSignatureHeader(payload, stripeWebhookSecret);
      return appWithStripe.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signature,
        },
        body: payload,
      });
    };

    try {
      const { organizationId } = await createBillingFixtureOwner({
        application: appWithStripe,
        name: 'Invoice Payment Verified Owner',
        email: 'invoice-payment-verified-owner@example.com',
        organizationName: 'Invoice Payment Verified Org',
        slug: `invoice-payment-verified-${crypto.randomUUID().slice(0, 8)}`,
        emailVerified: true,
      });
      const secondVerifiedOwner = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: secondVerifiedOwner,
        name: 'Invoice Payment Second Verified Owner',
        email: 'invoice-payment-second-verified-owner@example.com',
      });
      await setUserEmailVerified({
        email: 'invoice-payment-second-verified-owner@example.com',
      });
      const secondVerifiedOwnerUserId = await selectUserIdByEmail(
        'invoice-payment-second-verified-owner@example.com',
      );
      if (!secondVerifiedOwnerUserId) {
        throw new Error('second verified owner user was not created');
      }
      await insertOrganizationMember({
        organizationId,
        userId: secondVerifiedOwnerUserId,
        role: 'owner',
      });
      await setOrganizationBillingState({
        organizationId,
        planCode: 'premium',
        subscriptionStatus: 'active',
        billingInterval: 'month',
        stripeCustomerId: 'cus_invoice_payment',
        stripeSubscriptionId: 'sub_invoice_payment',
        stripePriceId: stripeMonthlyPriceId,
      });

      for (const [eventId, eventType, invoiceId, paymentIntentId, chargeId] of [
        [
          'evt_invoice_available_verified',
          'invoice.finalized',
          'in_invoice_available_verified',
          'pi_invoice_available_verified',
          undefined,
        ],
        [
          'evt_payment_succeeded_verified',
          'invoice.payment_succeeded',
          'in_payment_succeeded_verified',
          'pi_payment_succeeded_verified',
          'ch_payment_succeeded_verified',
        ],
        [
          'evt_payment_failed_verified',
          'invoice.payment_failed',
          'in_payment_failed_verified',
          'pi_payment_failed_verified',
          undefined,
        ],
        [
          'evt_payment_action_required_verified',
          'invoice.payment_action_required',
          'in_payment_action_required_verified',
          'pi_payment_action_required_verified',
          undefined,
        ],
      ] as const) {
        const response = await sendInvoiceWebhook({
          eventId,
          eventType,
          invoiceId,
          customerId: 'cus_invoice_payment',
          subscriptionId: 'sub_invoice_payment',
          paymentIntentId,
          chargeId,
          created: 1775000000,
        });
        expect(response.status).toBe(200);
      }

      for (let replayIndex = 0; replayIndex < 5; replayIndex += 1) {
        const duplicateFailedResponse = await sendInvoiceWebhook({
          eventId: 'evt_payment_failed_verified',
          eventType: 'invoice.payment_failed',
          invoiceId: 'in_payment_failed_verified',
          customerId: 'cus_invoice_payment',
          subscriptionId: 'sub_invoice_payment',
          paymentIntentId: 'pi_payment_failed_verified',
          created: 1775000000,
        });
        expect(duplicateFailedResponse.status).toBe(200);
      }

      expect(await selectOrganizationBillingInvoiceEventRows(organizationId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stripeEventId: 'evt_invoice_available_verified',
            eventType: 'invoice_available',
            ownerFacingStatus: 'available',
          }),
          expect.objectContaining({
            stripeEventId: 'evt_payment_succeeded_verified',
            eventType: 'payment_succeeded',
            ownerFacingStatus: 'succeeded',
          }),
          expect.objectContaining({
            stripeEventId: 'evt_payment_failed_verified',
            eventType: 'payment_failed',
            ownerFacingStatus: 'failed',
          }),
          expect.objectContaining({
            stripeEventId: 'evt_payment_action_required_verified',
            eventType: 'payment_action_required',
            ownerFacingStatus: 'action_required',
          }),
        ]),
      );
      expect(await selectOrganizationBillingInvoiceEventRows(organizationId)).toHaveLength(4);
      expect(await selectReserveAppBillingDocumentReferenceRows(organizationId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            documentKind: 'invoice',
            providerDocumentId: 'in_invoice_available_verified',
            availability: 'available',
            ownerFacingStatus: 'available',
          }),
          expect.objectContaining({
            documentKind: 'receipt',
            providerDocumentId: 'ch_payment_succeeded_verified',
            availability: 'available',
            ownerFacingStatus: 'available',
          }),
        ]),
      );
      expect(await selectBillingDocumentReferenceRowsBySubject(organizationId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            documentKind: 'invoice',
            providerDocumentId: 'in_invoice_available_verified',
            availability: 'available',
            ownerFacingStatus: 'available',
          }),
          expect.objectContaining({
            documentKind: 'receipt',
            providerDocumentId: 'ch_payment_succeeded_verified',
            availability: 'available',
            ownerFacingStatus: 'available',
          }),
        ]),
      );
      expect(await selectStripeWebhookEventRow('evt_payment_failed_verified')).toMatchObject({
        processingStatus: 'processed',
        duplicateDetected: 1,
        receiptStatus: 'duplicate',
      });
      expect(await selectBillingProviderEventRow('evt_payment_failed_verified')).toMatchObject({
        eventType: 'invoice.payment_failed',
        processingStatus: 'processed',
        receiptStatus: 'duplicate',
        duplicateDetected: 1,
        attemptCount: 1,
      });
      const paymentIssueEventRows =
        await selectBillingPaymentIssueEventRowsBySubject(organizationId);
      expect(paymentIssueEventRows).toHaveLength(4);
      expect(paymentIssueEventRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: 'invoice_available',
            providerEventId: 'evt_invoice_available_verified',
            providerInvoiceId: 'in_invoice_available_verified',
            providerPaymentIntentId: 'pi_invoice_available_verified',
          }),
          expect.objectContaining({
            eventType: 'payment_succeeded',
            providerEventId: 'evt_payment_succeeded_verified',
            providerInvoiceId: 'in_payment_succeeded_verified',
            providerPaymentIntentId: 'pi_payment_succeeded_verified',
          }),
          expect.objectContaining({
            eventType: 'payment_failed',
            providerEventId: 'evt_payment_failed_verified',
            providerInvoiceId: 'in_payment_failed_verified',
            providerPaymentIntentId: 'pi_payment_failed_verified',
          }),
          expect.objectContaining({
            eventType: 'payment_action_required',
            providerEventId: 'evt_payment_action_required_verified',
            providerInvoiceId: 'in_payment_action_required_verified',
            providerPaymentIntentId: 'pi_payment_action_required_verified',
          }),
        ]),
      );
      expect(await selectBillingPaymentIssueRowBySubject(organizationId)).toMatchObject({
        state: 'payment_action_required',
        issueStartedAtSource: 'provider_issue_time',
        latestProviderEventId: 'evt_payment_action_required_verified',
        latestInvoiceId: 'in_payment_action_required_verified',
        latestPaymentIntentId: 'pi_payment_action_required_verified',
      });

      const notificationRows = await selectOrganizationBillingNotificationRows(organizationId);
      expect(notificationRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            notificationKind: 'payment_failed_email',
            deliveryState: 'requested',
            recipientEmail: 'invoice-payment-verified-owner@example.com',
          }),
          expect.objectContaining({
            notificationKind: 'payment_failed_email',
            deliveryState: 'sent',
            recipientEmail: 'invoice-payment-verified-owner@example.com',
          }),
          expect.objectContaining({
            notificationKind: 'payment_failed_email',
            deliveryState: 'requested',
            recipientEmail: 'invoice-payment-second-verified-owner@example.com',
          }),
          expect.objectContaining({
            notificationKind: 'payment_failed_email',
            deliveryState: 'sent',
            recipientEmail: 'invoice-payment-second-verified-owner@example.com',
          }),
          expect.objectContaining({
            notificationKind: 'payment_action_required_email',
            deliveryState: 'requested',
            recipientEmail: 'invoice-payment-verified-owner@example.com',
          }),
          expect.objectContaining({
            notificationKind: 'payment_action_required_email',
            deliveryState: 'sent',
            recipientEmail: 'invoice-payment-verified-owner@example.com',
          }),
          expect.objectContaining({
            notificationKind: 'payment_action_required_email',
            deliveryState: 'requested',
            recipientEmail: 'invoice-payment-second-verified-owner@example.com',
          }),
          expect.objectContaining({
            notificationKind: 'payment_action_required_email',
            deliveryState: 'sent',
            recipientEmail: 'invoice-payment-second-verified-owner@example.com',
          }),
        ]),
      );
      expect(
        notificationRows.filter((row) => row.notificationKind === 'payment_failed_email'),
      ).toHaveLength(4);
      expect(
        notificationRows.filter((row) => row.notificationKind === 'payment_action_required_email'),
      ).toHaveLength(4);
      expect(await selectBillingNotificationRowsBySubject(organizationId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            notificationKind: 'payment_failed_email',
            deliveryStatus: 'sent',
            recipientEmail: 'invoice-payment-verified-owner@example.com',
            providerEventId: 'evt_payment_failed_verified',
            providerInvoiceId: 'in_payment_failed_verified',
          }),
          expect.objectContaining({
            notificationKind: 'payment_action_required_email',
            deliveryStatus: 'sent',
            recipientEmail: 'invoice-payment-second-verified-owner@example.com',
            providerEventId: 'evt_payment_action_required_verified',
            providerInvoiceId: 'in_payment_action_required_verified',
          }),
        ]),
      );
      expect(await selectBillingNotificationRowsBySubject(organizationId)).toHaveLength(4);
      expect(resendRequests).toHaveLength(4);
      expect(resendRequests.flatMap((request) => request.to).sort()).toEqual([
        'invoice-payment-second-verified-owner@example.com',
        'invoice-payment-second-verified-owner@example.com',
        'invoice-payment-verified-owner@example.com',
        'invoice-payment-verified-owner@example.com',
      ]);

      const { organizationId: unverifiedOrganizationId } = await createBillingFixtureOwner({
        application: appWithStripe,
        name: 'Invoice Payment Unverified Owner',
        email: 'invoice-payment-unverified-owner@example.com',
        organizationName: 'Invoice Payment Unverified Org',
        slug: `invoice-payment-unverified-${crypto.randomUUID().slice(0, 8)}`,
      });
      await setUserEmailVerified({
        email: 'invoice-payment-unverified-owner@example.com',
        verified: false,
      });
      await setOrganizationBillingState({
        organizationId: unverifiedOrganizationId,
        planCode: 'premium',
        subscriptionStatus: 'active',
        billingInterval: 'month',
        stripeCustomerId: 'cus_invoice_payment_unverified',
        stripeSubscriptionId: 'sub_invoice_payment_unverified',
        stripePriceId: stripeMonthlyPriceId,
      });

      const unverifiedResponse = await sendInvoiceWebhook({
        eventId: 'evt_payment_failed_unverified',
        eventType: 'invoice.payment_failed',
        invoiceId: 'in_payment_failed_unverified',
        customerId: 'cus_invoice_payment_unverified',
        subscriptionId: 'sub_invoice_payment_unverified',
        paymentIntentId: 'pi_payment_failed_unverified',
        created: 1775000000,
      });
      expect(unverifiedResponse.status).toBe(200);
      expect(await selectOrganizationBillingNotificationRows(unverifiedOrganizationId)).toEqual([
        expect.objectContaining({
          notificationKind: 'payment_failed_email',
          deliveryState: 'requested',
          failureReason: 'verified_owner_not_found',
          recipientEmail: null,
        }),
        expect.objectContaining({
          notificationKind: 'payment_failed_email',
          deliveryState: 'failed',
          failureReason: 'verified_owner_not_found',
          recipientEmail: null,
        }),
      ]);
      expect(await selectOrganizationBillingSignalRows(unverifiedOrganizationId)).toEqual([
        expect.objectContaining({
          signalKind: 'notification_delivery',
          signalStatus: 'unavailable',
          sourceKind: 'payment_failed_email',
          reason: 'verified_owner_not_found',
          stripeEventId: 'evt_payment_failed_unverified',
        }),
      ]);
      expect(await selectBillingSignalRowsBySubject(unverifiedOrganizationId)).toEqual([
        expect.objectContaining({
          signalKind: 'notification_delivery',
          signalStatus: 'unavailable',
          sourceKind: 'payment_failed_email',
          reason: 'verified_owner_not_found',
          providerEventId: 'evt_payment_failed_unverified',
        }),
      ]);
      expect(resendRequests).toHaveLength(4);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('プロバイダー復旧後も遅延した古い支払い失敗を履歴とサポート文脈として保持する', async () => {
    const stripeWebhookSecret = 'whsec_test_stale_payment_issue';
    const stripeMonthlyPriceId = 'price_stale_payment_issue_monthly';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        STRIPE_SECRET_KEY: 'sk_test_stale_payment_issue',
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
        RESEND_API_KEY: 'test-resend-api-key',
        RESEND_FROM_EMAIL: 'no-reply@example.com',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);
    const resendRequests: Array<unknown> = [];
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://api.resend.com/emails') {
        resendRequests.push(init?.body ?? null);
        return new Response(JSON.stringify({ id: crypto.randomUUID() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.startsWith('https://api.stripe.com/v1/subscriptions/sub_stale_payment_issue')) {
        return new Response(
          JSON.stringify({
            id: 'sub_stale_payment_issue',
            customer: 'cus_stale_payment_issue',
            status: 'active',
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  current_period_start: 1775000000,
                  current_period_end: 1777688400,
                  price: { id: stripeMonthlyPriceId },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (url.startsWith('https://api.stripe.com/v1/customers/')) {
        return new Response(
          JSON.stringify({
            id: 'cus_stale_payment_issue',
            invoice_settings: { default_payment_method: 'pm_card_visa' },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      return originalFetch(input, init);
    });

    try {
      const { organizationId } = await createPaymentIssueBillingFixture({
        application: appWithStripe,
        name: 'Stale Payment Issue Owner',
        email: 'stale-payment-issue-owner@example.com',
        organizationName: 'Stale Payment Issue Org',
        slug: `stale-payment-issue-${crypto.randomUUID().slice(0, 8)}`,
        subscriptionStatus: 'active',
        stripeCustomerId: 'cus_stale_payment_issue',
        stripeSubscriptionId: 'sub_stale_payment_issue',
        stripePriceId: stripeMonthlyPriceId,
        paymentIssueStartedAt: null,
        pastDueGraceEndsAt: null,
      });
      const payload = JSON.stringify({
        id: 'evt_stale_payment_failed_after_recovery',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_stale_payment_failed_after_recovery',
            customer: 'cus_stale_payment_issue',
            subscription: 'sub_stale_payment_issue',
            payment_intent: 'pi_stale_payment_failed_after_recovery',
            status: 'open',
            created: 1774990000,
          },
        },
      });
      const signature = await createStripeSignatureHeader(payload, stripeWebhookSecret);
      const response = await appWithStripe.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signature,
        },
        body: payload,
      });

      expect(response.status).toBe(200);
      expect(await selectOrganizationBillingInvoiceEventRows(organizationId)).toEqual([
        expect.objectContaining({
          stripeEventId: 'evt_stale_payment_failed_after_recovery',
          eventType: 'payment_failed',
        }),
      ]);
      expect(await selectOrganizationBillingNotificationRows(organizationId)).toEqual([]);
      expect(resendRequests).toHaveLength(0);
      expect(await selectOrganizationBillingSignalRows(organizationId)).toEqual([
        expect.objectContaining({
          signalKind: 'reconciliation',
          signalStatus: 'resolved',
          sourceKind: 'webhook_payment_failed',
          reason: 'stale_payment_issue_after_recovery',
          stripeEventId: 'evt_stale_payment_failed_after_recovery',
        }),
      ]);
      expect(await selectBillingSignalRowsBySubject(organizationId)).toEqual([
        expect.objectContaining({
          signalKind: 'reconciliation',
          signalStatus: 'resolved',
          sourceKind: 'webhook_payment_failed',
          reason: 'stale_payment_issue_after_recovery',
          providerEventId: 'evt_stale_payment_failed_after_recovery',
        }),
      ]);
      const stalePaymentIssueEventRows =
        await selectBillingPaymentIssueEventRowsBySubject(organizationId);
      expect(stalePaymentIssueEventRows).toHaveLength(2);
      expect(stalePaymentIssueEventRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: 'payment_failed',
            providerEventId: 'evt_stale_payment_failed_after_recovery',
            providerInvoiceId: 'in_stale_payment_failed_after_recovery',
            providerPaymentIntentId: 'pi_stale_payment_failed_after_recovery',
          }),
          expect.objectContaining({
            eventType: 'stale_failure',
            providerEventId: 'evt_stale_payment_failed_after_recovery',
            providerInvoiceId: 'in_stale_payment_failed_after_recovery',
            providerPaymentIntentId: 'pi_stale_payment_failed_after_recovery',
          }),
        ]),
      );
      expect(await selectBillingPaymentIssueRowBySubject(organizationId)).toMatchObject({
        state: 'stale_failure_history_only',
        latestProviderEventId: 'evt_stale_payment_failed_after_recovery',
        latestInvoiceId: 'in_stale_payment_failed_after_recovery',
        latestPaymentIntentId: 'pi_stale_payment_failed_after_recovery',
      });
      expect(await selectOrganizationBillingRow(organizationId)).toMatchObject({
        subscriptionStatus: 'active',
        paymentIssueStartedAt: null,
        pastDueGraceEndsAt: null,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('リスク状態とプロバイダー連携状態に対して対象指定と全体の課金照合を実行する', async () => {
    const stripeMonthlyPriceId = 'price_reconcile_monthly';
    const database = drizzle(d1);
    const env = {
      STRIPE_SECRET_KEY: 'sk_test_reconcile',
      STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
    };
    const { organizationId: targetedOrganizationId } = await createBillingFixtureOwner({
      name: 'Targeted Reconciliation Owner',
      email: 'targeted-reconciliation-owner@example.com',
      organizationName: 'Targeted Reconciliation Org',
      slug: `targeted-reconciliation-${crypto.randomUUID().slice(0, 8)}`,
    });
    const { organizationId: fullOrganizationId } = await createBillingFixtureOwner({
      name: 'Full Reconciliation Owner',
      email: 'full-reconciliation-owner@example.com',
      organizationName: 'Full Reconciliation Org',
      slug: `full-reconciliation-${crypto.randomUUID().slice(0, 8)}`,
    });
    await d1
      .prepare(
        "UPDATE billing_subscription SET status = 'active', updated_at = ? WHERE status IN ('past_due', 'unpaid', 'incomplete')",
      )
      .bind(Date.now())
      .run();
    await d1
      .prepare(
        "UPDATE billing_subscription SET provider_subscription_id = NULL, updated_at = ? WHERE billing_account_id NOT IN (SELECT id FROM billing_account WHERE subject_type = 'organization' AND subject_id IN (?, ?))",
      )
      .bind(Date.now(), targetedOrganizationId, fullOrganizationId)
      .run();
    await d1
      .prepare(
        "UPDATE billing_payment_issue SET state = 'none', issue_started_at = NULL, issue_started_at_source = 'none', past_due_grace_ends_at = NULL, updated_at = ? WHERE state IN ('past_due_grace_active', 'past_due_grace_expired', 'unpaid', 'incomplete', 'payment_failed', 'payment_action_required')",
      )
      .bind(Date.now())
      .run();
    await d1
      .prepare(
        'UPDATE billing_subscription SET provider_subscription_id = NULL, updated_at = ? WHERE billing_account_id NOT IN (SELECT id FROM billing_account WHERE subject_type = ? AND subject_id IN (?, ?))',
      )
      .bind(Date.now(), 'organization', targetedOrganizationId, fullOrganizationId)
      .run();
    await d1
      .prepare(
        'UPDATE billing_account SET provider_customer_id = NULL, updated_at = ? WHERE subject_type = ? AND subject_id NOT IN (?, ?)',
      )
      .bind(Date.now(), 'organization', targetedOrganizationId, fullOrganizationId)
      .run();
    await setOrganizationBillingState({
      organizationId: targetedOrganizationId,
      planCode: 'premium',
      subscriptionStatus: 'incomplete',
      billingInterval: 'month',
      stripeCustomerId: 'cus_reconcile_targeted',
      stripeSubscriptionId: 'sub_reconcile_targeted',
      stripePriceId: stripeMonthlyPriceId,
    });
    await setOrganizationBillingState({
      organizationId: fullOrganizationId,
      planCode: 'premium',
      subscriptionStatus: 'active',
      billingInterval: 'month',
      stripeCustomerId: 'cus_reconcile_full',
      stripeSubscriptionId: 'sub_reconcile_full',
      stripePriceId: stripeMonthlyPriceId,
    });

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith('https://api.stripe.com/v1/subscriptions/sub_reconcile_targeted')) {
        return new Response(
          JSON.stringify({
            id: 'sub_reconcile_targeted',
            customer: 'cus_reconcile_targeted',
            status: 'active',
            cancel_at_period_end: false,
            current_period_start: 1775000000,
            current_period_end: 1777688400,
            items: { data: [{ price: { id: stripeMonthlyPriceId } }] },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url.startsWith('https://api.stripe.com/v1/subscriptions/sub_reconcile_full')) {
        return new Response(
          JSON.stringify({
            id: 'sub_reconcile_full',
            customer: 'cus_reconcile_full',
            status: 'canceled',
            cancel_at_period_end: false,
            items: { data: [{ price: { id: stripeMonthlyPriceId } }] },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return originalFetch(input, init);
    });

    try {
      await expect(
        reconcileRiskyOrganizationBillingStates({
          database,
          env,
          now: new Date('2026-04-20T00:00:00.000Z'),
          limit: 10,
        }),
      ).resolves.toMatchObject({
        scanned: 1,
        reconciled: 1,
        failed: 0,
        skipped: false,
      });
      expect(await selectOrganizationBillingRow(targetedOrganizationId)).toMatchObject({
        subscriptionStatus: 'active',
        lastReconciliationReason: 'reconciliation_targeted',
      });

      await expect(
        reconcileProviderLinkedOrganizationBillingStates({
          database,
          env,
          now: new Date('2026-04-21T00:00:00.000Z'),
          limit: 10,
        }),
      ).resolves.toMatchObject({
        scanned: 2,
        reconciled: 2,
        failed: 0,
        skipped: false,
      });
      expect(await selectOrganizationBillingRow(fullOrganizationId)).toMatchObject({
        planCode: 'free',
        subscriptionStatus: 'canceled',
        stripeSubscriptionId: null,
        lastReconciliationReason: 'reconciliation_full',
      });
      expect(
        (await selectOrganizationBillingAuditEventRows(targetedOrganizationId)).map(
          (row) => row.sourceKind,
        ),
      ).toContain('reconciliation_targeted');
      expect(
        (await selectOrganizationBillingAuditEventRows(fullOrganizationId)).map(
          (row) => row.sourceKind,
        ),
      ).toContain('reconciliation_full');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('オーナー向けに安全な課金履歴を返し非オーナーには履歴詳細を制限する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Owner Billing History Fixture',
      email: 'owner-billing-history@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Owner Billing History Org',
      slug: 'owner-billing-history-org',
    });

    const admin = createAuthAgent(app);
    await signUpUser({
      agent: admin,
      name: 'Owner Billing History Admin',
      email: 'owner-billing-history-admin@example.com',
    });
    await insertOrganizationMember({
      organizationId,
      userId: (await selectUserIdByEmail('owner-billing-history-admin@example.com')) as string,
      role: 'admin',
    });

    const now = Date.now();
    const currentPeriodStart = new Date(now - 2 * 24 * 60 * 60 * 1000);
    const currentPeriodEnd = new Date(now + 28 * 24 * 60 * 60 * 1000);
    const trialEndsAt = new Date(now + 2 * 24 * 60 * 60 * 1000);

    await setOrganizationBillingState({
      organizationId,
      planCode: 'premium',
      subscriptionStatus: 'active',
      billingInterval: 'month',
      currentPeriodStart,
      currentPeriodEnd,
      stripeCustomerId: 'cus_owner_billing_history',
      stripeSubscriptionId: 'sub_owner_billing_history',
      stripePriceId: 'price_owner_billing_history',
    });
    await insertOrganizationBillingAuditEventRow({
      organizationId,
      sequenceNumber: 1,
      sourceKind: 'trial_start',
      previousPlanCode: 'free',
      nextPlanCode: 'premium',
      previousPlanState: 'free',
      nextPlanState: 'premium_trial',
      previousSubscriptionStatus: 'free',
      nextSubscriptionStatus: 'trialing',
      previousPaymentMethodStatus: 'not_started',
      nextPaymentMethodStatus: 'pending',
      previousEntitlementState: 'free_only',
      nextEntitlementState: 'premium_enabled',
      stripeCustomerId: 'cus_owner_billing_history',
      createdAt: new Date(now - 300_000),
    });
    await insertReserveAppBillingNotificationRow({
      organizationId,
      sequenceNumber: 1,
      deliveryState: 'failed',
      attemptNumber: 1,
      stripeEventId: 'evt_owner_billing_history_trial',
      recipientEmail: 'owner-billing-history@example.com',
      stripeCustomerId: 'cus_owner_billing_history',
      stripeSubscriptionId: 'sub_owner_billing_history',
      trialEndsAt,
      failureReason: 'owner_not_found',
      createdAt: new Date(now - 200_000),
    });
    await insertReserveAppBillingNotificationRow({
      organizationId,
      sequenceNumber: 2,
      notificationKind: 'trial_will_end',
      channel: 'in_app',
      deliveryState: 'sent',
      attemptNumber: 1,
      stripeEventId: 'evt_owner_billing_history_trial_in_app',
      recipientEmail: null,
      stripeCustomerId: 'cus_owner_billing_history',
      stripeSubscriptionId: 'sub_owner_billing_history',
      trialEndsAt,
      createdAt: new Date(now - 150_000),
    });
    await insertOrganizationBillingSignalRow({
      organizationId,
      sequenceNumber: 1,
      signalKind: 'reconciliation',
      signalStatus: 'unavailable',
      sourceKind: 'webhook_subscription_lifecycle',
      reason: 'provider_lookup_failed',
      stripeEventId: 'evt_owner_billing_history_subscription',
      stripeCustomerId: 'cus_owner_billing_history',
      stripeSubscriptionId: 'sub_owner_billing_history',
      appPlanState: 'premium_paid',
      appSubscriptionStatus: 'active',
      appPaymentMethodStatus: 'registered',
      appEntitlementState: 'premium_enabled',
      createdAt: new Date(now - 100_000),
    });
    for (let index = 0; index < 25; index += 1) {
      await insertOrganizationBillingSignalRow({
        organizationId,
        sequenceNumber: index + 2,
        signalKind: 'reconciliation',
        signalStatus: 'resolved',
        sourceKind: 'reconciliation_targeted',
        reason: 'state_already_synced',
        stripeEventId: `evt_owner_billing_history_resolved_${index}`,
        stripeCustomerId: 'cus_owner_billing_history',
        stripeSubscriptionId: 'sub_owner_billing_history',
        appPlanState: 'premium_paid',
        appSubscriptionStatus: 'active',
        appPaymentMethodStatus: 'registered',
        appEntitlementState: 'premium_enabled',
        createdAt: new Date(now - 90_000 + index * 1_000),
      });
    }

    const ownerResponse = await owner.request(
      `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
    );
    expect(ownerResponse.status).toBe(200);

    const ownerPayload = (await toJson(ownerResponse)) as Record<string, unknown>;
    expect(ownerPayload).toMatchObject({
      planCode: 'premium',
      planState: 'premium_paid',
      canManageBilling: true,
      history: expect.any(Array),
    });

    const ownerHistory = ownerPayload.history as Array<Record<string, unknown>>;
    expect(ownerHistory).toHaveLength(4);
    expect(ownerHistory[0]).toMatchObject({
      eventType: 'reconciliation',
      title: '契約状態を確認できませんでした',
      tone: 'attention',
    });
    expect(ownerHistory[1]).toMatchObject({
      eventType: 'notification',
      title: 'トライアル終了前のお知らせをアプリ内通知で送信しました',
      tone: 'positive',
    });
    expect(ownerHistory[1]?.billingContext).toContain('チャネル: アプリ内通知');
    expect(ownerHistory[2]).toMatchObject({
      eventType: 'notification',
      title: 'トライアル終了前のお知らせをメールで送信できませんでした',
      tone: 'attention',
    });
    expect(ownerHistory[2]?.billingContext).toContain('チャネル: メール');
    expect(ownerHistory[3]).toMatchObject({
      eventType: 'plan_transition',
      title: 'Premiumトライアルを開始しました',
      tone: 'positive',
    });
    expect(ownerHistory[0]?.billingContext).toBe(
      '契約状態: Premiumプラン / ステータス: 有効 / 支払い方法: 登録済み',
    );
    expect(JSON.stringify(ownerHistory)).not.toContain('契約状態の同期を確認しました');
    expect(JSON.stringify(ownerHistory)).not.toContain('state_already_synced');
    expect(JSON.stringify(ownerHistory)).not.toContain('owner_not_found');
    expect(JSON.stringify(ownerHistory)).not.toContain('provider_lookup_failed');
    expect(JSON.stringify(ownerHistory)).not.toContain('provider_reconciliation');

    const adminResponse = await admin.request(
      `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
    );
    expect(adminResponse.status).toBe(200);
    const adminPayload = (await toJson(adminResponse)) as Record<string, unknown>;
    expect(adminPayload.canManageBilling).toBe(false);
    expect(adminPayload.history).toBeNull();
  });

  it('支払い詳細や生プロバイダーペイロードを含めずオーナー向け支払い問題・復旧履歴を返す', async () => {
    const issueOccurredAt = new Date('2026-05-01T00:00:00.000Z');
    const recoveredAt = new Date('2026-05-02T00:00:00.000Z');
    const { agent: owner, organizationId } = await createPaymentIssueBillingFixture({
      name: 'Payment Issue History Owner',
      email: 'payment-issue-history-owner@example.com',
      organizationName: 'Payment Issue History Org',
      slug: `payment-issue-history-${crypto.randomUUID().slice(0, 8)}`,
      subscriptionStatus: 'active',
      paymentIssueStartedAt: null,
      pastDueGraceEndsAt: null,
    });
    await insertOrganizationBillingInvoiceEventRow({
      organizationId,
      stripeEventId: 'evt_history_payment_failed',
      eventType: 'payment_failed',
      ownerFacingStatus: 'failed',
      stripeInvoiceId: 'in_history_payment_failed',
      stripePaymentIntentId: 'pi_history_payment_failed',
      providerStatus: 'open',
      occurredAt: issueOccurredAt,
    });
    await insertOrganizationBillingInvoiceEventRow({
      organizationId,
      stripeEventId: 'evt_history_action_required',
      eventType: 'payment_action_required',
      ownerFacingStatus: 'action_required',
      stripeInvoiceId: 'in_history_action_required',
      stripePaymentIntentId: 'pi_history_action_required',
      providerStatus: 'requires_action',
      occurredAt: new Date('2026-05-01T01:00:00.000Z'),
    });
    await insertOrganizationBillingInvoiceEventRow({
      organizationId,
      stripeEventId: 'evt_history_payment_succeeded',
      eventType: 'payment_succeeded',
      ownerFacingStatus: 'succeeded',
      stripeInvoiceId: 'in_history_payment_succeeded',
      stripePaymentIntentId: 'pi_history_payment_succeeded',
      providerStatus: 'paid',
      occurredAt: recoveredAt,
    });
    await syncOrganizationBillingV2FixtureFromLegacyRow(organizationId);

    const response = await owner.request(
      `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
    );
    expect(response.status).toBe(200);
    const payload = (await toJson(response)) as Record<string, unknown>;

    expect(payload).toMatchObject({
      paymentIssueState: 'recovered',
      premiumEligible: true,
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain('支払い問題が解消されました');
    expect(serialized).toContain('解消済みの支払い失敗を履歴として保持しています');
    expect(serialized).toContain('解消済みの支払い認証依頼を履歴として保持しています');
    expect(serialized).not.toContain('4242');
    expect(serialized).not.toContain('payment_method_details');
    expect(serialized).not.toContain('tax_details');
    expect(serialized).not.toContain('data.object');
    expect(serialized).not.toContain('rawPayload');
  });

  it('組織紐付けが準備できるまで未照合の課金購読 Webhook を再試行する', async () => {
    const stripeWebhookSecret = 'whsec_test_unmatched_billing';
    const stripeMonthlyPriceId = 'price_unmatched_monthly';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        STRIPE_SECRET_KEY: 'sk_test_unmatched_billing',
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith('https://api.stripe.com/v1/subscriptions/sub_unmatched')) {
        return new Response(
          JSON.stringify({
            id: 'sub_unmatched',
            customer: 'cus_unmatched',
            status: 'active',
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  current_period_start: 1775000000,
                  current_period_end: 1777688400,
                  price: {
                    id: stripeMonthlyPriceId,
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: owner,
        name: 'Unmatched Webhook Owner',
        email: 'unmatched-webhook-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Unmatched Webhook Org',
        slug: 'unmatched-webhook-org',
      });

      const subscriptionPayload = JSON.stringify({
        id: 'evt_unmatched_subscription',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_unmatched',
            customer: 'cus_unmatched',
            status: 'active',
          },
        },
      });
      const subscriptionSignature = await createStripeSignatureHeader(
        subscriptionPayload,
        stripeWebhookSecret,
      );
      const firstResponse = await appWithStripe.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': subscriptionSignature,
        },
        body: subscriptionPayload,
      });
      expect(firstResponse.status).toBe(500);

      expect(await selectStripeWebhookEventRow('evt_unmatched_subscription')).toMatchObject({
        id: 'evt_unmatched_subscription',
        processingStatus: 'failed',
        failureReason: 'billing_account_not_found',
      });
      expect(await selectStripeWebhookFailureRows('evt_unmatched_subscription')).toEqual([
        expect.objectContaining({
          eventId: 'evt_unmatched_subscription',
          eventType: 'customer.subscription.updated',
          failureStage: 'organization_linkage',
          failureReason: 'billing_account_not_found',
        }),
      ]);

      const checkoutPayload = JSON.stringify({
        id: 'evt_unmatched_checkout',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_unmatched',
            customer: 'cus_unmatched',
            subscription: 'sub_unmatched',
            metadata: {
              billingPurpose: 'organization_plan',
              organizationId,
              planCode: 'premium',
              billingInterval: 'month',
            },
          },
        },
      });
      const checkoutSignature = await createStripeSignatureHeader(
        checkoutPayload,
        stripeWebhookSecret,
      );
      const checkoutResponse = await appWithStripe.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': checkoutSignature,
        },
        body: checkoutPayload,
      });
      expect(checkoutResponse.status).toBe(200);

      const retryResponse = await appWithStripe.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': subscriptionSignature,
        },
        body: subscriptionPayload,
      });
      expect(retryResponse.status).toBe(200);

      const billingAfterRetry = await selectOrganizationBillingRow(organizationId);
      expect(billingAfterRetry?.planCode).toBe('premium');
      expect(billingAfterRetry?.subscriptionStatus).toBe('active');
      expect(billingAfterRetry?.stripeCustomerId).toBe('cus_unmatched');
      expect(billingAfterRetry?.stripeSubscriptionId).toBe('sub_unmatched');
      expect(await selectStripeWebhookEventRow('evt_unmatched_subscription')).toMatchObject({
        id: 'evt_unmatched_subscription',
        processingStatus: 'processed',
        organizationId,
        failureReason: null,
      });
      expect(await selectStripeWebhookFailureRows('evt_unmatched_subscription')).toEqual([
        expect.objectContaining({
          eventId: 'evt_unmatched_subscription',
          eventType: 'customer.subscription.updated',
          failureStage: 'organization_linkage',
          failureReason: 'billing_account_not_found',
        }),
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('最新の Stripe 購読状態で古い購読イベントを照合する', async () => {
    const stripeWebhookSecret = 'whsec_test_out_of_order';
    const stripeMonthlyPriceId = 'price_out_of_order_monthly';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        STRIPE_SECRET_KEY: 'sk_test_out_of_order',
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);

    const originalFetch = globalThis.fetch;
    const latestSubscriptionPayload: Record<string, unknown> = {
      id: 'sub_out_of_order',
      customer: 'cus_out_of_order',
      status: 'canceled',
      cancel_at_period_end: false,
      items: {
        data: [
          {
            price: {
              id: stripeMonthlyPriceId,
            },
          },
        ],
      },
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith('https://api.stripe.com/v1/subscriptions/sub_out_of_order')) {
        return new Response(JSON.stringify(latestSubscriptionPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: owner,
        name: 'Webhook Owner',
        email: 'webhook-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Webhook Reconcile Org',
        slug: 'webhook-reconcile-org',
      });

      const checkoutPayload = JSON.stringify({
        id: 'evt_out_of_order_checkout',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_out_of_order',
            customer: 'cus_out_of_order',
            subscription: 'sub_out_of_order',
            metadata: {
              billingPurpose: 'organization_plan',
              organizationId,
              planCode: 'premium',
              billingInterval: 'month',
            },
          },
        },
      });
      const checkoutSignature = await createStripeSignatureHeader(
        checkoutPayload,
        stripeWebhookSecret,
      );
      const checkoutResponse = await appWithStripe.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': checkoutSignature,
        },
        body: checkoutPayload,
      });
      expect(checkoutResponse.status).toBe(200);

      const staleActivePayload = JSON.stringify({
        id: 'evt_out_of_order_subscription',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_out_of_order',
            customer: 'cus_out_of_order',
            status: 'active',
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  current_period_start: 1775000000,
                  current_period_end: 1777688400,
                  price: {
                    id: stripeMonthlyPriceId,
                  },
                },
              ],
            },
          },
        },
      });
      const staleActiveSignature = await createStripeSignatureHeader(
        staleActivePayload,
        stripeWebhookSecret,
      );
      const staleActiveResponse = await appWithStripe.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': staleActiveSignature,
        },
        body: staleActivePayload,
      });
      expect(staleActiveResponse.status).toBe(200);

      const billingAfterReconcile = await selectOrganizationBillingRow(organizationId);
      expect(billingAfterReconcile?.planCode).toBe('free');
      expect(billingAfterReconcile?.subscriptionStatus).toBe('canceled');
      expect(billingAfterReconcile?.stripeSubscriptionId).toBeNull();
      expect(await selectOrganizationBillingAuditEventRows(organizationId)).toEqual([
        expect.objectContaining({
          sequenceNumber: 1,
          sourceKind: 'webhook_checkout_completed',
          stripeEventId: 'evt_out_of_order_checkout',
          previousPlanState: 'free',
          nextPlanState: 'premium_paid',
        }),
        expect.objectContaining({
          sequenceNumber: 2,
          sourceKind: 'webhook_subscription_lifecycle',
          stripeEventId: 'evt_out_of_order_subscription',
          previousPlanState: 'premium_paid',
          nextPlanState: 'free',
        }),
      ]);
      expect(await selectOrganizationBillingSignalRows(organizationId)).toEqual([
        expect.objectContaining({
          sequenceNumber: 1,
          signalKind: 'reconciliation',
          signalStatus: 'mismatch',
          sourceKind: 'webhook_subscription_lifecycle',
          reason: 'plan_state_mismatch',
          providerPlanState: 'free',
          appPlanState: 'premium_paid',
        }),
        expect.objectContaining({
          sequenceNumber: 2,
          signalKind: 'reconciliation',
          signalStatus: 'resolved',
          sourceKind: 'webhook_subscription_lifecycle',
          reason: 'provider_and_app_state_aligned',
          providerPlanState: 'free',
          appPlanState: 'free',
        }),
      ]);
      expect(await selectStripeWebhookEventRow('evt_out_of_order_subscription')).toMatchObject({
        id: 'evt_out_of_order_subscription',
        processingStatus: 'processed',
        organizationId,
      });
      expect(await selectStripeWebhookFailureRows('evt_out_of_order_subscription')).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('トライアル完了が未処理の間は期限切れトライアル購読 Webhook を再試行可能に保つ', async () => {
    const stripeWebhookSecret = 'whsec_test_trial_webhook_pending';
    const stripeMonthlyPriceId = 'price_trial_webhook_pending_monthly';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        STRIPE_SECRET_KEY: 'sk_test_trial_webhook_pending',
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith('https://api.stripe.com/v1/subscriptions/sub_trial_webhook_pending')) {
        return new Response(
          JSON.stringify({
            id: 'sub_trial_webhook_pending',
            customer: 'cus_trial_webhook_pending',
            status: 'trialing',
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  current_period_start: Math.floor((Date.now() - 86_400_000) / 1000),
                  current_period_end: Math.floor((Date.now() - 60_000) / 1000),
                  price: {
                    id: stripeMonthlyPriceId,
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url.startsWith('https://api.stripe.com/v1/customers/cus_trial_webhook_pending')) {
        return new Response(
          JSON.stringify({
            error: {
              message: 'Stripe customer state is temporarily unavailable.',
            },
          }),
          {
            status: 500,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: owner,
        name: 'Trial Webhook Pending Owner',
        email: 'trial-webhook-pending-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Trial Webhook Pending Org',
        slug: 'trial-webhook-pending-org',
      });

      const ownerTrialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      expect(ownerTrialResponse.status).toBe(200);

      await setOrganizationBillingState({
        organizationId,
        planCode: 'premium',
        subscriptionStatus: 'trialing',
        stripeCustomerId: 'cus_trial_webhook_pending',
        stripeSubscriptionId: 'sub_trial_webhook_pending',
        stripePriceId: stripeMonthlyPriceId,
        billingInterval: 'month',
        currentPeriodEnd: new Date(Date.now() - 60_000),
      });

      const webhookPayload = JSON.stringify({
        id: 'evt_trial_webhook_pending',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_trial_webhook_pending',
            customer: 'cus_trial_webhook_pending',
            status: 'trialing',
            cancel_at_period_end: false,
            items: {
              data: [
                {
                  current_period_start: Math.floor((Date.now() - 86_400_000) / 1000),
                  current_period_end: Math.floor((Date.now() - 60_000) / 1000),
                  price: {
                    id: stripeMonthlyPriceId,
                  },
                },
              ],
            },
          },
        },
      });
      const signature = await createStripeSignatureHeader(webhookPayload, stripeWebhookSecret);
      const response = await appWithStripe.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signature,
        },
        body: webhookPayload,
      });
      expect(response.status).toBe(500);
      expect((await toJson(response)) as Record<string, unknown>).toMatchObject({
        message:
          'Payment method status is still syncing with Stripe. Retry after billing synchronization completes.',
      });

      const billingAfterAttempt = await selectOrganizationBillingRow(organizationId);
      expect(billingAfterAttempt?.planCode).toBe('premium');
      expect(billingAfterAttempt?.subscriptionStatus).toBe('trialing');
      expect(await selectStripeWebhookEventRow('evt_trial_webhook_pending')).toMatchObject({
        id: 'evt_trial_webhook_pending',
        processingStatus: 'failed',
        organizationId,
        failureReason: 'trial_completion_pending',
      });
      expect(await selectStripeWebhookFailureRows('evt_trial_webhook_pending')).toEqual([
        expect.objectContaining({
          eventId: 'evt_trial_webhook_pending',
          eventType: 'customer.subscription.updated',
          failureStage: 'provider_reconciliation',
          failureReason: 'trial_completion_pending',
          organizationId,
        }),
      ]);
      expect(await selectOrganizationBillingSignalRows(organizationId)).toEqual([
        expect.objectContaining({
          sequenceNumber: 1,
          signalKind: 'reconciliation',
          signalStatus: 'pending',
          sourceKind: 'webhook_trial_completion',
          reason: 'trial_completion_pending',
          appPlanState: 'premium_trial',
          appEntitlementState: 'free_only',
        }),
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('取得済み Webhook イベントで予期しない処理エラーが起きたら失敗として記録する', async () => {
    const stripeWebhookSecret = 'whsec_test_unexpected_processing';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        STRIPE_SECRET_KEY: 'sk_test_unexpected_processing',
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);

    const firstOwner = createAuthAgent(appWithStripe);
    await signUpUser({
      agent: firstOwner,
      name: 'Unexpected Processing Owner One',
      email: 'unexpected-processing-owner-one@example.com',
    });
    const existingOrganizationId = await createOrganization({
      agent: firstOwner,
      name: 'Unexpected Processing Existing Org',
      slug: 'unexpected-processing-existing-org',
    });

    const secondOwner = createAuthAgent(appWithStripe);
    await signUpUser({
      agent: secondOwner,
      name: 'Unexpected Processing Owner Two',
      email: 'unexpected-processing-owner-two@example.com',
    });
    const targetOrganizationId = await createOrganization({
      agent: secondOwner,
      name: 'Unexpected Processing Target Org',
      slug: 'unexpected-processing-target-org',
    });

    await setOrganizationBillingState({
      organizationId: existingOrganizationId,
      planCode: 'free',
      subscriptionStatus: 'free',
      stripeCustomerId: 'cus_unexpected_processing',
    });

    const webhookPayload = JSON.stringify({
      id: 'evt_unexpected_processing',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_unexpected_processing',
          customer: 'cus_unexpected_processing',
          subscription: 'sub_unexpected_processing',
          metadata: {
            billingPurpose: 'organization_plan',
            organizationId: targetOrganizationId,
            planCode: 'premium',
            billingInterval: 'month',
          },
        },
      },
    });
    const signature = await createStripeSignatureHeader(webhookPayload, stripeWebhookSecret);
    const response = await appWithStripe.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signature,
      },
      body: webhookPayload,
    });
    expect(response.status).toBe(500);

    expect(await selectStripeWebhookEventRow('evt_unexpected_processing')).toMatchObject({
      id: 'evt_unexpected_processing',
      processingStatus: 'failed',
      failureReason: 'unexpected_processing_error',
      stripeCustomerId: 'cus_unexpected_processing',
      stripeSubscriptionId: 'sub_unexpected_processing',
    });
    expect(await selectStripeWebhookFailureRows('evt_unexpected_processing')).toEqual([
      expect.objectContaining({
        eventId: 'evt_unexpected_processing',
        eventType: 'checkout.session.completed',
        failureStage: 'event_processing',
        failureReason: 'unexpected_processing_error',
        organizationId: null,
      }),
    ]);
  });

  it('処理中の新しい課金 Webhook 重複を成功済み no-op として扱わない', async () => {
    const stripeWebhookSecret = 'whsec_test_processing_duplicate';
    const stripeMonthlyPriceId = 'price_processing_duplicate_monthly';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        STRIPE_SECRET_KEY: 'sk_test_processing_duplicate',
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);
    const owner = createAuthAgent(appWithStripe);
    await signUpUser({
      agent: owner,
      name: 'Processing Duplicate Owner',
      email: 'processing-duplicate-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Processing Duplicate Org',
      slug: `processing-duplicate-${crypto.randomUUID().slice(0, 8)}`,
    });
    await insertStripeWebhookEventRow({
      id: 'evt_processing_duplicate',
      eventType: 'checkout.session.completed',
      scope: 'billing',
      processingStatus: 'processing',
      createdAt: new Date(),
    });

    const webhookPayload = JSON.stringify({
      id: 'evt_processing_duplicate',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_processing_duplicate',
          customer: 'cus_processing_duplicate',
          subscription: 'sub_processing_duplicate',
          metadata: {
            billingPurpose: 'organization_plan',
            organizationId,
            planCode: 'premium',
            billingInterval: 'month',
          },
        },
      },
    });
    const signature = await createStripeSignatureHeader(webhookPayload, stripeWebhookSecret);
    const response = await appWithStripe.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signature,
      },
      body: webhookPayload,
    });

    expect(response.status).toBe(500);
    expect(await toJson(response)).toMatchObject({
      message: 'Stripe webhook event is already processing and has not completed yet.',
    });
    const webhookEventRow = await selectStripeWebhookEventRow('evt_processing_duplicate');
    expect(webhookEventRow).toMatchObject({
      processingStatus: 'processing',
      receiptStatus: 'duplicate_processing',
    });
    expect(Boolean(webhookEventRow?.duplicateDetected)).toBe(true);
    expect(await selectOrganizationBillingRow(organizationId)).toMatchObject({
      planCode: 'free',
      subscriptionStatus: 'free',
    });
  });

  it('Stripe 再配信用に処理中の古い課金 Webhook イベントを再取得する', async () => {
    const stripeWebhookSecret = 'whsec_test_stale_processing';
    const stripeMonthlyPriceId = 'price_stale_processing_monthly';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        STRIPE_SECRET_KEY: 'sk_test_stale_processing',
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);
    const owner = createAuthAgent(appWithStripe);
    await signUpUser({
      agent: owner,
      name: 'Stale Processing Owner',
      email: 'stale-processing-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Stale Processing Org',
      slug: `stale-processing-${crypto.randomUUID().slice(0, 8)}`,
    });
    await insertStripeWebhookEventRow({
      id: 'evt_stale_processing',
      eventType: 'checkout.session.completed',
      scope: 'billing',
      processingStatus: 'processing',
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
    });

    const webhookPayload = JSON.stringify({
      id: 'evt_stale_processing',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_stale_processing',
          customer: 'cus_stale_processing',
          subscription: 'sub_stale_processing',
          metadata: {
            billingPurpose: 'organization_plan',
            organizationId,
            planCode: 'premium',
            billingInterval: 'month',
          },
        },
      },
    });
    const signature = await createStripeSignatureHeader(webhookPayload, stripeWebhookSecret);
    const response = await appWithStripe.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signature,
      },
      body: webhookPayload,
    });

    expect(response.status).toBe(200);
    expect(await selectStripeWebhookEventRow('evt_stale_processing')).toMatchObject({
      processingStatus: 'processed',
      organizationId,
      receiptStatus: 'processed',
    });
    expect(await selectOrganizationBillingRow(organizationId)).toMatchObject({
      planCode: 'premium',
      subscriptionStatus: 'incomplete',
      stripeCustomerId: 'cus_stale_processing',
      stripeSubscriptionId: 'sub_stale_processing',
    });
  });

  it('オーナー限定のトライアルリマインドメールを送信し課金通知履歴を記録する', async () => {
    const stripeWebhookSecret = 'whsec_test_trial_reminder_success';
    const stripeMonthlyPriceId = 'price_trial_reminder_monthly';
    const authRuntimeWithReminder = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        STRIPE_SECRET_KEY: 'sk_test_trial_reminder_success',
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
        RESEND_API_KEY: 'test-resend-api-key',
        RESEND_FROM_EMAIL: 'no-reply@example.com',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithReminder = createApp(authRuntimeWithReminder);

    const resendRequests: Array<{ to: string[]; subject: string; text: string }> = [];
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith('https://api.stripe.com/v1/subscriptions/sub_trial_reminder')) {
        return new Response(
          JSON.stringify({
            id: 'sub_trial_reminder',
            customer: 'cus_trial_reminder',
            status: 'trialing',
            cancel_at_period_end: false,
            current_period_start: Math.floor((Date.now() - 4 * 24 * 60 * 60 * 1000) / 1000),
            current_period_end: Math.floor((Date.now() + 3 * 24 * 60 * 60 * 1000) / 1000),
            items: {
              data: [
                {
                  current_period_start: Math.floor((Date.now() - 4 * 24 * 60 * 60 * 1000) / 1000),
                  current_period_end: Math.floor((Date.now() + 3 * 24 * 60 * 60 * 1000) / 1000),
                  price: {
                    id: stripeMonthlyPriceId,
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url.startsWith('https://api.stripe.com/v1/customers/cus_trial_reminder')) {
        return new Response(
          JSON.stringify({
            id: 'cus_trial_reminder',
            invoice_settings: {
              default_payment_method: null,
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url === 'https://api.resend.com/emails') {
        const payloadText =
          typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '{}';
        const payload = JSON.parse(payloadText) as {
          to?: unknown;
          subject?: unknown;
          text?: unknown;
        };
        resendRequests.push({
          to: Array.isArray(payload.to)
            ? payload.to.filter((value): value is string => typeof value === 'string')
            : [],
          subject: typeof payload.subject === 'string' ? payload.subject : '',
          text: typeof payload.text === 'string' ? payload.text : '',
        });
        return new Response(JSON.stringify({ id: crypto.randomUUID() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithReminder);
      await signUpUser({
        agent: owner,
        name: 'Trial Reminder Owner',
        email: 'trial-reminder-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Trial Reminder Org',
        slug: 'trial-reminder-org',
      });

      const admin = createAuthAgent(appWithReminder);
      await signUpUser({
        agent: admin,
        name: 'Trial Reminder Admin',
        email: 'trial-reminder-admin@example.com',
      });
      await insertOrganizationMember({
        organizationId,
        userId: (await selectUserIdByEmail('trial-reminder-admin@example.com')) as string,
        role: 'admin',
      });

      const ownerTrialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      expect(ownerTrialResponse.status).toBe(200);

      await setOrganizationBillingState({
        organizationId,
        planCode: 'premium',
        subscriptionStatus: 'trialing',
        stripeCustomerId: 'cus_trial_reminder',
        stripeSubscriptionId: 'sub_trial_reminder',
        stripePriceId: stripeMonthlyPriceId,
        billingInterval: 'month',
        currentPeriodEnd: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      });

      const webhookPayload = JSON.stringify({
        id: 'evt_trial_reminder_success',
        type: 'customer.subscription.trial_will_end',
        data: {
          object: {
            id: 'sub_trial_reminder',
            customer: 'cus_trial_reminder',
            status: 'trialing',
            cancel_at_period_end: false,
            current_period_end: Math.floor((Date.now() + 3 * 24 * 60 * 60 * 1000) / 1000),
            items: {
              data: [
                {
                  current_period_end: Math.floor((Date.now() + 3 * 24 * 60 * 60 * 1000) / 1000),
                  price: {
                    id: stripeMonthlyPriceId,
                  },
                },
              ],
            },
          },
        },
      });
      const signature = await createStripeSignatureHeader(webhookPayload, stripeWebhookSecret);
      const response = await appWithReminder.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signature,
        },
        body: webhookPayload,
      });
      expect(response.status).toBe(200);

      const trialReminderRequests = resendRequests.filter(
        (request) => request.subject === '【契約通知】プレミアムトライアルの終了が近づいています',
      );

      expect(trialReminderRequests).toEqual([
        expect.objectContaining({
          to: ['trial-reminder-owner@example.com'],
          subject: '【契約通知】プレミアムトライアルの終了が近づいています',
        }),
      ]);
      expect(trialReminderRequests[0]?.text).toContain(
        '契約ページで登録状況を確認し、未完了であれば支払い方法の登録を完了してください',
      );
      expect(trialReminderRequests[0]?.text).toContain(
        '支払い方法の登録状況の反映が完了していない場合、トライアル終了後に無料プランへ戻ることがあります。',
      );
      const notificationRows = await selectOrganizationBillingNotificationRows(organizationId);
      expect(notificationRows).toEqual([
        expect.objectContaining({
          notificationKind: 'trial_will_end_email',
          sequenceNumber: 1,
          deliveryState: 'requested',
          attemptNumber: 1,
          stripeEventId: 'evt_trial_reminder_success',
          recipientEmail: 'trial-reminder-owner@example.com',
          planState: 'premium_trial',
          subscriptionStatus: 'trialing',
          paymentMethodStatus: 'pending',
          failureReason: null,
        }),
        expect.objectContaining({
          notificationKind: 'trial_will_end_email',
          sequenceNumber: 2,
          deliveryState: 'sent',
          attemptNumber: 1,
          stripeEventId: 'evt_trial_reminder_success',
          recipientEmail: 'trial-reminder-owner@example.com',
          planState: 'premium_trial',
          subscriptionStatus: 'trialing',
          paymentMethodStatus: 'pending',
          failureReason: null,
        }),
      ]);
      expect(await selectStripeWebhookEventRow('evt_trial_reminder_success')).toMatchObject({
        id: 'evt_trial_reminder_success',
        processingStatus: 'processed',
        organizationId,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('支払い方法登録済みの場合にトライアルリマインドメールの文面を調整する', async () => {
    const stripeWebhookSecret = 'whsec_test_trial_reminder_registered';
    const stripeMonthlyPriceId = 'price_trial_reminder_registered_monthly';
    const authRuntimeWithReminder = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        STRIPE_SECRET_KEY: 'sk_test_trial_reminder_registered',
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
        RESEND_API_KEY: 'test-resend-api-key',
        RESEND_FROM_EMAIL: 'no-reply@example.com',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithReminder = createApp(authRuntimeWithReminder);

    const resendRequests: Array<{ to: string[]; subject: string; text: string }> = [];
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith('https://api.stripe.com/v1/subscriptions/sub_trial_reminder_registered')) {
        return new Response(
          JSON.stringify({
            id: 'sub_trial_reminder_registered',
            customer: 'cus_trial_reminder_registered',
            status: 'trialing',
            cancel_at_period_end: false,
            current_period_end: Math.floor((Date.now() + 3 * 24 * 60 * 60 * 1000) / 1000),
            items: {
              data: [
                {
                  current_period_end: Math.floor((Date.now() + 3 * 24 * 60 * 60 * 1000) / 1000),
                  price: {
                    id: stripeMonthlyPriceId,
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url.startsWith('https://api.stripe.com/v1/customers/cus_trial_reminder_registered')) {
        return new Response(
          JSON.stringify({
            id: 'cus_trial_reminder_registered',
            invoice_settings: {
              default_payment_method: 'pm_registered',
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url === 'https://api.resend.com/emails') {
        const payloadText =
          typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '{}';
        const payload = JSON.parse(payloadText) as {
          to?: unknown;
          subject?: unknown;
          text?: unknown;
        };
        resendRequests.push({
          to: Array.isArray(payload.to)
            ? payload.to.filter((value): value is string => typeof value === 'string')
            : [],
          subject: typeof payload.subject === 'string' ? payload.subject : '',
          text: typeof payload.text === 'string' ? payload.text : '',
        });
        return new Response(JSON.stringify({ id: crypto.randomUUID() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithReminder);
      await signUpUser({
        agent: owner,
        name: 'Trial Reminder Registered Owner',
        email: 'trial-reminder-registered-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Trial Reminder Registered Org',
        slug: 'trial-reminder-registered-org',
      });

      const ownerTrialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      expect(ownerTrialResponse.status).toBe(200);

      await setOrganizationBillingState({
        organizationId,
        planCode: 'premium',
        subscriptionStatus: 'trialing',
        stripeCustomerId: 'cus_trial_reminder_registered',
        stripeSubscriptionId: 'sub_trial_reminder_registered',
        stripePriceId: stripeMonthlyPriceId,
        billingInterval: 'month',
        currentPeriodEnd: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      });

      const webhookPayload = JSON.stringify({
        id: 'evt_trial_reminder_registered',
        type: 'customer.subscription.trial_will_end',
        data: {
          object: {
            id: 'sub_trial_reminder_registered',
            customer: 'cus_trial_reminder_registered',
            status: 'trialing',
          },
        },
      });
      const signature = await createStripeSignatureHeader(webhookPayload, stripeWebhookSecret);
      const response = await appWithReminder.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signature,
        },
        body: webhookPayload,
      });
      expect(response.status).toBe(200);

      expect(resendRequests).toEqual([
        expect.objectContaining({
          to: ['trial-reminder-registered-owner@example.com'],
          subject: '【契約通知】プレミアムトライアルの終了が近づいています',
        }),
      ]);
      expect(resendRequests[0]?.text).toContain(
        '追加の登録は不要です。契約ページで継続予定と登録済みの支払い方法をご確認ください',
      );
      expect(resendRequests[0]?.text).toContain(
        '現在の支払い方法は登録済みです。トライアル終了前に契約内容をご確認ください。',
      );
      expect(resendRequests[0]?.text).not.toContain('支払い方法の登録を完了してください');
      expect(resendRequests[0]?.text).not.toContain('無料プランへ戻ることがあります。');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('送信成功後のトライアルリマインド Webhook 重複配信を抑止する', async () => {
    const stripeWebhookSecret = 'whsec_test_trial_reminder_duplicate';
    const stripeMonthlyPriceId = 'price_trial_reminder_duplicate_monthly';
    const authRuntimeWithReminder = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        STRIPE_SECRET_KEY: 'sk_test_trial_reminder_duplicate',
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
        RESEND_API_KEY: 'test-resend-api-key',
        RESEND_FROM_EMAIL: 'no-reply@example.com',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithReminder = createApp(authRuntimeWithReminder);

    const resendRequests: Array<{ to: string[]; subject: string }> = [];
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith('https://api.stripe.com/v1/subscriptions/sub_trial_reminder_duplicate')) {
        return new Response(
          JSON.stringify({
            id: 'sub_trial_reminder_duplicate',
            customer: 'cus_trial_reminder_duplicate',
            status: 'trialing',
            cancel_at_period_end: false,
            current_period_end: Math.floor((Date.now() + 3 * 24 * 60 * 60 * 1000) / 1000),
            items: {
              data: [
                {
                  current_period_end: Math.floor((Date.now() + 3 * 24 * 60 * 60 * 1000) / 1000),
                  price: {
                    id: stripeMonthlyPriceId,
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url.startsWith('https://api.stripe.com/v1/customers/cus_trial_reminder_duplicate')) {
        return new Response(
          JSON.stringify({
            id: 'cus_trial_reminder_duplicate',
            invoice_settings: {
              default_payment_method: null,
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url === 'https://api.resend.com/emails') {
        const payloadText = typeof init?.body === 'string' ? init.body : '{}';
        const payload = JSON.parse(payloadText) as { to?: unknown; subject?: unknown };
        resendRequests.push({
          to: Array.isArray(payload.to)
            ? payload.to.filter((value): value is string => typeof value === 'string')
            : [],
          subject: typeof payload.subject === 'string' ? payload.subject : '',
        });
        return new Response(JSON.stringify({ id: crypto.randomUUID() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithReminder);
      await signUpUser({
        agent: owner,
        name: 'Trial Reminder Duplicate Owner',
        email: 'trial-reminder-duplicate-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Trial Reminder Duplicate Org',
        slug: 'trial-reminder-duplicate-org',
      });

      const ownerTrialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      expect(ownerTrialResponse.status).toBe(200);

      await setOrganizationBillingState({
        organizationId,
        planCode: 'premium',
        subscriptionStatus: 'trialing',
        stripeCustomerId: 'cus_trial_reminder_duplicate',
        stripeSubscriptionId: 'sub_trial_reminder_duplicate',
        stripePriceId: stripeMonthlyPriceId,
        billingInterval: 'month',
        currentPeriodEnd: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      });

      const webhookPayload = JSON.stringify({
        id: 'evt_trial_reminder_duplicate',
        type: 'customer.subscription.trial_will_end',
        data: {
          object: {
            id: 'sub_trial_reminder_duplicate',
            customer: 'cus_trial_reminder_duplicate',
            status: 'trialing',
          },
        },
      });
      const signature = await createStripeSignatureHeader(webhookPayload, stripeWebhookSecret);
      const firstResponse = await appWithReminder.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signature,
        },
        body: webhookPayload,
      });
      expect(firstResponse.status).toBe(200);

      const secondResponse = await appWithReminder.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signature,
        },
        body: webhookPayload,
      });
      expect(secondResponse.status).toBe(200);

      expect(resendRequests).toHaveLength(1);
      expect(await countStripeWebhookEventRows('evt_trial_reminder_duplicate')).toBe(1);
      expect(await selectOrganizationBillingNotificationRows(organizationId)).toHaveLength(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('再試行可能なトライアルリマインド配信失敗を記録し Stripe 再配信で成功する', async () => {
    const stripeWebhookSecret = 'whsec_test_trial_reminder_retry';
    const stripeMonthlyPriceId = 'price_trial_reminder_retry_monthly';
    const authRuntimeWithReminder = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        STRIPE_SECRET_KEY: 'sk_test_trial_reminder_retry',
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
        RESEND_API_KEY: 'test-resend-api-key',
        RESEND_FROM_EMAIL: 'no-reply@example.com',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithReminder = createApp(authRuntimeWithReminder);

    let shouldFailResend = true;
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith('https://api.stripe.com/v1/subscriptions/sub_trial_reminder_retry')) {
        return new Response(
          JSON.stringify({
            id: 'sub_trial_reminder_retry',
            customer: 'cus_trial_reminder_retry',
            status: 'trialing',
            cancel_at_period_end: false,
            current_period_end: Math.floor((Date.now() + 3 * 24 * 60 * 60 * 1000) / 1000),
            items: {
              data: [
                {
                  current_period_end: Math.floor((Date.now() + 3 * 24 * 60 * 60 * 1000) / 1000),
                  price: {
                    id: stripeMonthlyPriceId,
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url.startsWith('https://api.stripe.com/v1/customers/cus_trial_reminder_retry')) {
        return new Response(
          JSON.stringify({
            id: 'cus_trial_reminder_retry',
            invoice_settings: {
              default_payment_method: null,
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url === 'https://api.resend.com/emails') {
        if (shouldFailResend) {
          throw new TypeError('fetch failed');
        }
        return new Response(JSON.stringify({ id: crypto.randomUUID() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithReminder);
      await signUpUser({
        agent: owner,
        name: 'Trial Reminder Retry Owner',
        email: 'trial-reminder-retry-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Trial Reminder Retry Org',
        slug: 'trial-reminder-retry-org',
      });

      const ownerTrialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      expect(ownerTrialResponse.status).toBe(200);

      await setOrganizationBillingState({
        organizationId,
        planCode: 'premium',
        subscriptionStatus: 'trialing',
        stripeCustomerId: 'cus_trial_reminder_retry',
        stripeSubscriptionId: 'sub_trial_reminder_retry',
        stripePriceId: stripeMonthlyPriceId,
        billingInterval: 'month',
        currentPeriodEnd: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      });

      const webhookPayload = JSON.stringify({
        id: 'evt_trial_reminder_retry',
        type: 'customer.subscription.trial_will_end',
        data: {
          object: {
            id: 'sub_trial_reminder_retry',
            customer: 'cus_trial_reminder_retry',
            status: 'trialing',
          },
        },
      });
      const signature = await createStripeSignatureHeader(webhookPayload, stripeWebhookSecret);

      const firstResponse = await appWithReminder.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signature,
        },
        body: webhookPayload,
      });
      expect(firstResponse.status).toBe(500);
      expect(await selectStripeWebhookEventRow('evt_trial_reminder_retry')).toMatchObject({
        id: 'evt_trial_reminder_retry',
        processingStatus: 'failed',
        organizationId,
        failureReason: 'trial_reminder_delivery_failed',
      });
      expect(await selectOrganizationBillingNotificationRows(organizationId)).toEqual([
        expect.objectContaining({
          sequenceNumber: 1,
          deliveryState: 'requested',
          attemptNumber: 1,
          stripeEventId: 'evt_trial_reminder_retry',
          recipientEmail: 'trial-reminder-retry-owner@example.com',
          failureReason: null,
        }),
        expect.objectContaining({
          sequenceNumber: 2,
          deliveryState: 'failed',
          attemptNumber: 1,
          stripeEventId: 'evt_trial_reminder_retry',
          recipientEmail: 'trial-reminder-retry-owner@example.com',
          failureReason: 'resend_delivery_failed',
        }),
      ]);
      expect(await selectOrganizationBillingSignalRows(organizationId)).toEqual([
        expect.objectContaining({
          sequenceNumber: 1,
          signalKind: 'notification_delivery',
          signalStatus: 'pending',
          sourceKind: 'trial_will_end_email',
          reason: 'resend_delivery_failed',
        }),
      ]);

      shouldFailResend = false;
      const retryResponse = await appWithReminder.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signature,
        },
        body: webhookPayload,
      });
      expect(retryResponse.status).toBe(200);
      expect(await selectStripeWebhookEventRow('evt_trial_reminder_retry')).toMatchObject({
        id: 'evt_trial_reminder_retry',
        processingStatus: 'processed',
        organizationId,
        failureReason: null,
      });
      expect(await selectOrganizationBillingNotificationRows(organizationId)).toEqual([
        expect.objectContaining({
          sequenceNumber: 1,
          deliveryState: 'requested',
          attemptNumber: 1,
          stripeEventId: 'evt_trial_reminder_retry',
        }),
        expect.objectContaining({
          sequenceNumber: 2,
          deliveryState: 'failed',
          attemptNumber: 1,
          stripeEventId: 'evt_trial_reminder_retry',
          failureReason: 'resend_delivery_failed',
        }),
        expect.objectContaining({
          sequenceNumber: 3,
          deliveryState: 'retried',
          attemptNumber: 2,
          stripeEventId: 'evt_trial_reminder_retry',
        }),
        expect.objectContaining({
          sequenceNumber: 4,
          deliveryState: 'sent',
          attemptNumber: 2,
          stripeEventId: 'evt_trial_reminder_retry',
        }),
      ]);
      expect(await selectOrganizationBillingSignalRows(organizationId)).toEqual([
        expect.objectContaining({
          sequenceNumber: 1,
          signalKind: 'notification_delivery',
          signalStatus: 'pending',
          sourceKind: 'trial_will_end_email',
          reason: 'resend_delivery_failed',
        }),
        expect.objectContaining({
          sequenceNumber: 2,
          signalKind: 'notification_delivery',
          signalStatus: 'resolved',
          sourceKind: 'trial_will_end_email',
          reason: 'trial_reminder_delivery_succeeded',
        }),
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('オーナー限定のプレミアムトライアルを開始し重複するアクティブ状態を拒否する', async () => {
    const stripeMonthlyPriceId = 'price_owner_only_trial_monthly';
    const currentPeriodStartSeconds = Math.floor(Date.now() / 1000);
    const currentPeriodEndSeconds = currentPeriodStartSeconds + 7 * 24 * 60 * 60;
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        STRIPE_SECRET_KEY: 'sk_test_owner_only_trial',
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
        STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED: 'true',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';

      if (url === 'https://api.stripe.com/v1/customers' && method === 'POST') {
        return new Response(JSON.stringify({ id: 'cus_owner_only_trial' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'https://api.stripe.com/v1/subscriptions' && method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'sub_owner_only_trial',
            customer: 'cus_owner_only_trial',
            status: 'trialing',
            current_period_start: currentPeriodStartSeconds,
            current_period_end: currentPeriodEndSeconds,
            items: { data: [{ price: { id: stripeMonthlyPriceId } }] },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: owner,
        name: 'Trial Owner',
        email: 'trial-owner@example.com',
      });

      const organizationId = await createOrganization({
        agent: owner,
        name: 'Trial Org',
        slug: 'trial-org',
      });

      const admin = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: admin,
        name: 'Trial Admin',
        email: 'trial-admin@example.com',
      });

      const member = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: member,
        name: 'Trial Member',
        email: 'trial-member@example.com',
      });
      await insertOrganizationMember({
        organizationId,
        userId: (await selectUserIdByEmail('trial-admin@example.com')) as string,
        role: 'admin',
      });
      await insertOrganizationMember({
        organizationId,
        userId: (await selectUserIdByEmail('trial-member@example.com')) as string,
        role: 'member',
      });

      const adminTrialResponse = await admin.request('/api/v1/auth/organizations/billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      expect(adminTrialResponse.status).toBe(403);

      const memberTrialResponse = await member.request('/api/v1/auth/organizations/billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      expect(memberTrialResponse.status).toBe(403);

      const ownerTrialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      expect(ownerTrialResponse.status).toBe(200);
      const ownerTrialPayload = (await toJson(ownerTrialResponse)) as Record<string, unknown>;
      expect(ownerTrialPayload.message).toBe('Started a 7-day premium trial.');

      const billingAfterTrial = await selectOrganizationBillingRow(organizationId);
      expect(billingAfterTrial?.planCode).toBe('premium');
      expect(billingAfterTrial?.subscriptionStatus).toBe('trialing');
      expect(billingAfterTrial?.billingInterval).toBe('month');
      expect(Boolean(billingAfterTrial?.cancelAtPeriodEnd)).toBe(false);
      expect(billingAfterTrial?.currentPeriodStart).not.toBeNull();
      expect(billingAfterTrial?.currentPeriodEnd).not.toBeNull();
      expect(
        Number(billingAfterTrial?.currentPeriodEnd ?? 0) -
          Number(billingAfterTrial?.currentPeriodStart ?? 0),
      ).toBe(7 * 24 * 60 * 60 * 1000);

      const trialBillingResponse = await owner.request(
        `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
      );
      expect(trialBillingResponse.status).toBe(200);
      const trialBillingPayload = (await toJson(trialBillingResponse)) as Record<string, unknown>;
      expect(trialBillingPayload.planCode).toBe('premium');
      expect(trialBillingPayload.subscriptionStatus).toBe('trialing');
      expect(trialBillingPayload.planState).toBe('premium_trial');
      expect(trialBillingPayload.trialEndsAt).toBe(
        new Date(Number(billingAfterTrial?.currentPeriodEnd)).toISOString(),
      );
      expect(await selectOrganizationBillingAuditEventRows(organizationId)).toEqual([
        expect.objectContaining({
          sequenceNumber: 1,
          sourceKind: 'trial_start',
          previousPlanState: 'free',
          nextPlanState: 'premium_trial',
          previousSubscriptionStatus: 'free',
          nextSubscriptionStatus: 'trialing',
          previousEntitlementState: 'free_only',
          nextEntitlementState: 'premium_enabled',
        }),
      ]);
      expect(await selectOrganizationBillingSignalRows(organizationId)).toEqual([]);

      const duplicateTrialResponse = await owner.request(
        '/api/v1/auth/organizations/billing/trial',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId }),
        },
      );
      expect(duplicateTrialResponse.status).toBe(409);
      const duplicateTrialPayload = (await toJson(duplicateTrialResponse)) as Record<
        string,
        unknown
      >;
      expect(duplicateTrialPayload.message).toBe(
        'Organization already has an active premium trial or paid subscription.',
      );

      await setOrganizationBillingState({
        organizationId,
        planCode: 'premium',
        subscriptionStatus: 'active',
        billingInterval: 'month',
        currentPeriodEnd: new Date(1779000000000),
      });

      const activeConflictResponse = await owner.request(
        '/api/v1/auth/organizations/billing/trial',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId }),
        },
      );
      expect(activeConflictResponse.status).toBe(409);
      const activeConflictPayload = (await toJson(activeConflictResponse)) as Record<
        string,
        unknown
      >;
      expect(activeConflictPayload.message).toBe(
        'Organization already has an active premium trial or paid subscription.',
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('プレミアム価格設定がある場合に Stripe 管理のトライアル購読を作成する', async () => {
    const stripeSecretKey = 'sk_test_trial_subscription';
    const stripeWebhookSecret = 'whsec_test_trial_subscription';
    const stripeMonthlyPriceId = 'price_trial_monthly';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
        STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED: 'true',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);

    const originalFetch = globalThis.fetch;
    let lastSubscriptionBody = '';
    const currentPeriodStartSeconds = Math.floor(Date.now() / 1000);
    const currentPeriodEndSeconds = currentPeriodStartSeconds + 7 * 24 * 60 * 60;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';

      if (url === 'https://api.stripe.com/v1/customers' && method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'cus_trial_subscription',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url === 'https://api.stripe.com/v1/subscriptions' && method === 'POST') {
        lastSubscriptionBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(
          JSON.stringify({
            id: 'sub_trial_subscription',
            customer: 'cus_trial_subscription',
            status: 'trialing',
            cancel_at_period_end: false,
            current_period_start: currentPeriodStartSeconds,
            current_period_end: currentPeriodEndSeconds,
            items: {
              data: [
                {
                  price: {
                    id: stripeMonthlyPriceId,
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url.startsWith('https://api.stripe.com/v1/customers/cus_trial_subscription')) {
        return new Response(
          JSON.stringify({
            id: 'cus_trial_subscription',
            invoice_settings: {
              default_payment_method: null,
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: owner,
        name: 'Stripe Trial Owner',
        email: 'stripe-trial-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Stripe Trial Org',
        slug: 'stripe-trial-org',
      });

      const trialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      expect(trialResponse.status).toBe(200);

      const subscriptionParams = new URLSearchParams(lastSubscriptionBody);
      expect(subscriptionParams.get('customer')).toBe('cus_trial_subscription');
      expect(subscriptionParams.get('items[0][price]')).toBe(stripeMonthlyPriceId);
      expect(subscriptionParams.get('trial_period_days')).toBe('7');
      expect(subscriptionParams.get('trial_settings[end_behavior][missing_payment_method]')).toBe(
        'cancel',
      );
      expect(subscriptionParams.get('metadata[billingPurpose]')).toBe('organization_plan');
      expect(subscriptionParams.get('metadata[organizationId]')).toBe(organizationId);
      expect(subscriptionParams.get('metadata[billingInterval]')).toBe('month');

      const billingAfterTrial = await selectOrganizationBillingRow(organizationId);
      expect(billingAfterTrial?.planCode).toBe('premium');
      expect(billingAfterTrial?.subscriptionStatus).toBe('trialing');
      expect(billingAfterTrial?.billingInterval).toBe('month');
      expect(billingAfterTrial?.stripeCustomerId).toBe('cus_trial_subscription');
      expect(billingAfterTrial?.stripeSubscriptionId).toBe('sub_trial_subscription');
      expect(billingAfterTrial?.stripePriceId).toBe(stripeMonthlyPriceId);
      expect(billingAfterTrial?.trialStartedAt).toBe(currentPeriodStartSeconds * 1000);
      expect(billingAfterTrial?.currentPeriodEnd).toBe(currentPeriodEndSeconds * 1000);

      const summaryResponse = await owner.request(
        `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
      );
      expect(summaryResponse.status).toBe(200);
      const summaryPayload = (await toJson(summaryResponse)) as Record<string, unknown>;
      expect(summaryPayload.trialStartedAt).toBe(
        new Date(currentPeriodStartSeconds * 1000).toISOString(),
      );
      expect(summaryPayload.premiumEligible).toBe(true);
      expect(summaryPayload.capabilities).toContain('organization_premium_features');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('オーナー限定の支払い方法登録ハンドオフを作成し設定状態を課金サマリーに反映する', async () => {
    const stripeSecretKey = 'sk_test_dummy';
    const stripeWebhookSecret = 'whsec_test_dummy';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);

    let createdCustomerCalls = 0;
    let createdSetupSessionCalls = 0;
    let lastSetupSessionBody = '';
    let defaultPaymentMethodId: string | null = null;

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === 'https://api.stripe.com/v1/customers') {
        createdCustomerCalls += 1;
        return new Response(
          JSON.stringify({
            id: 'cus_test_payment_method',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url === 'https://api.stripe.com/v1/checkout/sessions') {
        createdSetupSessionCalls += 1;
        lastSetupSessionBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(
          JSON.stringify({
            id: 'cs_test_payment_method_setup',
            url: 'https://checkout.stripe.com/c/pay/cs_test_payment_method_setup',
            status: 'open',
            payment_status: 'no_payment_required',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url.startsWith('https://api.stripe.com/v1/customers/cus_test_payment_method')) {
        return new Response(
          JSON.stringify({
            id: 'cus_test_payment_method',
            invoice_settings: {
              default_payment_method: defaultPaymentMethodId
                ? { id: defaultPaymentMethodId }
                : null,
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: owner,
        name: 'Setup Owner',
        email: 'setup-owner@example.com',
      });

      const organizationId = await createOrganization({
        agent: owner,
        name: 'Setup Org',
        slug: 'setup-org',
      });

      const admin = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: admin,
        name: 'Setup Admin',
        email: 'setup-admin@example.com',
      });
      await insertOrganizationMember({
        organizationId,
        userId: (await selectUserIdByEmail('setup-admin@example.com')) as string,
        role: 'admin',
      });

      const ownerTrialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      expect(ownerTrialResponse.status).toBe(200);

      const initialSummaryResponse = await owner.request(
        `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
      );
      expect(initialSummaryResponse.status).toBe(200);
      const initialSummaryPayload = (await toJson(initialSummaryResponse)) as Record<
        string,
        unknown
      >;
      expect(initialSummaryPayload.planState).toBe('premium_trial');
      expect(initialSummaryPayload.paymentMethodStatus).toBe('not_started');

      const adminHandoffResponse = await admin.request(
        '/api/v1/auth/organizations/billing/payment-method',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId }),
        },
      );
      expect(adminHandoffResponse.status).toBe(403);
      expect(createdCustomerCalls).toBe(0);
      expect(createdSetupSessionCalls).toBe(0);

      const ownerHandoffResponse = await owner.request(
        '/api/v1/auth/organizations/billing/payment-method',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId }),
        },
      );
      expect(ownerHandoffResponse.status).toBe(200);
      const ownerHandoffPayload = (await toJson(ownerHandoffResponse)) as Record<string, unknown>;
      expect(ownerHandoffPayload.url).toBe(
        'https://checkout.stripe.com/c/pay/cs_test_payment_method_setup',
      );
      expect(createdCustomerCalls).toBe(1);
      expect(createdSetupSessionCalls).toBe(1);
      expect(lastSetupSessionBody).toContain('mode=setup');
      expect(lastSetupSessionBody).toContain('currency=jpy');
      expect(lastSetupSessionBody).toContain('customer=cus_test_payment_method');

      const billingAfterHandoff = await selectOrganizationBillingRow(organizationId);
      expect(billingAfterHandoff?.stripeCustomerId).toBe('cus_test_payment_method');
      expect(billingAfterHandoff?.planCode).toBe('premium');
      expect(billingAfterHandoff?.subscriptionStatus).toBe('trialing');
      expect(await selectOrganizationBillingAuditEventRows(organizationId)).toEqual([
        expect.objectContaining({
          sequenceNumber: 1,
          sourceKind: 'trial_start',
          nextPlanState: 'premium_trial',
        }),
        expect.objectContaining({
          sequenceNumber: 2,
          sourceKind: 'payment_method_customer_linked',
          previousPaymentMethodStatus: 'not_started',
          nextPaymentMethodStatus: 'pending',
          nextEntitlementState: 'premium_enabled',
        }),
      ]);

      const pendingSummaryResponse = await owner.request(
        `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
      );
      expect(pendingSummaryResponse.status).toBe(200);
      const pendingSummaryPayload = (await toJson(pendingSummaryResponse)) as Record<
        string,
        unknown
      >;
      expect(pendingSummaryPayload.paymentMethodStatus).toBe('pending');

      defaultPaymentMethodId = 'pm_test_card';

      const completedSummaryResponse = await owner.request(
        `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
      );
      expect(completedSummaryResponse.status).toBe(200);
      const completedSummaryPayload = (await toJson(completedSummaryResponse)) as Record<
        string,
        unknown
      >;
      expect(completedSummaryPayload.paymentMethodStatus).toBe('registered');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('セットアップ Checkout 完了を Stripe の既定支払い方法へ同期する', async () => {
    const stripeSecretKey = 'sk_test_setup_webhook';
    const stripeWebhookSecret = 'whsec_test_setup_webhook';
    const stripeMonthlyPriceId = 'price_setup_webhook_monthly';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: stripeMonthlyPriceId,
        STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED: 'true',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);

    const originalFetch = globalThis.fetch;
    let defaultPaymentMethodId: string | null = null;
    let customerDefaultPaymentMethodBody = '';
    let subscriptionDefaultPaymentMethodBody = '';
    const currentPeriodStartSeconds = Math.floor(Date.now() / 1000);
    const currentPeriodEndSeconds = currentPeriodStartSeconds + 7 * 24 * 60 * 60;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';

      if (url === 'https://api.stripe.com/v1/customers' && method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'cus_setup_webhook',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url === 'https://api.stripe.com/v1/subscriptions' && method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'sub_setup_webhook',
            customer: 'cus_setup_webhook',
            status: 'trialing',
            cancel_at_period_end: false,
            current_period_start: currentPeriodStartSeconds,
            current_period_end: currentPeriodEndSeconds,
            items: {
              data: [
                {
                  price: {
                    id: stripeMonthlyPriceId,
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url === 'https://api.stripe.com/v1/checkout/sessions' && method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'cs_setup_webhook',
            url: 'https://checkout.stripe.com/c/pay/cs_setup_webhook',
            status: 'open',
            payment_status: 'no_payment_required',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url.startsWith('https://api.stripe.com/v1/checkout/sessions/cs_setup_webhook')) {
        return new Response(
          JSON.stringify({
            id: 'cs_setup_webhook',
            customer: 'cus_setup_webhook',
            setup_intent: {
              id: 'seti_setup_webhook',
              payment_method: 'pm_setup_webhook',
            },
            metadata: {
              billingPurpose: 'organization_payment_method',
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url.startsWith('https://api.stripe.com/v1/customers/cus_setup_webhook')) {
        if (method === 'POST') {
          customerDefaultPaymentMethodBody = typeof init?.body === 'string' ? init.body : '';
          const params = new URLSearchParams(customerDefaultPaymentMethodBody);
          defaultPaymentMethodId = params.get('invoice_settings[default_payment_method]');
          return new Response(
            JSON.stringify({
              id: 'cus_setup_webhook',
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          );
        }

        return new Response(
          JSON.stringify({
            id: 'cus_setup_webhook',
            invoice_settings: {
              default_payment_method: defaultPaymentMethodId
                ? { id: defaultPaymentMethodId }
                : null,
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (
        url === 'https://api.stripe.com/v1/subscriptions/sub_setup_webhook' &&
        method === 'POST'
      ) {
        subscriptionDefaultPaymentMethodBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(
          JSON.stringify({
            id: 'sub_setup_webhook',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: owner,
        name: 'Setup Webhook Owner',
        email: 'setup-webhook-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Setup Webhook Org',
        slug: 'setup-webhook-org',
      });

      const trialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      expect(trialResponse.status).toBe(200);

      const handoffResponse = await owner.request(
        '/api/v1/auth/organizations/billing/payment-method',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId }),
        },
      );
      expect(handoffResponse.status).toBe(200);

      const payload = JSON.stringify({
        id: 'evt_setup_webhook_completed',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_setup_webhook',
            customer: 'cus_setup_webhook',
            setup_intent: 'seti_setup_webhook',
            metadata: {
              billingPurpose: 'organization_payment_method',
              organizationId,
            },
          },
        },
      });
      const signature = await createStripeSignatureHeader(payload, stripeWebhookSecret);
      const webhookResponse = await appWithStripe.request('/api/webhooks/stripe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signature,
        },
        body: payload,
      });
      expect(webhookResponse.status).toBe(200);

      expect(
        new URLSearchParams(customerDefaultPaymentMethodBody).get(
          'invoice_settings[default_payment_method]',
        ),
      ).toBe('pm_setup_webhook');
      expect(
        new URLSearchParams(subscriptionDefaultPaymentMethodBody).get('default_payment_method'),
      ).toBe('pm_setup_webhook');

      const summaryResponse = await owner.request(
        `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
      );
      expect(summaryResponse.status).toBe(200);
      const summaryPayload = (await toJson(summaryResponse)) as Record<string, unknown>;
      expect(summaryPayload.paymentMethodStatus).toBe('registered');

      const auditRows = await selectOrganizationBillingAuditEventRows(organizationId);
      expect(auditRows).toEqual([
        expect.objectContaining({
          sequenceNumber: 1,
          sourceKind: 'trial_start',
        }),
        expect.objectContaining({
          sequenceNumber: 2,
          sourceKind: 'payment_method_registered',
          stripeEventId: 'evt_setup_webhook_completed',
          previousPaymentMethodStatus: 'pending',
          nextPaymentMethodStatus: 'registered',
        }),
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('終了したプレミアムトライアルを有料プレミアムへ変換し運用データを保持する', async () => {
    const stripeSecretKey = 'sk_test_dummy';
    const stripeWebhookSecret = 'whsec_test_dummy';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith('https://api.stripe.com/v1/customers/cus_trial_completion_paid')) {
        return new Response(
          JSON.stringify({
            id: 'cus_trial_completion_paid',
            invoice_settings: {
              default_payment_method: {
                id: 'pm_trial_completion_paid',
              },
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: owner,
        name: 'Trial Completion Owner',
        email: 'trial-completion-owner@example.com',
      });

      const organizationId = await createOrganization({
        agent: owner,
        name: 'Trial Completion Org',
        slug: 'trial-completion-org',
      });

      const ownerTrialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      expect(ownerTrialResponse.status).toBe(200);

      const billingBeforeCompletion = await selectOrganizationBillingRow(organizationId);
      expect(billingBeforeCompletion?.subscriptionStatus).toBe('trialing');

      await setOrganizationBillingState({
        organizationId,
        planCode: 'premium',
        subscriptionStatus: 'trialing',
        stripeCustomerId: 'cus_trial_completion_paid',
        currentPeriodEnd: new Date(Date.now() - 60_000),
      });

      const ownerUserRow = await d1
        .prepare('SELECT id FROM user WHERE email = ? LIMIT 1')
        .bind('trial-completion-owner@example.com')
        .first<{ id: string }>();
      expect(ownerUserRow?.id).toBeTruthy();

      const storeId = crypto.randomUUID();
      const serviceId = crypto.randomUUID();
      const participantId = crypto.randomUUID();
      const slotId = crypto.randomUUID();
      const bookingId = crypto.randomUUID();
      const now = Date.now();

      await d1
        .prepare('INSERT INTO store (id, organization_id, slug, name) VALUES (?, ?, ?, ?)')
        .bind(storeId, organizationId, 'trial-completion-room', 'Trial Completion Room')
        .run();
      await d1
        .prepare(
          'INSERT INTO service (id, organization_id, store_id, name, description, kind, duration_minutes, capacity, booking_policy, requires_ticket, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          serviceId,
          organizationId,
          storeId,
          'Premium Yoga',
          'Trial lifecycle data preservation service',
          'event',
          60,
          8,
          'instant',
          0,
          1,
        )
        .run();
      await d1
        .prepare(
          'INSERT INTO participant (id, organization_id, store_id, user_id, email, name) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(
          participantId,
          organizationId,
          storeId,
          ownerUserRow?.id as string,
          'trial-completion-owner@example.com',
          'Trial Completion Owner',
        )
        .run();
      await d1
        .prepare(
          'INSERT INTO slot (id, organization_id, store_id, service_id, start_at, end_at, capacity, reserved_count, status, booking_open_at, booking_close_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          slotId,
          organizationId,
          storeId,
          serviceId,
          now + 3_600_000,
          now + 7_200_000,
          8,
          1,
          'open',
          now - 3_600_000,
          now + 1_800_000,
        )
        .run();
      await d1
        .prepare(
          'INSERT INTO booking (id, organization_id, store_id, slot_id, service_id, participant_id, participants_count, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(bookingId, organizationId, storeId, slotId, serviceId, participantId, 1, 'confirmed')
        .run();

      const countsBeforeCompletion = await selectOrganizationOperationalRowCounts(organizationId);
      expect(countsBeforeCompletion).toEqual({
        storeCount: 2,
        serviceCount: 1,
        participantCount: 1,
        bookingCount: 1,
      });

      const completionResponse = await owner.request(
        '/api/v1/auth/organizations/billing/trial/complete',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId }),
        },
      );
      expect(completionResponse.status).toBe(200);
      const completionPayload = (await toJson(completionResponse)) as Record<string, unknown>;
      expect(completionPayload.message).toBe(
        'Organization premium trial converted to premium paid.',
      );

      const billingAfterCompletion = await selectOrganizationBillingRow(organizationId);
      expect(billingAfterCompletion?.planCode).toBe('premium');
      expect(billingAfterCompletion?.subscriptionStatus).toBe('active');
      expect(billingAfterCompletion?.currentPeriodStart).not.toBeNull();
      expect(billingAfterCompletion?.currentPeriodEnd).toBeNull();
      expect(billingAfterCompletion?.stripeCustomerId).toBe('cus_trial_completion_paid');

      const summaryResponse = await owner.request(
        `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
      );
      expect(summaryResponse.status).toBe(200);
      const summaryPayload = (await toJson(summaryResponse)) as Record<string, unknown>;
      expect(summaryPayload.planState).toBe('premium_paid');
      expect(summaryPayload.subscriptionStatus).toBe('active');
      expect(summaryPayload.trialEndsAt).toBeNull();
      expect(summaryPayload.paymentMethodStatus).toBe('registered');

      const auditRows = await selectOrganizationBillingAuditEventRows(organizationId);
      expect(auditRows).toEqual([
        expect.objectContaining({
          sequenceNumber: 1,
          sourceKind: 'trial_start',
          previousPlanState: 'free',
          nextPlanState: 'premium_trial',
          previousSubscriptionStatus: 'free',
          nextSubscriptionStatus: 'trialing',
          previousEntitlementState: 'free_only',
          nextEntitlementState: 'premium_enabled',
        }),
        expect.objectContaining({
          sequenceNumber: 2,
          sourceKind: 'trial_completion',
          sourceContext: 'Organization premium trial converted to premium paid.',
          previousPlanState: 'premium_trial',
          nextPlanState: 'premium_paid',
          previousSubscriptionStatus: 'trialing',
          nextSubscriptionStatus: 'active',
          previousPaymentMethodStatus: 'registered',
          nextPaymentMethodStatus: 'registered',
          previousEntitlementState: 'free_only',
          nextEntitlementState: 'premium_enabled',
        }),
      ]);

      const countsAfterCompletion = await selectOrganizationOperationalRowCounts(organizationId);
      expect(countsAfterCompletion).toEqual(countsBeforeCompletion);

      const duplicateCompletionResponse = await owner.request(
        '/api/v1/auth/organizations/billing/trial/complete',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId }),
        },
      );
      expect(duplicateCompletionResponse.status).toBe(409);
      const duplicateCompletionPayload = (await toJson(duplicateCompletionResponse)) as Record<
        string,
        unknown
      >;
      expect(duplicateCompletionPayload.message).toBe(
        'Organization does not have an active premium trial.',
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('課金条件を満たさない終了済みプレミアムトライアルを無料へ戻す', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Trial Fallback Owner',
      email: 'trial-fallback-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Trial Fallback Org',
      slug: 'trial-fallback-org',
    });

    const ownerTrialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId }),
    });
    expect(ownerTrialResponse.status).toBe(200);

    await setOrganizationBillingState({
      organizationId,
      planCode: 'premium',
      subscriptionStatus: 'trialing',
      currentPeriodEnd: new Date(Date.now() - 60_000),
    });

    const completionResponse = await owner.request(
      '/api/v1/auth/organizations/billing/trial/complete',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      },
    );
    expect(completionResponse.status).toBe(200);
    const completionPayload = (await toJson(completionResponse)) as Record<string, unknown>;
    expect(completionPayload.message).toBe(
      'Organization premium trial ended and returned to free because billing requirements were not met.',
    );

    const billingAfterCompletion = await selectOrganizationBillingRow(organizationId);
    expect(billingAfterCompletion?.planCode).toBe('free');
    expect(billingAfterCompletion?.billingInterval).toBeNull();
    expect(billingAfterCompletion?.subscriptionStatus).toBe('free');
    expect(Boolean(billingAfterCompletion?.cancelAtPeriodEnd)).toBe(false);
    expect(billingAfterCompletion?.trialStartedAt).not.toBeNull();
    expect(billingAfterCompletion?.trialEndedAt).not.toBeNull();
    expect(billingAfterCompletion?.currentPeriodStart).toBeNull();
    expect(billingAfterCompletion?.currentPeriodEnd).toBeNull();

    const summaryResponse = await owner.request(
      `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
    );
    expect(summaryResponse.status).toBe(200);
    const summaryPayload = (await toJson(summaryResponse)) as Record<string, unknown>;
    expect(summaryPayload.planState).toBe('free');
    expect(summaryPayload.subscriptionStatus).toBe('free');
    expect(summaryPayload.trialEndsAt).toBeNull();
    expect(summaryPayload.paymentMethodStatus).toBe('not_started');

    const auditRows = await selectOrganizationBillingAuditEventRows(organizationId);
    expect(auditRows).toEqual([
      expect.objectContaining({
        sequenceNumber: 1,
        sourceKind: 'trial_start',
        previousPlanState: 'free',
        nextPlanState: 'premium_trial',
        previousSubscriptionStatus: 'free',
        nextSubscriptionStatus: 'trialing',
      }),
      expect.objectContaining({
        sequenceNumber: 2,
        sourceKind: 'trial_completion',
        sourceContext:
          'Organization premium trial ended and returned to free because billing requirements were not met.',
        previousPlanState: 'premium_trial',
        nextPlanState: 'free',
        previousSubscriptionStatus: 'trialing',
        nextSubscriptionStatus: 'free',
        previousPaymentMethodStatus: 'not_started',
        nextPaymentMethodStatus: 'not_started',
        previousEntitlementState: 'free_only',
        nextEntitlementState: 'free_only',
      }),
    ]);

    const repeatedTrialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId }),
    });
    expect(repeatedTrialResponse.status).toBe(409);
    const repeatedTrialPayload = (await toJson(repeatedTrialResponse)) as Record<string, unknown>;
    expect(repeatedTrialPayload.message).toBe(
      'Organization already has an active premium trial or paid subscription.',
    );
  });

  it('スケジュールされた課金メンテナンスで期限切れローカルプレミアムトライアルを完了する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Scheduled Trial Owner',
      email: 'scheduled-trial-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Scheduled Trial Org',
      slug: 'scheduled-trial-org',
    });

    const trialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId }),
    });
    expect(trialResponse.status).toBe(200);

    const maintenanceNow = new Date(Date.now() + 60_000);
    await setOrganizationBillingState({
      organizationId,
      planCode: 'premium',
      subscriptionStatus: 'trialing',
      currentPeriodEnd: new Date(maintenanceNow.getTime() - 1),
    });
    await d1
      .prepare(
        "UPDATE billing_subscription SET status = 'active', updated_at = ? WHERE status = 'trialing' AND current_period_end IS NOT NULL AND current_period_end < ? AND billing_account_id NOT IN (SELECT id FROM billing_account WHERE subject_type = ? AND subject_id = ?)",
      )
      .bind(Date.now(), maintenanceNow.getTime(), 'organization', organizationId)
      .run();

    const result = await completeExpiredOrganizationPremiumTrials({
      database: drizzle(d1),
      env: {},
      now: maintenanceNow,
    });
    expect(result).toEqual({
      scanned: 1,
      completed: 1,
      failed: 0,
    });

    const billingAfterMaintenance = await selectOrganizationBillingRow(organizationId);
    expect(billingAfterMaintenance?.planCode).toBe('free');
    expect(billingAfterMaintenance?.subscriptionStatus).toBe('free');
    expect(billingAfterMaintenance?.trialStartedAt).not.toBeNull();
    expect(billingAfterMaintenance?.trialEndedAt).toBe(maintenanceNow.getTime());
    expect(await selectOrganizationBillingAuditEventRows(organizationId)).toEqual([
      expect.objectContaining({
        sequenceNumber: 1,
        sourceKind: 'trial_start',
      }),
      expect.objectContaining({
        sequenceNumber: 2,
        sourceKind: 'trial_completion',
        sourceContext:
          'Organization premium trial ended and returned to free because billing requirements were not met.',
        previousPlanState: 'premium_trial',
        nextPlanState: 'free',
      }),
    ]);
  });

  it('不正なトライアル完了リクエストを拒否し既存の課金状態を維持する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Trial Conflict Owner',
      email: 'trial-conflict-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Trial Conflict Org',
      slug: 'trial-conflict-org',
    });

    const freeCompletionResponse = await owner.request(
      '/api/v1/auth/organizations/billing/trial/complete',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      },
    );
    expect(freeCompletionResponse.status).toBe(409);
    const freeCompletionPayload = (await toJson(freeCompletionResponse)) as Record<string, unknown>;
    expect(freeCompletionPayload.message).toBe(
      'Organization does not have an active premium trial.',
    );

    const initialBilling = await selectOrganizationBillingRow(organizationId);
    expect(initialBilling?.planCode).toBe('free');
    expect(initialBilling?.subscriptionStatus).toBe('free');

    const ownerTrialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId }),
    });
    expect(ownerTrialResponse.status).toBe(200);

    const trialBillingBeforeCompletion = await selectOrganizationBillingRow(organizationId);
    expect(trialBillingBeforeCompletion?.subscriptionStatus).toBe('trialing');

    const prematureCompletionResponse = await owner.request(
      '/api/v1/auth/organizations/billing/trial/complete',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      },
    );
    expect(prematureCompletionResponse.status).toBe(409);
    const prematureCompletionPayload = (await toJson(prematureCompletionResponse)) as Record<
      string,
      unknown
    >;
    expect(prematureCompletionPayload.message).toBe(
      'Organization premium trial has not reached its completion time yet.',
    );

    const trialBillingAfterConflict = await selectOrganizationBillingRow(organizationId);
    expect(trialBillingAfterConflict?.planCode).toBe('premium');
    expect(trialBillingAfterConflict?.subscriptionStatus).toBe('trialing');
    expect(trialBillingAfterConflict?.currentPeriodEnd).toBe(
      trialBillingBeforeCompletion?.currentPeriodEnd,
    );
  });

  it('支払い方法の反映をまだ確認できない場合はトライアルを変更しない', async () => {
    const stripeSecretKey = 'sk_test_dummy';
    const stripeWebhookSecret = 'whsec_test_dummy';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith('https://api.stripe.com/v1/customers/cus_trial_completion_pending')) {
        return new Response(
          JSON.stringify({
            error: {
              message: 'Stripe customer state is temporarily unavailable.',
            },
          }),
          {
            status: 500,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return originalFetch(input, init);
    });

    let paymentMethodPendingTrialOrganizationId: string | null = null;
    try {
      const owner = createAuthAgent(appWithStripe);
      await signUpUser({
        agent: owner,
        name: 'Trial Pending Owner',
        email: 'trial-pending-owner@example.com',
      });

      const organizationId = await createOrganization({
        agent: owner,
        name: 'Trial Pending Org',
        slug: 'trial-pending-org',
      });
      paymentMethodPendingTrialOrganizationId = organizationId;

      const ownerTrialResponse = await owner.request('/api/v1/auth/organizations/billing/trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      expect(ownerTrialResponse.status).toBe(200);

      await setOrganizationBillingState({
        organizationId,
        planCode: 'premium',
        subscriptionStatus: 'trialing',
        stripeCustomerId: 'cus_trial_completion_pending',
        currentPeriodEnd: new Date(Date.now() - 60_000),
      });

      const completionResponse = await owner.request(
        '/api/v1/auth/organizations/billing/trial/complete',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId }),
        },
      );
      expect(completionResponse.status).toBe(503);
      const completionPayload = (await toJson(completionResponse)) as Record<string, unknown>;
      expect(completionPayload.message).toBe(
        'Payment method status is still syncing with Stripe. Retry after billing synchronization completes.',
      );

      const billingAfterAttempt = await selectOrganizationBillingRow(organizationId);
      expect(billingAfterAttempt?.planCode).toBe('premium');
      expect(billingAfterAttempt?.subscriptionStatus).toBe('trialing');

      const summaryResponse = await owner.request(
        `/api/v1/auth/organizations/billing?organizationId=${encodeURIComponent(organizationId)}`,
      );
      expect(summaryResponse.status).toBe(200);
      const summaryPayload = (await toJson(summaryResponse)) as Record<string, unknown>;
      expect(summaryPayload.planState).toBe('premium_trial');
      expect(summaryPayload.paymentMethodStatus).toBe('pending');
    } finally {
      if (paymentMethodPendingTrialOrganizationId) {
        await setOrganizationBillingState({
          organizationId: paymentMethodPendingTrialOrganizationId,
          planCode: 'premium',
          subscriptionStatus: 'trialing',
          currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
      }
      fetchSpy.mockRestore();
    }
  });

  it('招待ポリシーと監査ログを処理する', async () => {
    const inviter = createAuthAgent(app);
    await signUpUser({
      agent: inviter,
      name: 'Inviter',
      email: 'inviter@example.com',
    });

    const organizationId = await createOrganization({
      agent: inviter,
      name: 'Invite Org',
      slug: 'invite-org',
    });
    await enablePremiumForOrganization(organizationId);

    const ownerInvite = await createInvitation({
      agent: inviter,
      email: 'owner-target@example.com',
      role: 'owner',
      organizationId,
    });
    expect(ownerInvite.response.status).toBe(400);

    const created = await createInvitation({
      agent: inviter,
      email: 'invitee@example.com',
      role: 'admin',
      organizationId,
    });
    expect(created.response.status).toBe(200);
    expect(typeof created.payload?.id).toBe('string');

    const invitationId = created.payload?.id as string;
    expect(await selectInvitationActionCount(invitationId, 'created')).toBe(1);

    for (let index = 0; index < 3; index += 1) {
      const resent = await createInvitation({
        agent: inviter,
        email: 'invitee@example.com',
        role: 'admin',
        organizationId,
        resend: true,
      });

      expect(resent.response.status).toBe(200);
    }

    const resendLimit = await createInvitation({
      agent: inviter,
      email: 'invitee@example.com',
      role: 'admin',
      organizationId,
      resend: true,
    });
    expect(resendLimit.response.status).toBe(429);
    expect(await selectInvitationActionCount(invitationId, 'resent')).toBe(3);

    const invitee = createAuthAgent(app);
    await signUpUser({
      agent: invitee,
      name: 'Invitee',
      email: 'invitee@example.com',
    });

    const detailResponse = await invitee.request(buildInvitationDetailPath(invitationId));
    expect(detailResponse.status).toBe(200);

    const acceptResponse = await invitee.request(
      buildInvitationActionPath(invitationId, 'accept'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId,
        }),
      },
    );
    expect(acceptResponse.status).toBe(200);
    expect(await selectInvitationStatus(invitationId)).toBe('accepted');
    expect(await selectInvitationActionCount(invitationId, 'accepted')).toBe(1);

    const rejectTarget = await createInvitation({
      agent: inviter,
      email: 'rejectee@example.com',
      role: 'member',
      organizationId,
    });
    expect(rejectTarget.response.status).toBe(200);
    const rejectInvitationId = rejectTarget.payload?.id as string;

    const rejectee = createAuthAgent(app);
    await signUpUser({
      agent: rejectee,
      name: 'Rejectee',
      email: 'rejectee@example.com',
    });

    const rejectResponse = await rejectee.request(
      buildInvitationActionPath(rejectInvitationId, 'reject'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: rejectInvitationId,
        }),
      },
    );
    expect(rejectResponse.status).toBe(200);
    expect(await selectInvitationStatus(rejectInvitationId)).toBe('rejected');
    expect(await selectInvitationActionCount(rejectInvitationId, 'rejected')).toBe(1);

    const cancelTarget = await createInvitation({
      agent: inviter,
      email: 'cancel-target@example.com',
      role: 'member',
      organizationId,
    });
    expect(cancelTarget.response.status).toBe(200);
    const cancelInvitationId = cancelTarget.payload?.id as string;

    const cancelResponse = await inviter.request(
      buildInvitationActionPath(cancelInvitationId, 'cancel'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: cancelInvitationId,
        }),
      },
    );
    expect(cancelResponse.status).toBe(200);
    expect(await selectInvitationStatus(cancelInvitationId)).toBe('cancelled');
    expect(await selectInvitationActionCount(cancelInvitationId, 'cancelled')).toBe(1);
  });

  it('オーナーと参加者専用ユーザーの組織アクセスを一覧する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Access Owner',
      email: 'access-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Access Org',
      slug: 'access-org',
    });
    await enablePremiumForOrganization(organizationId);

    const participantInvite = await createParticipantInvitation({
      agent: owner,
      email: 'access-participant@example.com',
      participantName: 'Access Participant',
      organizationId,
    });
    expect(participantInvite.response.status).toBe(200);

    const participantUser = createAuthAgent(app);
    await signUpUser({
      agent: participantUser,
      name: 'Access Participant',
      email: 'access-participant@example.com',
    });
    const acceptParticipantInviteResponse = await participantUser.request(
      buildInvitationActionPath(participantInvite.payload?.id as string, 'accept'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: participantInvite.payload?.id,
        }),
      },
    );
    expect(acceptParticipantInviteResponse.status).toBe(200);

    const ownerAccessTreeResponse = await owner.request('/api/v1/auth/orgs/access-tree');
    expect(ownerAccessTreeResponse.status).toBe(200);
    const ownerAccessTreePayload = (await toJson(ownerAccessTreeResponse)) as {
      orgs?: Array<{
        org?: { id?: string; slug?: string; name?: string; logo?: string | null };
        stores?: Array<{
          id?: string;
          slug?: string;
          name?: string;
          facts?: {
            orgRole?: string | null;
            storeStaffRole?: string | null;
            hasParticipantRecord?: boolean;
          };
          effective?: {
            canManageOrganization?: boolean;
            canManageStore?: boolean;
            canUseParticipantBooking?: boolean;
          };
          display?: {
            primaryRole?: string | null;
          };
        }>;
      }>;
    };
    const ownerOrgEntry = ownerAccessTreePayload.orgs?.find(
      (entry) => entry.org?.id === organizationId,
    );
    expect(ownerOrgEntry).toBeDefined();
    expect(ownerOrgEntry?.org?.slug).toBe('access-org');
    expect(ownerOrgEntry?.stores?.[0]?.slug).toBe('access-org');
    expect(ownerOrgEntry?.stores?.[0]?.facts?.orgRole).toBe('owner');
    expect(ownerOrgEntry?.stores?.[0]?.display?.primaryRole).toBe('owner');
    expect(ownerOrgEntry?.stores?.[0]?.effective?.canManageStore).toBe(true);
    expect(ownerOrgEntry?.stores?.[0]?.effective?.canUseParticipantBooking).toBe(false);

    const participantAccessTreeResponse = await participantUser.request(
      '/api/v1/auth/orgs/access-tree',
    );
    expect(participantAccessTreeResponse.status).toBe(200);
    const participantAccessTreePayload = (await toJson(participantAccessTreeResponse)) as {
      orgs?: Array<{
        org?: { id?: string };
        stores?: Array<{
          facts?: {
            orgRole?: string | null;
            storeStaffRole?: string | null;
            hasParticipantRecord?: boolean;
          };
          effective?: {
            canManageStore?: boolean;
            canUseParticipantBooking?: boolean;
          };
          display?: {
            primaryRole?: string | null;
          };
        }>;
      }>;
    };
    const participantOrgEntry = participantAccessTreePayload.orgs?.find(
      (entry) => entry.org?.id === organizationId,
    );
    expect(participantOrgEntry?.stores?.[0]?.facts?.orgRole).toBeNull();
    expect(participantOrgEntry?.stores?.[0]?.facts?.storeStaffRole).toBeNull();
    expect(participantOrgEntry?.stores?.[0]?.facts?.hasParticipantRecord).toBe(true);
    expect(participantOrgEntry?.stores?.[0]?.display?.primaryRole).toBe('participant');
    expect(participantOrgEntry?.stores?.[0]?.effective?.canManageStore).toBe(false);
    expect(participantOrgEntry?.stores?.[0]?.effective?.canUseParticipantBooking).toBe(true);
  });

  it('店舗スケジュール管理をブロックしつつスタッフ予約と参加者操作を許可する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Staff Scope Owner',
      email: 'staff-scope-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Staff Scope Org',
      slug: 'staff-scope-org',
    });
    await enablePremiumForOrganization(organizationId);

    const staffInvite = await createStoreOperatorInvitation({
      agent: owner,
      email: 'staff-scope-user@example.com',
      role: 'staff',
      organizationId,
    });
    expect(staffInvite.response.status).toBe(200);
    const staffInvitationId = staffInvite.payload?.id as string;

    const staffUser = createAuthAgent(app);
    await signUpUser({
      agent: staffUser,
      name: 'Staff Scope User',
      email: 'staff-scope-user@example.com',
    });
    const acceptStaffInviteResponse = await staffUser.request(
      buildInvitationActionPath(staffInvitationId, 'accept'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: staffInvitationId,
        }),
      },
    );
    expect(acceptStaffInviteResponse.status).toBe(200);

    const staffAccessTreeResponse = await staffUser.request('/api/v1/auth/orgs/access-tree');
    expect(staffAccessTreeResponse.status).toBe(200);
    const staffAccessTreePayload = (await toJson(staffAccessTreeResponse)) as {
      orgs?: Array<{
        org?: { id?: string };
        stores?: Array<{
          facts?: {
            orgRole?: string | null;
            storeStaffRole?: string | null;
          };
          effective?: {
            canManageStore?: boolean;
            canManageBookings?: boolean;
            canManageParticipants?: boolean;
          };
          display?: {
            primaryRole?: string | null;
          };
        }>;
      }>;
    };
    const staffOrgEntry = staffAccessTreePayload.orgs?.find(
      (entry) => entry.org?.id === organizationId,
    );
    expect(staffOrgEntry?.stores?.[0]?.facts?.orgRole).toBe('member');
    expect(staffOrgEntry?.stores?.[0]?.facts?.storeStaffRole).toBe('staff');
    expect(staffOrgEntry?.stores?.[0]?.effective?.canManageStore).toBe(false);
    expect(staffOrgEntry?.stores?.[0]?.effective?.canManageBookings).toBe(true);
    expect(staffOrgEntry?.stores?.[0]?.effective?.canManageParticipants).toBe(true);
    expect(staffOrgEntry?.stores?.[0]?.display?.primaryRole).toBe('staff');

    const serviceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        name: 'Staff Restricted Service',
        kind: 'single',
        durationMinutes: 60,
        capacity: 6,
      }),
    });
    expect(serviceResponse.status).toBe(200);
    const servicePayload = (await toJson(serviceResponse)) as Record<string, unknown>;
    const serviceId = servicePayload.id as string;

    const staffServicesResponse = await staffUser.request(
      `/api/v1/auth/organizations/services?organizationId=${encodeURIComponent(
        organizationId,
      )}&storeId=${encodeURIComponent(organizationId)}`,
    );
    expect(staffServicesResponse.status).toBe(200);
    const staffServicesPayload = (await toJson(staffServicesResponse)) as Array<
      Record<string, unknown>
    >;
    expect(staffServicesPayload.some((service) => service.id === serviceId)).toBe(true);

    const ticketTypeCreateResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-types',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          organizationId,
          name: 'Staff Visible Ticket Type',
          totalCount: 5,
          serviceIds: [serviceId],
        }),
      },
    );
    expect(ticketTypeCreateResponse.status).toBe(200);
    const ticketTypePayload = (await toJson(ticketTypeCreateResponse)) as Record<string, unknown>;
    const ticketTypeId = ticketTypePayload.id as string;

    const staffTicketTypesResponse = await staffUser.request(
      `/api/v1/auth/organizations/ticket-types?organizationId=${encodeURIComponent(
        organizationId,
      )}&storeId=${encodeURIComponent(organizationId)}`,
    );
    expect(staffTicketTypesResponse.status).toBe(200);
    const staffTicketTypesPayload = (await toJson(staffTicketTypesResponse)) as Array<
      Record<string, unknown>
    >;
    expect(staffTicketTypesPayload.some((ticketType) => ticketType.id === ticketTypeId)).toBe(true);

    const rangeStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const rangeEnd = new Date(rangeStart.getTime() + 60 * 60 * 1000);

    const staffCreateSlotResponse = await staffUser.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: rangeStart.toISOString(),
        endAt: rangeEnd.toISOString(),
      }),
    });
    expect(staffCreateSlotResponse.status).toBe(403);

    const recurringCreateResponse = await staffUser.request(
      '/api/v1/auth/organizations/recurring-schedules',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          organizationId,
          serviceId,
          timezone: 'Asia/Tokyo',
          frequency: 'weekly',
          interval: 1,
          byWeekday: [1],
          startDate: '2026-03-20',
          startTimeLocal: '10:00',
        }),
      },
    );
    expect(recurringCreateResponse.status).toBe(403);

    const ownerCreateSlotResponse = await owner.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: rangeStart.toISOString(),
        endAt: rangeEnd.toISOString(),
      }),
    });
    expect(ownerCreateSlotResponse.status).toBe(200);

    const staffBookingsResponse = await staffUser.request(
      `/api/v1/auth/organizations/bookings?organizationId=${encodeURIComponent(
        organizationId,
      )}&storeId=${encodeURIComponent(organizationId)}&from=${encodeURIComponent(
        rangeStart.toISOString(),
      )}&to=${encodeURIComponent(new Date(rangeStart.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString())}`,
    );
    expect(staffBookingsResponse.status).toBe(200);

    const staffParticipantsResponse = await staffUser.request(
      `/api/v1/auth/organizations/participants?organizationId=${encodeURIComponent(
        organizationId,
      )}&storeId=${encodeURIComponent(organizationId)}`,
    );
    expect(staffParticipantsResponse.status).toBe(200);
  });

  it('保存済み serviceIdsJson が不正でも回数券種別一覧は失敗しない', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Malformed Ticket Owner',
      email: 'malformed-ticket-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Malformed Ticket Org',
      slug: 'malformed-ticket-org',
    });
    await enablePremiumForOrganization(organizationId);
    const organizationSlug = await selectOrganizationSlugById(organizationId);
    expect(organizationSlug).toBe('malformed-ticket-org');

    const staffInvite = await createStoreOperatorInvitation({
      agent: owner,
      email: 'malformed-ticket-staff@example.com',
      role: 'staff',
      organizationId,
    });
    expect(staffInvite.response.status).toBe(200);

    const staff = createAuthAgent(app);
    await signUpUser({
      agent: staff,
      name: 'Malformed Ticket Staff',
      email: 'malformed-ticket-staff@example.com',
    });
    const acceptResponse = await staff.request(
      buildInvitationActionPath(staffInvite.payload?.id as string, 'accept'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: staffInvite.payload?.id,
        }),
      },
    );
    expect(acceptResponse.status).toBe(200);

    const storeRow = await d1
      .prepare('SELECT id FROM store WHERE organization_id = ? AND slug = ? LIMIT 1')
      .bind(organizationId, organizationSlug)
      .first<{ id: string }>();
    expect(storeRow?.id).toBeTruthy();

    await d1
      .prepare(
        'INSERT INTO ticket_type (id, organization_id, store_id, name, service_ids_json, total_count, expires_in_days, is_active, is_for_sale, stripe_price_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        crypto.randomUUID(),
        organizationId,
        storeRow?.id as string,
        'Broken Ticket Type',
        '{"broken":',
        5,
        null,
        1,
        0,
        null,
      )
      .run();

    const ticketTypesResponse = await staff.request(
      `/api/v1/auth/organizations/ticket-types?organizationId=${encodeURIComponent(
        organizationId,
      )}&storeId=${encodeURIComponent(storeRow?.id as string)}`,
    );
    expect(ticketTypesResponse.status).toBe(200);
    const payload = (await toJson(ticketTypesResponse)) as Array<{
      name?: unknown;
      serviceIds?: unknown;
    }>;
    const brokenTicketType = payload.find((entry) => entry.name === 'Broken Ticket Type');
    expect(brokenTicketType?.serviceIds).toEqual([]);
  });

  it('アクセスツリーとスコープ付きサービスルートで複数店舗をサポートする', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Multi Store Owner',
      email: 'multi-store-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Multi Store Org',
      slug: 'multi-store-org',
    });
    await enablePremiumForOrganization(organizationId);
    const organizationSlug = await selectOrganizationSlugById(organizationId);
    expect(organizationSlug).toBe('multi-store-org');

    const secondStoreId = crypto.randomUUID();
    const secondStoreSlug = 'room-b';
    await d1
      .prepare('INSERT INTO store (id, organization_id, slug, name) VALUES (?, ?, ?, ?)')
      .bind(secondStoreId, organizationId, secondStoreSlug, 'Room B')
      .run();

    const defaultServiceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        name: 'Default Store Service',
        description: 'default store service',
        kind: 'single',
        bookingPolicy: 'instant',
        durationMinutes: 45,
        capacity: 4,
      }),
    });
    expect(defaultServiceResponse.status).toBe(200);
    const defaultServicePayload = (await toJson(defaultServiceResponse)) as Record<string, unknown>;

    const scopedServiceResponse = await owner.request(
      `/api/v1/auth/orgs/${encodeURIComponent(
        organizationSlug as string,
      )}/stores/${encodeURIComponent(secondStoreSlug)}/services`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Room B Service',
          description: 'second store service',
          kind: 'single',
          bookingPolicy: 'instant',
          durationMinutes: 30,
          capacity: 2,
        }),
      },
    );
    expect(scopedServiceResponse.status).toBe(200);
    const scopedServicePayload = (await toJson(scopedServiceResponse)) as Record<string, unknown>;
    expect(scopedServicePayload.storeId).toBe(secondStoreId);

    const accessTreeResponse = await owner.request('/api/v1/auth/orgs/access-tree');
    expect(accessTreeResponse.status).toBe(200);
    const accessTreePayload = (await toJson(accessTreeResponse)) as {
      orgs?: Array<{
        org?: { id?: string; slug?: string };
        stores?: Array<{
          id?: string;
          slug?: string;
          facts?: {
            orgRole?: string | null;
            storeStaffRole?: string | null;
          };
          effective?: {
            canManageStore?: boolean;
          };
          display?: {
            primaryRole?: string | null;
          };
        }>;
      }>;
    };
    const orgEntry = accessTreePayload.orgs?.find((entry) => entry.org?.id === organizationId);
    expect(orgEntry?.stores?.map((store) => store.slug)).toEqual(
      expect.arrayContaining(['multi-store-org', secondStoreSlug]),
    );
    const secondStoreEntry = orgEntry?.stores?.find((store) => store.slug === secondStoreSlug);
    expect(secondStoreEntry?.id).toBe(secondStoreId);
    expect(secondStoreEntry?.facts?.orgRole).toBe('owner');
    expect(secondStoreEntry?.display?.primaryRole).toBe('owner');
    expect(secondStoreEntry?.effective?.canManageStore).toBe(true);

    const defaultScopedListResponse = await owner.request(
      `/api/v1/auth/orgs/${encodeURIComponent(
        organizationSlug as string,
      )}/stores/${encodeURIComponent(organizationSlug as string)}/services`,
    );
    expect(defaultScopedListResponse.status).toBe(200);
    const defaultScopedList = (await toJson(defaultScopedListResponse)) as Array<
      Record<string, unknown>
    >;
    expect(defaultScopedList).toHaveLength(1);
    expect(defaultScopedList[0]?.id).toBe(defaultServicePayload.id);
    expect(defaultScopedList[0]?.storeId).not.toBe(secondStoreId);

    const secondScopedListResponse = await owner.request(
      `/api/v1/auth/orgs/${encodeURIComponent(
        organizationSlug as string,
      )}/stores/${encodeURIComponent(secondStoreSlug)}/services`,
    );
    expect(secondScopedListResponse.status).toBe(200);
    const secondScopedList = (await toJson(secondScopedListResponse)) as Array<
      Record<string, unknown>
    >;
    expect(secondScopedList).toHaveLength(1);
    expect(secondScopedList[0]?.id).toBe(scopedServicePayload.id);
    expect(secondScopedList[0]?.storeId).toBe(secondStoreId);
  });

  it('組織管理者向けに店舗の一覧・作成・更新を行う', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Store Owner',
      email: 'store-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Store Admin Org',
      slug: 'store-admin-org',
    });
    await enablePremiumForOrganization(organizationId);
    const organizationSlug = await selectOrganizationSlugById(organizationId);
    expect(organizationSlug).toBe('store-admin-org');

    const initialListResponse = await owner.request(
      `/api/v1/auth/orgs/${encodeURIComponent(organizationSlug as string)}/stores`,
    );
    expect(initialListResponse.status).toBe(200);
    const initialList = (await toJson(initialListResponse)) as Array<Record<string, unknown>>;
    expect(initialList).toHaveLength(1);
    expect(initialList[0]?.slug).toBe('store-admin-org');
    expect(
      (initialList[0]?.effective as { canManageStore?: boolean } | undefined)?.canManageStore,
    ).toBe(true);

    const createResponse = await owner.request(
      `/api/v1/auth/orgs/${encodeURIComponent(organizationSlug as string)}/stores`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Second Room',
          slug: 'second-room',
        }),
      },
    );
    expect(createResponse.status).toBe(200);
    const createdStore = (await toJson(createResponse)) as Record<string, unknown>;
    expect(createdStore.slug).toBe('second-room');
    expect(createdStore.name).toBe('Second Room');
    expect(
      (createdStore.effective as { canManageStore?: boolean } | undefined)?.canManageStore,
    ).toBe(true);

    const invalidSlugResponse = await owner.request(
      `/api/v1/auth/orgs/${encodeURIComponent(organizationSlug as string)}/stores`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Invalid Slug Room',
          slug: 'invalid_slug',
        }),
      },
    );
    expect(invalidSlugResponse.status).toBe(400);

    const updateResponse = await owner.request(
      `/api/v1/auth/orgs/${encodeURIComponent(
        organizationSlug as string,
      )}/stores/${encodeURIComponent('second-room')}`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Second Room Updated',
          slug: 'second-room-renamed',
        }),
      },
    );
    expect(updateResponse.status).toBe(200);
    const updatedStore = (await toJson(updateResponse)) as Record<string, unknown>;
    expect(updatedStore.slug).toBe('second-room-renamed');
    expect(updatedStore.name).toBe('Second Room Updated');

    const listAfterUpdateResponse = await owner.request(
      `/api/v1/auth/orgs/${encodeURIComponent(organizationSlug as string)}/stores`,
    );
    expect(listAfterUpdateResponse.status).toBe(200);
    const storesAfterUpdate = (await toJson(listAfterUpdateResponse)) as Array<
      Record<string, unknown>
    >;
    expect(storesAfterUpdate.map((store) => store.slug)).toEqual(
      expect.arrayContaining(['store-admin-org', 'second-room-renamed']),
    );

    const memberInvite = await createInvitation({
      agent: owner,
      email: 'store-member@example.com',
      role: 'member',
      organizationId,
    });
    expect(memberInvite.response.status).toBe(200);

    const member = createAuthAgent(app);
    await signUpUser({
      agent: member,
      name: 'Store Member',
      email: 'store-member@example.com',
    });
    const acceptMemberInviteResponse = await member.request(
      buildInvitationActionPath(memberInvite.payload?.id as string, 'accept'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ invitationId: memberInvite.payload?.id }),
      },
    );
    expect(acceptMemberInviteResponse.status).toBe(200);

    const memberCreateResponse = await member.request(
      `/api/v1/auth/orgs/${encodeURIComponent(organizationSlug as string)}/stores`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Forbidden Room',
          slug: 'forbidden-room',
        }),
      },
    );
    expect(memberCreateResponse.status).toBe(403);
  });

  it('店舗の通知先設定を既定値で取得し更新する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Notification Settings Owner',
      email: 'notification-settings-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Notification Settings Org',
      slug: 'notification-settings-org',
    });
    const storeId = await selectStoreIdBySlug(organizationId, 'notification-settings-org');
    expect(storeId).toBeTruthy();

    const path =
      '/api/v1/auth/orgs/notification-settings-org/stores/notification-settings-org/notification-settings';
    const defaultsResponse = await owner.request(path);
    expect(defaultsResponse.status).toBe(200);
    expect(await toJson(defaultsResponse)).toEqual({
      notifyOwner: true,
      notifyAdmins: true,
      notifyStoreManagers: true,
      notifyStaff: false,
      additionalEmails: [],
    });
    expect(await selectPublicSiteNotificationSetting(organizationId, storeId as string)).toBeNull();

    const updateResponse = await owner.request(path, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        notifyOwner: false,
        notifyAdmins: true,
        notifyStoreManagers: false,
        notifyStaff: true,
        additionalEmails: [
          ' Ops@Example.com ',
          'support@example.com',
          'ops@example.com',
          'SUPPORT@example.com',
        ],
      }),
    });
    expect(updateResponse.status).toBe(200);
    expect(await toJson(updateResponse)).toEqual({
      notifyOwner: false,
      notifyAdmins: true,
      notifyStoreManagers: false,
      notifyStaff: true,
      additionalEmails: ['ops@example.com', 'support@example.com'],
    });

    const row = await selectPublicSiteNotificationSetting(organizationId, storeId as string);
    expect(row).toMatchObject({
      notifyOwner: 0,
      notifyAdmins: 1,
      notifyStoreManagers: 0,
      notifyStaff: 1,
    });
    expect(JSON.parse(row?.additionalEmailsJson ?? '[]')).toEqual([
      'ops@example.com',
      'support@example.com',
    ]);

    const invalidEmailResponse = await owner.request(path, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        notifyOwner: true,
        notifyAdmins: true,
        notifyStoreManagers: true,
        notifyStaff: false,
        additionalEmails: ['not-an-email'],
      }),
    });
    expect(invalidEmailResponse.status).toBe(400);

    const outsider = createAuthAgent(app);
    await signUpUser({
      agent: outsider,
      name: 'Notification Settings Outsider',
      email: 'notification-settings-outsider@example.com',
    });

    const forbiddenGetResponse = await outsider.request(path);
    expect(forbiddenGetResponse.status).toBe(403);
    const forbiddenPatchResponse = await outsider.request(path, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        notifyOwner: true,
        notifyAdmins: true,
        notifyStoreManagers: true,
        notifyStaff: true,
        additionalEmails: [],
      }),
    });
    expect(forbiddenPatchResponse.status).toBe(403);
  });

  it('店舗のフォームを作成し公開して割り当てる', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Forms Owner',
      email: 'forms-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Forms Org',
      slug: 'forms-org',
    });
    const storeId = await selectStoreIdBySlug(organizationId, 'forms-org');
    expect(storeId).toBeTruthy();

    const serviceId = await insertServiceFixture({
      organizationId,
      storeId: storeId as string,
      name: 'Forms Service',
    });
    const formsPath = '/api/v1/auth/orgs/forms-org/stores/forms-org/forms';
    const defaultsResponse = await owner.request(formsPath);
    expect(defaultsResponse.status).toBe(200);
    expect(await toJson(defaultsResponse)).toEqual({ forms: [] });

    const createResponse = await owner.request(formsPath, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        formType: 'reservation_input',
        name: '体験予約フォーム',
        description: '公開予約時に確認する項目です。',
        fields: [
          {
            fieldKey: 'experience',
            label: '経験年数',
            fieldType: 'radio',
            required: true,
            options: [
              { value: 'none', label: '未経験' },
              { value: 'over_1_year', label: '1年以上' },
            ],
            description: '該当するものを選択してください。',
          },
          {
            fieldKey: 'goal',
            label: '参加目的',
            fieldType: 'text',
            required: false,
            options: [],
            placeholder: '例: 体力づくり',
          },
        ],
      }),
    });
    expect(createResponse.status).toBe(200);
    const createdForm = (await toJson(createResponse)) as Record<string, unknown>;
    expect(createdForm).toMatchObject({
      formType: 'reservation_input',
      name: '体験予約フォーム',
      description: '公開予約時に確認する項目です。',
      status: 'draft',
      fields: [
        {
          fieldKey: 'experience',
          label: '経験年数',
          fieldType: 'radio',
          required: true,
          options: [
            { value: 'none', label: '未経験' },
            { value: 'over_1_year', label: '1年以上' },
          ],
          description: '該当するものを選択してください。',
          sortOrder: 0,
        },
        {
          fieldKey: 'goal',
          label: '参加目的',
          fieldType: 'text',
          required: false,
          options: [],
          sortOrder: 1,
        },
      ],
    });
    const formId = createdForm.id as string;
    expect(formId).toBeTruthy();

    const invalidSelectResponse = await owner.request(formsPath, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        formType: 'reservation_input',
        name: '未設定の選択式フォーム',
        fields: [
          {
            fieldKey: 'invalid_select',
            label: '未設定の選択式',
            fieldType: 'select',
            required: true,
            options: [],
          },
        ],
      }),
    });
    expect(invalidSelectResponse.status).toBe(400);

    const publishResponse = await owner.request(
      `${formsPath}/${encodeURIComponent(formId)}/publish`,
      {
        method: 'POST',
      },
    );
    expect(publishResponse.status).toBe(200);
    const publishedForm = (await toJson(publishResponse)) as Record<string, unknown>;
    expect(publishedForm).toMatchObject({
      status: 'published',
      currentPublishedVersion: {
        versionNumber: 1,
      },
    });

    const assignmentResponse = await owner.request(
      `${formsPath}/${encodeURIComponent(formId)}/assignments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetType: 'store',
          targetId: storeId,
        }),
      },
    );
    expect(assignmentResponse.status).toBe(200);
    const assignmentPayload = (await toJson(assignmentResponse)) as {
      assignments?: Array<Record<string, unknown>>;
    };
    expect(assignmentPayload.assignments).toEqual([
      expect.objectContaining({
        formTemplateId: formId,
        formType: 'reservation_input',
        targetType: 'store',
        targetId: storeId,
      }),
    ]);
    const assignmentId = assignmentPayload.assignments?.[0]?.id as string;

    const duplicateAssignmentResponse = await owner.request(
      `${formsPath}/${encodeURIComponent(formId)}/assignments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetType: 'store',
          targetId: storeId,
        }),
      },
    );
    expect(duplicateAssignmentResponse.status).toBe(409);

    const invalidAssignmentTargetResponse = await owner.request(
      `${formsPath}/${encodeURIComponent(formId)}/assignments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetType: 'service',
          targetId: 'missing-service',
        }),
      },
    );
    expect(invalidAssignmentTargetResponse.status).toBe(400);

    const requiredFormsResponse = await owner.request(
      `${formsPath}/required?serviceId=${encodeURIComponent(serviceId)}`,
    );
    expect(requiredFormsResponse.status).toBe(200);
    const requiredFormsPayload = (await toJson(requiredFormsResponse)) as Record<string, unknown>;
    expect(requiredFormsPayload.formContextHash).toEqual(expect.stringMatching(/^ctx_/));
    expect(requiredFormsPayload.forms).toEqual([
      expect.objectContaining({
        formTemplateId: formId,
        formType: 'reservation_input',
        name: '体験予約フォーム',
        versionNumber: 1,
      }),
    ]);

    const deleteAssignmentResponse = await owner.request(
      `${formsPath}/${encodeURIComponent(formId)}/assignments/${encodeURIComponent(assignmentId)}`,
      {
        method: 'DELETE',
      },
    );
    expect(deleteAssignmentResponse.status).toBe(200);
    expect(await toJson(deleteAssignmentResponse)).toEqual({ assignments: [] });

    const archiveResponse = await owner.request(
      `${formsPath}/${encodeURIComponent(formId)}/archive`,
      {
        method: 'POST',
      },
    );
    expect(archiveResponse.status).toBe(200);
    expect(await toJson(archiveResponse)).toMatchObject({
      id: formId,
      status: 'archived',
      assignments: [],
    });

    const outsider = createAuthAgent(app);
    await signUpUser({
      agent: outsider,
      name: 'Forms Outsider',
      email: 'forms-outsider@example.com',
    });
    expect((await outsider.request(formsPath)).status).toBe(403);
  });

  it('店舗のリマインド設定を既定値で取得し更新する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Reminder Settings Owner',
      email: 'reminder-settings-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Reminder Settings Org',
      slug: 'reminder-settings-org',
    });
    const storeId = await selectStoreIdBySlug(organizationId, 'reminder-settings-org');
    expect(storeId).toBeTruthy();
    const serviceId = await insertServiceFixture({
      organizationId,
      storeId: storeId as string,
      name: 'Reminder Settings Service',
    });

    const path =
      '/api/v1/auth/orgs/reminder-settings-org/stores/reminder-settings-org/reminder-settings';
    const defaultsResponse = await owner.request(path);
    expect(defaultsResponse.status).toBe(200);
    expect(await toJson(defaultsResponse)).toEqual({
      enabled: true,
      timingsMinutes: [1440],
      serviceOverrides: [
        {
          serviceId,
          serviceName: 'Reminder Settings Service',
          enabled: true,
          timingsMinutes: [1440],
          inheritsStoreDefault: true,
        },
      ],
    });
    expect(await selectReminderPolicyRows(organizationId, storeId as string)).toEqual([]);

    const updateResponse = await owner.request(path, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enabled: false,
        timingsMinutes: [180, 1440],
        serviceOverrides: [
          {
            serviceId,
            enabled: true,
            timingsMinutes: [180],
            inheritsStoreDefault: false,
          },
        ],
      }),
    });
    expect(updateResponse.status).toBe(200);
    expect(await toJson(updateResponse)).toEqual({
      enabled: false,
      timingsMinutes: [1440, 180],
      serviceOverrides: [
        {
          serviceId,
          serviceName: 'Reminder Settings Service',
          enabled: true,
          timingsMinutes: [180],
          inheritsStoreDefault: false,
        },
      ],
    });
    const reminderPolicyRows = await selectReminderPolicyRows(organizationId, storeId as string);
    expect(reminderPolicyRows).toHaveLength(3);
    expect(reminderPolicyRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enabled: 0,
          minutesBefore: 1440,
          serviceId: null,
        }),
        expect.objectContaining({
          enabled: 0,
          minutesBefore: 180,
          serviceId: null,
        }),
        expect.objectContaining({
          enabled: 1,
          minutesBefore: 180,
          serviceId,
        }),
      ]),
    );

    const inheritResponse = await owner.request(path, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enabled: true,
        timingsMinutes: [1440],
        serviceOverrides: [
          {
            serviceId,
            enabled: true,
            timingsMinutes: [180],
            inheritsStoreDefault: true,
          },
        ],
      }),
    });
    expect(inheritResponse.status).toBe(200);
    expect(await selectReminderPolicyRows(organizationId, storeId as string)).toEqual([
      expect.objectContaining({
        enabled: 1,
        minutesBefore: 1440,
        serviceId: null,
      }),
    ]);

    for (const timingsMinutes of [[], [180, 180], [60]]) {
      const invalidResponse = await owner.request(path, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          enabled: true,
          timingsMinutes,
        }),
      });
      expect(invalidResponse.status).toBe(400);
    }

    const invalidServiceResponse = await owner.request(path, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enabled: true,
        timingsMinutes: [1440],
        serviceOverrides: [
          {
            serviceId: crypto.randomUUID(),
            enabled: true,
            timingsMinutes: [1440],
            inheritsStoreDefault: false,
          },
        ],
      }),
    });
    expect(invalidServiceResponse.status).toBe(400);

    const outsider = createAuthAgent(app);
    await signUpUser({
      agent: outsider,
      name: 'Reminder Settings Outsider',
      email: 'reminder-settings-outsider@example.com',
    });

    const forbiddenGetResponse = await outsider.request(path);
    expect(forbiddenGetResponse.status).toBe(403);
    const forbiddenPatchResponse = await outsider.request(path, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enabled: true,
        timingsMinutes: [1440],
      }),
    });
    expect(forbiddenPatchResponse.status).toBe(403);
  });

  it('予約リマインド送信は店舗設定の3時間前だけを対象にする', async () => {
    const authRuntimeWithEmail = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        RESEND_API_KEY: 'test-resend-api-key',
        RESEND_FROM_EMAIL: 'no-reply@example.com',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithEmail = createApp(authRuntimeWithEmail);

    const resendRequests: Array<{ to: string[]; subject: string }> = [];
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === 'https://api.resend.com/emails') {
        const payloadText =
          typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '{}';
        const payload = JSON.parse(payloadText) as { to?: unknown; subject?: unknown };
        const to = Array.isArray(payload.to)
          ? payload.to.filter((value): value is string => typeof value === 'string')
          : [];
        const subject = typeof payload.subject === 'string' ? payload.subject : '';
        resendRequests.push({ to, subject });

        return new Response(JSON.stringify({ id: crypto.randomUUID() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithEmail);
      await signUpUser({
        agent: owner,
        name: 'Reminder Three Hour Owner',
        email: 'reminder-three-hour-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Reminder Three Hour Org',
        slug: 'reminder-three-hour-org',
      });
      const storeId = await selectStoreIdBySlug(organizationId, 'reminder-three-hour-org');
      expect(storeId).toBeTruthy();

      const updateResponse = await owner.request(
        '/api/v1/auth/orgs/reminder-three-hour-org/stores/reminder-three-hour-org/reminder-settings',
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            enabled: true,
            timingsMinutes: [180],
          }),
        },
      );
      expect(updateResponse.status).toBe(200);

      const baseNow = new Date('2026-06-01T00:00:00.000Z');
      const startAt = new Date(baseNow.getTime() + 4 * 60 * 60 * 1000);
      const { bookingId } = await insertReminderBookingFixture({
        organizationId,
        storeId: storeId as string,
        startAt,
        customerEmail: 'three-hour-reminder@example.com',
      });

      await sendDueBookingReminders({
        database: drizzle(d1),
        env: authRuntimeWithEmail.env,
        now: baseNow,
      });
      expect(resendRequests).toHaveLength(0);
      expect(await selectReminderLogRowsByBooking(bookingId)).toEqual([]);

      const dueNow = new Date(startAt.getTime() - 150 * 60 * 1000);
      await sendDueBookingReminders({
        database: drizzle(d1),
        env: authRuntimeWithEmail.env,
        now: dueNow,
      });
      expect(resendRequests).toHaveLength(1);
      expect(resendRequests[0]).toMatchObject({
        to: ['three-hour-reminder@example.com'],
        subject: '【予約通知】予約リマインド',
      });
      expect(await selectReminderLogRowsByBooking(bookingId)).toEqual([
        expect.objectContaining({
          reminderPolicyId: expect.any(String),
          dedupeKey: `booking-reminder:${bookingId}:180:three-hour-reminder@example.com`,
          recipientEmail: 'three-hour-reminder@example.com',
          status: 'sent',
        }),
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('予約リマインド送信はサービス別設定を店舗設定より優先する', async () => {
    const authRuntimeWithEmail = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        RESEND_API_KEY: 'test-resend-api-key',
        RESEND_FROM_EMAIL: 'no-reply@example.com',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithEmail = createApp(authRuntimeWithEmail);

    const resendRequests: Array<{ to: string[]; subject: string }> = [];
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === 'https://api.resend.com/emails') {
        const payloadText =
          typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '{}';
        const payload = JSON.parse(payloadText) as { to?: unknown; subject?: unknown };
        const to = Array.isArray(payload.to)
          ? payload.to.filter((value): value is string => typeof value === 'string')
          : [];
        const subject = typeof payload.subject === 'string' ? payload.subject : '';
        resendRequests.push({ to, subject });

        return new Response(JSON.stringify({ id: crypto.randomUUID() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithEmail);
      await signUpUser({
        agent: owner,
        name: 'Reminder Service Override Owner',
        email: 'reminder-service-override-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Reminder Service Override Org',
        slug: 'reminder-service-override-org',
      });
      const storeId = await selectStoreIdBySlug(organizationId, 'reminder-service-override-org');
      expect(storeId).toBeTruthy();

      const baseNow = new Date('2026-06-03T00:00:00.000Z');
      const startAt = new Date(baseNow.getTime() + 4 * 60 * 60 * 1000);
      const { bookingId, serviceId } = await insertReminderBookingFixture({
        organizationId,
        storeId: storeId as string,
        startAt,
        customerEmail: 'service-override-reminder@example.com',
      });

      const updateResponse = await owner.request(
        '/api/v1/auth/orgs/reminder-service-override-org/stores/reminder-service-override-org/reminder-settings',
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            enabled: true,
            timingsMinutes: [1440],
            serviceOverrides: [
              {
                serviceId,
                enabled: true,
                timingsMinutes: [180],
                inheritsStoreDefault: false,
              },
            ],
          }),
        },
      );
      expect(updateResponse.status).toBe(200);

      await sendDueBookingReminders({
        database: drizzle(d1),
        env: authRuntimeWithEmail.env,
        now: baseNow,
      });
      expect(resendRequests).toHaveLength(0);
      expect(await selectReminderLogRowsByBooking(bookingId)).toEqual([]);

      const dueNow = new Date(startAt.getTime() - 150 * 60 * 1000);
      await sendDueBookingReminders({
        database: drizzle(d1),
        env: authRuntimeWithEmail.env,
        now: dueNow,
      });
      expect(resendRequests).toHaveLength(1);
      expect(resendRequests[0]).toMatchObject({
        to: ['service-override-reminder@example.com'],
        subject: '【予約通知】予約リマインド',
      });
      expect(await selectReminderLogRowsByBooking(bookingId)).toEqual([
        expect.objectContaining({
          reminderPolicyId: expect.any(String),
          dedupeKey: `booking-reminder:${bookingId}:180:service-override-reminder@example.com`,
          recipientEmail: 'service-override-reminder@example.com',
          status: 'sent',
        }),
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('予約リマインド送信は無効設定を除外し同時 due では近い timing だけ送る', async () => {
    const authRuntimeWithEmail = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        RESEND_API_KEY: 'test-resend-api-key',
        RESEND_FROM_EMAIL: 'no-reply@example.com',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithEmail = createApp(authRuntimeWithEmail);

    const resendRequests: Array<{ to: string[]; subject: string }> = [];
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === 'https://api.resend.com/emails') {
        const payloadText =
          typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '{}';
        const payload = JSON.parse(payloadText) as { to?: unknown; subject?: unknown };
        const to = Array.isArray(payload.to)
          ? payload.to.filter((value): value is string => typeof value === 'string')
          : [];
        const subject = typeof payload.subject === 'string' ? payload.subject : '';
        resendRequests.push({ to, subject });

        return new Response(JSON.stringify({ id: crypto.randomUUID() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithEmail);
      await signUpUser({
        agent: owner,
        name: 'Reminder Disabled Owner',
        email: 'reminder-disabled-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Reminder Disabled Org',
        slug: 'reminder-disabled-org',
      });
      const storeId = await selectStoreIdBySlug(organizationId, 'reminder-disabled-org');
      expect(storeId).toBeTruthy();

      const settingsPath =
        '/api/v1/auth/orgs/reminder-disabled-org/stores/reminder-disabled-org/reminder-settings';
      const disableResponse = await owner.request(settingsPath, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: false,
          timingsMinutes: [1440, 180],
        }),
      });
      expect(disableResponse.status).toBe(200);

      const baseNow = new Date('2026-06-02T00:00:00.000Z');
      const disabledStartAt = new Date(baseNow.getTime() + 2 * 60 * 60 * 1000);
      const disabledBooking = await insertReminderBookingFixture({
        organizationId,
        storeId: storeId as string,
        startAt: disabledStartAt,
        customerEmail: 'disabled-reminder@example.com',
      });
      await sendDueBookingReminders({
        database: drizzle(d1),
        env: authRuntimeWithEmail.env,
        now: baseNow,
      });
      expect(resendRequests).toHaveLength(0);
      expect(await selectReminderLogRowsByBooking(disabledBooking.bookingId)).toEqual([]);

      const enableResponse = await owner.request(settingsPath, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          timingsMinutes: [1440, 180],
        }),
      });
      expect(enableResponse.status).toBe(200);

      const simultaneousStartAt = new Date(baseNow.getTime() + 2 * 60 * 60 * 1000);
      const simultaneousBooking = await insertReminderBookingFixture({
        organizationId,
        storeId: storeId as string,
        startAt: simultaneousStartAt,
        customerEmail: 'closest-reminder@example.com',
      });
      await sendDueBookingReminders({
        database: drizzle(d1),
        env: authRuntimeWithEmail.env,
        now: baseNow,
      });

      expect(resendRequests).toHaveLength(2);
      expect(await selectReminderLogRowsByBooking(simultaneousBooking.bookingId)).toEqual([
        expect.objectContaining({
          reminderPolicyId: expect.any(String),
          dedupeKey: `booking-reminder:${simultaneousBooking.bookingId}:180:closest-reminder@example.com`,
          recipientEmail: 'closest-reminder@example.com',
          status: 'sent',
        }),
      ]);
      expect(
        (await selectReminderLogRowsByBooking(simultaneousBooking.bookingId)).some((row) =>
          row.dedupeKey.includes(':1440:'),
        ),
      ).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('無料組織のプレミアム限定バックエンド操作を共通エンタイトルメントペイロードで拒否する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Premium Gate Free Owner',
      email: 'premium-gate-free-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Premium Gate Free Org',
      slug: 'premium-gate-free-org',
    });
    const organizationSlug = await selectOrganizationSlugById(organizationId);
    expect(organizationSlug).toBe('premium-gate-free-org');

    const expectPremiumDenied = async (response: Response) => {
      const payload = (await toJson(response)) as Record<string, unknown>;
      expect(response.status).toBe(403);
      expect(payload).toMatchObject({
        message: 'Organization premium plan is required for this feature.',
        code: 'organization_premium_required',
        source: 'application_billing_state',
        reason: 'organization_plan_is_free',
        entitlementState: 'free_only',
        planState: 'free',
        trialEndsAt: null,
      });
    };

    const baseServiceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        name: 'Free Instant Service',
        kind: 'single',
        durationMinutes: 45,
        capacity: 4,
        bookingPolicy: 'instant',
      }),
    });
    expect(baseServiceResponse.status).toBe(200);
    const baseServicePayload = (await toJson(baseServiceResponse)) as Record<string, unknown>;
    const baseServiceId = baseServicePayload.id as string;

    const storeCreateResponse = await owner.request(
      `/api/v1/auth/orgs/${encodeURIComponent(organizationSlug as string)}/stores`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Premium Room',
          slug: 'premium-room',
        }),
      },
    );
    await expectPremiumDenied(storeCreateResponse);

    const orgInvitationResponse = await owner.request(
      buildOrgInvitationPath(organizationSlug as string),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email: 'free-org-admin@example.com',
          role: 'admin',
        }),
      },
    );
    await expectPremiumDenied(orgInvitationResponse);

    const storeInvitationResponse = await owner.request(
      buildStoreInvitationPath(organizationSlug as string, organizationSlug as string),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email: 'free-store-manager@example.com',
          role: 'manager',
        }),
      },
    );
    await expectPremiumDenied(storeInvitationResponse);

    const approvalServiceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        name: 'Premium Approval Service',
        kind: 'single',
        durationMinutes: 60,
        capacity: 4,
        bookingPolicy: 'approval',
      }),
    });
    await expectPremiumDenied(approvalServiceResponse);

    const now = new Date();
    const weekday = ((now.getUTCDay() + 6) % 7) + 1;
    const startDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const startDateStr = `${startDate.getUTCFullYear()}-${String(
      startDate.getUTCMonth() + 1,
    ).padStart(2, '0')}-${String(startDate.getUTCDate()).padStart(2, '0')}`;

    const recurringCreateResponse = await owner.request(
      '/api/v1/auth/organizations/recurring-schedules',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          organizationId,
          serviceId: baseServiceId,
          timezone: 'Asia/Tokyo',
          frequency: 'weekly',
          interval: 1,
          byWeekday: [weekday],
          startDate: startDateStr,
          startTimeLocal: '10:00',
        }),
      },
    );
    await expectPremiumDenied(recurringCreateResponse);

    const ticketTypeCreateResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-types',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          organizationId,
          name: 'Premium Ticket Pack',
          totalCount: 3,
          serviceIds: [baseServiceId],
        }),
      },
    );
    await expectPremiumDenied(ticketTypeCreateResponse);
  });

  it('ロール別拒否を維持しつつ非オーナーの運用ロールにプレミアム操作を許可する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Premium Roles Owner',
      email: 'premium-roles-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Premium Roles Org',
      slug: 'premium-roles-org',
    });
    await enablePremiumForOrganization(organizationId);

    const adminInvite = await createInvitation({
      agent: owner,
      email: 'premium-roles-admin@example.com',
      role: 'admin',
      organizationId,
    });
    expect(adminInvite.response.status).toBe(200);

    const memberInvite = await createInvitation({
      agent: owner,
      email: 'premium-roles-member@example.com',
      role: 'member',
      organizationId,
    });
    expect(memberInvite.response.status).toBe(200);

    const managerInvite = await createStoreOperatorInvitation({
      agent: owner,
      email: 'premium-roles-manager@example.com',
      role: 'manager',
      organizationId,
    });
    expect(managerInvite.response.status).toBe(200);

    const admin = createAuthAgent(app);
    await signUpUser({
      agent: admin,
      name: 'Premium Roles Admin',
      email: 'premium-roles-admin@example.com',
    });
    expect(
      await acceptInvitation({ agent: admin, invitationId: adminInvite.payload?.id as string }),
    ).toHaveProperty('status', 200);

    const member = createAuthAgent(app);
    await signUpUser({
      agent: member,
      name: 'Premium Roles Member',
      email: 'premium-roles-member@example.com',
    });
    expect(
      await acceptInvitation({ agent: member, invitationId: memberInvite.payload?.id as string }),
    ).toHaveProperty('status', 200);

    const manager = createAuthAgent(app);
    await signUpUser({
      agent: manager,
      name: 'Premium Roles Manager',
      email: 'premium-roles-manager@example.com',
    });
    expect(
      await acceptInvitation({ agent: manager, invitationId: managerInvite.payload?.id as string }),
    ).toHaveProperty('status', 200);

    const organizationSlug = await selectOrganizationSlugById(organizationId);
    const defaultStoreId = await selectStoreIdBySlug(organizationId, organizationSlug as string);
    expect(defaultStoreId).toBeTruthy();

    const adminCreateStoreResponse = await admin.request(
      `/api/v1/auth/orgs/${encodeURIComponent(organizationSlug as string)}/stores`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Admin Managed Room',
          slug: 'admin-managed-room',
        }),
      },
    );
    expect(adminCreateStoreResponse.status).toBe(200);

    const serviceCreateResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        storeId: defaultStoreId,
        name: 'Manager Recurring Service',
        kind: 'recurring',
        durationMinutes: 60,
        capacity: 8,
      }),
    });
    expect(serviceCreateResponse.status).toBe(200);
    const servicePayload = (await toJson(serviceCreateResponse)) as Record<string, unknown>;
    const serviceId = servicePayload.id as string;

    const now = new Date();
    const weekday = ((now.getUTCDay() + 6) % 7) + 1;
    const startDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const startDateStr = `${startDate.getUTCFullYear()}-${String(
      startDate.getUTCMonth() + 1,
    ).padStart(2, '0')}-${String(startDate.getUTCDate()).padStart(2, '0')}`;

    const managerRecurringResponse = await manager.request(
      '/api/v1/auth/organizations/recurring-schedules',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          organizationId,
          storeId: defaultStoreId,
          serviceId,
          timezone: 'Asia/Tokyo',
          frequency: 'weekly',
          interval: 1,
          byWeekday: [weekday],
          startDate: startDateStr,
          startTimeLocal: '11:00',
        }),
      },
    );
    expect(managerRecurringResponse.status).toBe(200);

    const memberCreateStoreResponse = await member.request(
      `/api/v1/auth/orgs/${encodeURIComponent(organizationSlug as string)}/stores`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Forbidden Premium Room',
          slug: 'forbidden-premium-room',
        }),
      },
    );
    expect(memberCreateStoreResponse.status).toBe(403);
    expect(await toJson(memberCreateStoreResponse)).toEqual({ message: 'Forbidden' });
  });

  it('残りの招待・参加者管理画面にもプレミアム制限の対象範囲を広げる', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Premium Coverage Owner',
      email: 'premium-coverage-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Premium Coverage Org',
      slug: 'premium-coverage-org',
    });
    await enablePremiumForOrganization(organizationId);

    const organizationSlug = await selectOrganizationSlugById(organizationId);
    expect(organizationSlug).toBe('premium-coverage-org');

    const managerInvite = await createStoreOperatorInvitation({
      agent: owner,
      email: 'premium-coverage-manager@example.com',
      role: 'manager',
      organizationId,
    });
    expect(managerInvite.response.status).toBe(200);

    const participantInvite = await createParticipantInvitation({
      agent: owner,
      email: 'premium-coverage-participant@example.com',
      participantName: 'Premium Coverage Participant',
      organizationId,
    });
    expect(participantInvite.response.status).toBe(200);

    const participantUser = createAuthAgent(app);
    await signUpUser({
      agent: participantUser,
      name: 'Premium Coverage Participant',
      email: 'premium-coverage-participant@example.com',
    });
    expect(
      await acceptInvitation({
        agent: participantUser,
        invitationId: participantInvite.payload?.id as string,
      }),
    ).toHaveProperty('status', 200);

    await setOrganizationBillingState({
      organizationId,
      planCode: 'free',
      subscriptionStatus: 'free',
      billingInterval: null,
      currentPeriodEnd: null,
    });

    const expectPremiumDenied = async (response: Response) => {
      const payload = (await toJson(response)) as Record<string, unknown>;
      expect(response.status).toBe(403);
      expect(payload).toMatchObject({
        message: 'Organization premium plan is required for this feature.',
        code: 'organization_premium_required',
        source: 'application_billing_state',
        reason: 'organization_plan_is_free',
        entitlementState: 'free_only',
        planState: 'free',
        trialEndsAt: null,
      });
    };

    const orgInvitationListResponse = await owner.request(
      buildOrgInvitationPath(organizationSlug as string),
    );
    await expectPremiumDenied(orgInvitationListResponse);

    const storeInvitationListResponse = await owner.request(
      buildStoreInvitationPath(organizationSlug as string, organizationSlug as string),
    );
    await expectPremiumDenied(storeInvitationListResponse);

    const participantInvitationResponse = await createParticipantInvitation({
      agent: owner,
      email: 'premium-coverage-participant-2@example.com',
      participantName: 'Premium Coverage Participant 2',
      organizationId,
    });
    expect(participantInvitationResponse.response.status).toBe(403);
    expect(participantInvitationResponse.payload).toMatchObject({
      message: 'Organization premium plan is required for this feature.',
      code: 'organization_premium_required',
      source: 'application_billing_state',
      reason: 'organization_plan_is_free',
      entitlementState: 'free_only',
      planState: 'free',
      trialEndsAt: null,
    });

    const participantListResponse = await owner.request(
      `/api/v1/auth/organizations/participants?organizationId=${encodeURIComponent(organizationId)}`,
    );
    await expectPremiumDenied(participantListResponse);

    const managerUser = createAuthAgent(app);
    await signUpUser({
      agent: managerUser,
      name: 'Premium Coverage Manager',
      email: 'premium-coverage-manager@example.com',
    });
    const acceptManagerInviteResponse = await acceptInvitation({
      agent: managerUser,
      invitationId: managerInvite.payload?.id as string,
    });
    await expectPremiumDenied(acceptManagerInviteResponse);
  }, 120_000);

  it('エンタイトルメント喪失と復旧をまたいでプレミアム運用データを保持する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Premium Recovery Owner',
      email: 'premium-recovery-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Premium Recovery Org',
      slug: 'premium-recovery-org',
    });
    await enablePremiumForOrganization(organizationId);

    const organizationSlug = await selectOrganizationSlugById(organizationId);
    const defaultStoreId = await selectStoreIdBySlug(organizationId, organizationSlug as string);
    expect(defaultStoreId).toBeTruthy();

    const secondStoreResponse = await owner.request(
      `/api/v1/auth/orgs/${encodeURIComponent(organizationSlug as string)}/stores`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Premium Recovery Room',
          slug: 'premium-recovery-room',
        }),
      },
    );
    expect(secondStoreResponse.status).toBe(200);

    const approvalServiceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        storeId: defaultStoreId,
        name: 'Recovery Approval Service',
        kind: 'single',
        durationMinutes: 60,
        capacity: 4,
        bookingPolicy: 'approval',
        requiresTicket: true,
      }),
    });
    expect(approvalServiceResponse.status).toBe(200);
    const approvalServicePayload = (await toJson(approvalServiceResponse)) as Record<
      string,
      unknown
    >;
    const approvalServiceId = approvalServicePayload.id as string;

    const recurringServiceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        storeId: defaultStoreId,
        name: 'Recovery Recurring Service',
        kind: 'recurring',
        durationMinutes: 45,
        capacity: 6,
      }),
    });
    expect(recurringServiceResponse.status).toBe(200);
    const recurringServicePayload = (await toJson(recurringServiceResponse)) as Record<
      string,
      unknown
    >;
    const recurringServiceId = recurringServicePayload.id as string;

    const ticketTypeCreateResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-types',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          organizationId,
          storeId: defaultStoreId,
          name: 'Recovery Tickets',
          totalCount: 5,
          serviceIds: [approvalServiceId],
        }),
      },
    );
    expect(ticketTypeCreateResponse.status).toBe(200);
    const ticketTypePayload = (await toJson(ticketTypeCreateResponse)) as Record<string, unknown>;
    const ticketTypeId = ticketTypePayload.id as string;

    const now = new Date();
    const weekday = ((now.getUTCDay() + 6) % 7) + 1;
    const startDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const startDateStr = `${startDate.getUTCFullYear()}-${String(
      startDate.getUTCMonth() + 1,
    ).padStart(2, '0')}-${String(startDate.getUTCDate()).padStart(2, '0')}`;

    const recurringCreateResponse = await owner.request(
      '/api/v1/auth/organizations/recurring-schedules',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          organizationId,
          storeId: defaultStoreId,
          serviceId: recurringServiceId,
          timezone: 'Asia/Tokyo',
          frequency: 'weekly',
          interval: 1,
          byWeekday: [weekday],
          startDate: startDateStr,
          startTimeLocal: '09:00',
        }),
      },
    );
    expect(recurringCreateResponse.status).toBe(200);
    const recurringPayload = (await toJson(recurringCreateResponse)) as Record<string, unknown>;
    const recurringScheduleId = recurringPayload.id as string;

    const countsBeforeDowngrade = await selectOrganizationOperationalRowCounts(organizationId);
    const recurringCountBeforeDowngrade = await d1
      .prepare('SELECT COUNT(*) as count FROM recurring_schedule WHERE organization_id = ?')
      .bind(organizationId)
      .first<{ count: number | string }>();
    const ticketTypeCountBeforeDowngrade = await d1
      .prepare('SELECT COUNT(*) as count FROM ticket_type WHERE organization_id = ?')
      .bind(organizationId)
      .first<{ count: number | string }>();

    await setOrganizationBillingState({
      organizationId,
      planCode: 'free',
      subscriptionStatus: 'free',
      billingInterval: null,
      currentPeriodEnd: null,
    });

    const deniedStoreResponse = await owner.request(
      `/api/v1/auth/orgs/${encodeURIComponent(organizationSlug as string)}/stores`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Denied Recovery Room',
          slug: 'denied-recovery-room',
        }),
      },
    );
    expect(deniedStoreResponse.status).toBe(403);
    expect(await toJson(deniedStoreResponse)).toMatchObject({
      code: 'organization_premium_required',
      reason: 'organization_plan_is_free',
    });

    const countsAfterDowngrade = await selectOrganizationOperationalRowCounts(organizationId);
    const recurringCountAfterDowngrade = await d1
      .prepare('SELECT COUNT(*) as count FROM recurring_schedule WHERE organization_id = ?')
      .bind(organizationId)
      .first<{ count: number | string }>();
    const ticketTypeCountAfterDowngrade = await d1
      .prepare('SELECT COUNT(*) as count FROM ticket_type WHERE organization_id = ?')
      .bind(organizationId)
      .first<{ count: number | string }>();
    const approvalServiceRow = await d1
      .prepare(
        'SELECT booking_policy as bookingPolicy, requires_ticket as requiresTicket FROM service WHERE id = ? LIMIT 1',
      )
      .bind(approvalServiceId)
      .first<{ bookingPolicy: string; requiresTicket: number | boolean }>();

    expect(countsAfterDowngrade).toEqual(countsBeforeDowngrade);
    expect(Number(recurringCountAfterDowngrade?.count ?? 0)).toBe(
      Number(recurringCountBeforeDowngrade?.count ?? 0),
    );
    expect(Number(ticketTypeCountAfterDowngrade?.count ?? 0)).toBe(
      Number(ticketTypeCountBeforeDowngrade?.count ?? 0),
    );
    expect(approvalServiceRow).toEqual({
      bookingPolicy: 'approval',
      requiresTicket: 1,
    });
    expect(ticketTypeId).toBeTruthy();
    expect(recurringScheduleId).toBeTruthy();

    await enablePremiumForOrganization(organizationId);

    const generateRecurringResponse = await owner.request(
      '/api/v1/auth/organizations/recurring-schedules/generate',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          recurringScheduleId,
        }),
      },
    );
    expect(generateRecurringResponse.status).toBe(200);

    const restoredStoreResponse = await owner.request(
      `/api/v1/auth/orgs/${encodeURIComponent(organizationSlug as string)}/stores`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Restored Recovery Room',
          slug: 'restored-recovery-room',
        }),
      },
    );
    expect(restoredStoreResponse.status).toBe(200);
  });

  it('参加者招待フローと権限を処理する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Owner',
      email: 'participant-owner@example.com',
    });

    const organizationId = await createOrganization({
      agent: owner,
      name: 'Participant Org',
      slug: 'participant-org',
    });
    await enablePremiumForOrganization(organizationId);

    const adminInvite = await createInvitation({
      agent: owner,
      email: 'participant-admin@example.com',
      role: 'admin',
      organizationId,
    });
    expect(adminInvite.response.status).toBe(200);
    const adminInvitationId = adminInvite.payload?.id as string;

    const memberInvite = await createInvitation({
      agent: owner,
      email: 'participant-member@example.com',
      role: 'member',
      organizationId,
    });
    expect(memberInvite.response.status).toBe(200);
    const memberInvitationId = memberInvite.payload?.id as string;

    const admin = createAuthAgent(app);
    await signUpUser({
      agent: admin,
      name: 'Participant Admin',
      email: 'participant-admin@example.com',
    });
    const acceptAdminInviteResponse = await admin.request(
      buildInvitationActionPath(adminInvitationId, 'accept'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: adminInvitationId,
        }),
      },
    );
    expect(acceptAdminInviteResponse.status).toBe(200);

    const member = createAuthAgent(app);
    await signUpUser({
      agent: member,
      name: 'Participant Member',
      email: 'participant-member@example.com',
    });
    const acceptMemberInviteResponse = await member.request(
      buildInvitationActionPath(memberInvitationId, 'accept'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: memberInvitationId,
        }),
      },
    );
    expect(acceptMemberInviteResponse.status).toBe(200);

    const staffCreate = await createParticipantInvitation({
      agent: member,
      email: 'participant-staff-created@example.com',
      participantName: 'Staff Created Participant',
      organizationId,
    });
    expect(staffCreate.response.status).toBe(403);

    const created = await createParticipantInvitation({
      agent: admin,
      email: 'participant-user@example.com',
      participantName: 'Participant User',
      organizationId,
    });
    expect(created.response.status).toBe(200);
    expect(typeof created.payload?.id).toBe('string');
    const participantInvitationId = created.payload?.id as string;
    expect(await selectParticipantInvitationActionCount(participantInvitationId, 'created')).toBe(
      1,
    );

    const duplicate = await createParticipantInvitation({
      agent: admin,
      email: 'participant-user@example.com',
      participantName: 'Participant User',
      organizationId,
    });
    expect(duplicate.response.status).toBe(409);

    for (let index = 0; index < 3; index += 1) {
      const resent = await createParticipantInvitation({
        agent: admin,
        email: 'participant-user@example.com',
        participantName: 'Participant User',
        organizationId,
        resend: true,
      });
      expect(resent.response.status).toBe(200);
    }

    const resendLimit = await createParticipantInvitation({
      agent: admin,
      email: 'participant-user@example.com',
      participantName: 'Participant User',
      organizationId,
      resend: true,
    });
    expect(resendLimit.response.status).toBe(429);
    expect(await selectParticipantInvitationActionCount(participantInvitationId, 'resent')).toBe(3);

    const otherUser = createAuthAgent(app);
    await signUpUser({
      agent: otherUser,
      name: 'Other User',
      email: 'participant-other@example.com',
    });

    const forbiddenDetail = await otherUser.request(
      buildInvitationDetailPath(participantInvitationId),
    );
    expect(forbiddenDetail.status).toBe(403);

    const forbiddenAccept = await otherUser.request(
      buildInvitationActionPath(participantInvitationId, 'accept'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: participantInvitationId,
        }),
      },
    );
    expect(forbiddenAccept.status).toBe(403);

    const forbiddenReject = await otherUser.request(
      buildInvitationActionPath(participantInvitationId, 'reject'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: participantInvitationId,
        }),
      },
    );
    expect(forbiddenReject.status).toBe(403);

    const participantUser = createAuthAgent(app);
    await signUpUser({
      agent: participantUser,
      name: 'Participant User',
      email: 'participant-user@example.com',
    });

    const detailResponse = await participantUser.request(
      buildInvitationDetailPath(participantInvitationId),
    );
    expect(detailResponse.status).toBe(200);

    const acceptResponse = await participantUser.request(
      buildInvitationActionPath(participantInvitationId, 'accept'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: participantInvitationId,
        }),
      },
    );
    expect(acceptResponse.status).toBe(200);
    expect(await selectParticipantInvitationStatus(participantInvitationId)).toBe('accepted');
    expect(await selectParticipantInvitationActionCount(participantInvitationId, 'accepted')).toBe(
      1,
    );
    expect(
      await selectParticipantCountByEmail(organizationId, 'participant-user@example.com'),
    ).toBe(1);

    const rejectTarget = await createParticipantInvitation({
      agent: admin,
      email: 'participant-reject@example.com',
      participantName: 'Participant Reject',
      organizationId,
    });
    expect(rejectTarget.response.status).toBe(200);
    const rejectInvitationId = rejectTarget.payload?.id as string;

    const rejectUser = createAuthAgent(app);
    await signUpUser({
      agent: rejectUser,
      name: 'Reject User',
      email: 'participant-reject@example.com',
    });

    const rejectResponse = await rejectUser.request(
      buildInvitationActionPath(rejectInvitationId, 'reject'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: rejectInvitationId,
        }),
      },
    );
    expect(rejectResponse.status).toBe(200);
    expect(await selectParticipantInvitationStatus(rejectInvitationId)).toBe('rejected');
    expect(await selectParticipantInvitationActionCount(rejectInvitationId, 'rejected')).toBe(1);

    const cancelTarget = await createParticipantInvitation({
      agent: admin,
      email: 'participant-cancel@example.com',
      participantName: 'Participant Cancel',
      organizationId,
    });
    expect(cancelTarget.response.status).toBe(200);
    const cancelInvitationId = cancelTarget.payload?.id as string;

    const cancelResponse = await admin.request(
      buildInvitationActionPath(cancelInvitationId, 'cancel'),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          invitationId: cancelInvitationId,
        }),
      },
    );
    expect(cancelResponse.status).toBe(200);
    expect(await selectParticipantInvitationStatus(cancelInvitationId)).toBe('cancelled');
    expect(await selectParticipantInvitationActionCount(cancelInvitationId, 'cancelled')).toBe(1);

    const participantListResponse = await admin.request(
      `/api/v1/auth/organizations/participants?organizationId=${encodeURIComponent(organizationId)}`,
    );
    expect(participantListResponse.status).toBe(200);

    const organizationSlug = await selectOrganizationSlugById(organizationId);
    expect(organizationSlug).toBe('participant-org');
    const invitationListResponse = await admin.request(
      buildStoreInvitationPath(organizationSlug as string, organizationSlug as string),
    );
    expect(invitationListResponse.status).toBe(200);
  });

  it('予約ドメインエンドポイントに認証を要求する', async () => {
    const organizationId = crypto.randomUUID();
    await d1
      .prepare('INSERT INTO organization (id, slug, name, created_at) VALUES (?, ?, ?, ?)')
      .bind(organizationId, 'auth-required-org', 'Auth Required Org', Date.now())
      .run();
    const createdAt = Date.now();
    await d1
      .prepare(
        'INSERT INTO store (id, organization_id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        crypto.randomUUID(),
        organizationId,
        'auth-required-store',
        'Auth Required Store',
        createdAt,
        createdAt,
      )
      .run();

    const scopedBase = '/api/v1/auth/orgs/auth-required-org/stores/auth-required-store';
    const targets: Array<{
      path: string;
      method: 'GET' | 'POST';
      body?: Record<string, unknown>;
    }> = [
      { path: `${scopedBase}/services`, method: 'GET' },
      {
        path: `${scopedBase}/services`,
        method: 'POST',
        body: {
          name: 'Dummy',
          kind: 'single',
          durationMinutes: 60,
          capacity: 1,
        },
      },
      {
        path: `${scopedBase}/slots?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60 * 60 * 1000).toISOString())}`,
        method: 'GET',
      },
      {
        path: `${scopedBase}/slots/available?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60 * 60 * 1000).toISOString())}`,
        method: 'GET',
      },
      {
        path: `${scopedBase}/slots/update`,
        method: 'POST',
        body: {
          slotId: 'dummy-slot',
          startAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          endAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        },
      },
      {
        path: `${scopedBase}/bookings`,
        method: 'POST',
        body: {
          slotId: 'dummy-slot',
        },
      },
      {
        path: `${scopedBase}/participants/self-enroll`,
        method: 'POST',
        body: {},
      },
      { path: `${scopedBase}/bookings/mine`, method: 'GET' },
      {
        path: `${scopedBase}/bookings/cancel`,
        method: 'POST',
        body: {
          bookingId: 'dummy-booking',
        },
      },
      {
        path: `${scopedBase}/bookings/cancel-by-staff`,
        method: 'POST',
        body: {
          bookingId: 'dummy-booking',
        },
      },
      {
        path: `${scopedBase}/bookings/approve`,
        method: 'POST',
        body: {
          bookingId: 'dummy-booking',
        },
      },
      {
        path: `${scopedBase}/bookings/reject`,
        method: 'POST',
        body: {
          bookingId: 'dummy-booking',
        },
      },
      {
        path: `${scopedBase}/bookings/reschedule`,
        method: 'POST',
        body: {
          bookingId: 'dummy-booking',
          targetSlotId: 'dummy-slot',
        },
      },
      {
        path: `${scopedBase}/bookings/no-show`,
        method: 'POST',
        body: {
          bookingId: 'dummy-booking',
        },
      },
      {
        path: `${scopedBase}/bookings/check-in`,
        method: 'POST',
        body: {
          bookingId: 'dummy-booking',
          attendanceStatus: 'checked_in',
        },
      },
      { path: `${scopedBase}/ticket-types`, method: 'GET' },
      {
        path: `${scopedBase}/ticket-types/update`,
        method: 'POST',
        body: {
          ticketTypeId: 'dummy-ticket-type',
          name: 'Updated Ticket Type',
        },
      },
      { path: `${scopedBase}/ticket-types/purchasable`, method: 'GET' },
      {
        path: `${scopedBase}/ticket-packs?participantId=dummy-participant`,
        method: 'GET',
      },
      { path: `${scopedBase}/ticket-packs/mine`, method: 'GET' },
      {
        path: `${scopedBase}/ticket-packs/adjust`,
        method: 'POST',
        body: {
          ticketPackId: 'dummy-ticket-pack',
          remainingCount: 0,
          reason: 'test',
        },
      },
      { path: `${scopedBase}/ticket-purchases`, method: 'GET' },
      {
        path: `${scopedBase}/ticket-purchases`,
        method: 'POST',
        body: {
          ticketTypeId: 'dummy-ticket-type',
          paymentMethod: 'stripe',
        },
      },
      { path: `${scopedBase}/ticket-purchases/mine`, method: 'GET' },
      {
        path: `${scopedBase}/ticket-purchases/approve`,
        method: 'POST',
        body: {
          purchaseId: 'dummy-purchase',
        },
      },
      {
        path: `${scopedBase}/ticket-purchases/reject`,
        method: 'POST',
        body: {
          purchaseId: 'dummy-purchase',
        },
      },
      {
        path: `${scopedBase}/ticket-purchases/cancel`,
        method: 'POST',
        body: {
          purchaseId: 'dummy-purchase',
        },
      },
      { path: `${scopedBase}/recurring-schedules`, method: 'GET' },
    ];

    for (const target of targets) {
      const response = await app.request(target.path, {
        method: target.method,
        headers: {
          'content-type': 'application/json',
        },
        ...(target.body ? { body: JSON.stringify(target.body) } : {}),
      });
      expect(response.status).toBe(401);
    }
  });

  it('旧予約ドメインエンドポイントを登録しない', async () => {
    const legacyTargets: Array<{ path: string; method: 'GET' | 'POST' }> = [
      { path: '/api/v1/auth/organizations/services', method: 'GET' },
      { path: '/api/v1/auth/organizations/slots', method: 'GET' },
      { path: '/api/v1/auth/organizations/bookings', method: 'GET' },
      { path: '/api/v1/auth/organizations/participants/self-enroll', method: 'POST' },
      { path: '/api/v1/auth/organizations/ticket-types', method: 'GET' },
      { path: '/api/v1/auth/organizations/ticket-purchases', method: 'GET' },
      { path: '/api/v1/auth/organizations/recurring-schedules', method: 'GET' },
    ];

    for (const target of legacyTargets) {
      const response = await app.request(target.path, {
        method: target.method,
        headers: { 'content-type': 'application/json' },
        ...(target.method === 'POST' ? { body: JSON.stringify({}) } : {}),
      });
      expect(response.status).toBe(404);
    }
  });

  it('公開イベントを一覧し予約前の自己登録をサポートする', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Public Owner',
      email: 'public-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Public Events Org',
      slug: 'public-events-org',
    });
    const publicStoreId = await selectStoreIdBySlug(organizationId, 'public-events-org');
    expect(publicStoreId).toBeTruthy();
    await enablePremiumForOrganization(organizationId);

    const serviceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        name: 'Public Event Service',
        description: '公開向けのサービス説明テキストです。',
        kind: 'single',
        bookingPolicy: 'instant',
        cancellationDeadlineMinutes: 30,
        durationMinutes: 60,
        capacity: 3,
      }),
    });
    expect(serviceResponse.status).toBe(200);
    const servicePayload = (await toJson(serviceResponse)) as Record<string, unknown>;
    const serviceId = servicePayload.id as string;

    const slotStartAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const slotEndAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const slotResponse = await owner.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: slotStartAt,
        endAt: slotEndAt,
      }),
    });
    expect(slotResponse.status).toBe(200);
    const slotPayload = (await toJson(slotResponse)) as Record<string, unknown>;
    const slotId = slotPayload.id as string;
    expect(slotPayload.publicStatus).toBe('public');

    const privatePublicSlotResponse = await owner.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString(),
        publicStatus: 'private',
      }),
    });
    expect(privatePublicSlotResponse.status).toBe(200);
    const privatePublicSlotPayload = (await toJson(privatePublicSlotResponse)) as Record<
      string,
      unknown
    >;
    const privatePublicSlotId = privatePublicSlotPayload.id as string;
    expect(privatePublicSlotPayload.publicStatus).toBe('private');

    const suspendedPublicSlotResponse = await owner.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() + 11 * 60 * 60 * 1000).toISOString(),
        publicStatus: 'suspended',
      }),
    });
    expect(suspendedPublicSlotResponse.status).toBe(200);
    const suspendedPublicSlotPayload = (await toJson(suspendedPublicSlotResponse)) as Record<
      string,
      unknown
    >;
    const suspendedPublicSlotId = suspendedPublicSlotPayload.id as string;
    expect(suspendedPublicSlotPayload.publicStatus).toBe('suspended');

    const suspendedPublicSlotUpdateResponse = await owner.request(
      '/api/v1/auth/organizations/slots/public-status',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          slotId: suspendedPublicSlotId,
          publicStatus: 'suspended',
        }),
      },
    );
    expect(suspendedPublicSlotUpdateResponse.status).toBe(200);
    expect(await toJson(suspendedPublicSlotUpdateResponse)).toMatchObject({
      id: suspendedPublicSlotId,
      publicStatus: 'suspended',
    });

    const privateServiceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        name: 'Private Public Event Service',
        kind: 'single',
        bookingPolicy: 'instant',
        durationMinutes: 60,
        capacity: 3,
        publicStatus: 'private',
      }),
    });
    expect(privateServiceResponse.status).toBe(200);
    const privateServicePayload = (await toJson(privateServiceResponse)) as Record<string, unknown>;
    const privateServiceId = privateServicePayload.id as string;
    expect(privateServicePayload.publicStatus).toBe('private');

    const privateSlotResponse = await owner.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        serviceId: privateServiceId,
        startAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(privateSlotResponse.status).toBe(200);
    const privateSlotPayload = (await toJson(privateSlotResponse)) as Record<string, unknown>;
    const privateSlotId = privateSlotPayload.id as string;

    const suspendedServiceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        name: 'Suspended Public Event Service',
        kind: 'single',
        bookingPolicy: 'instant',
        durationMinutes: 60,
        capacity: 3,
        publicStatus: 'suspended',
      }),
    });
    expect(suspendedServiceResponse.status).toBe(200);
    const suspendedServicePayload = (await toJson(suspendedServiceResponse)) as Record<
      string,
      unknown
    >;
    const suspendedServiceId = suspendedServicePayload.id as string;
    expect(suspendedServicePayload.publicStatus).toBe('suspended');

    const suspendedSlotResponse = await owner.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        serviceId: suspendedServiceId,
        startAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(suspendedSlotResponse.status).toBe(200);
    const suspendedSlotPayload = (await toJson(suspendedSlotResponse)) as Record<string, unknown>;
    const suspendedSlotId = suspendedSlotPayload.id as string;

    const allTicketTypeResponse = await owner.request('/api/v1/auth/organizations/ticket-types', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        name: 'Public All Service Ticket',
        totalCount: 10,
        expiresInDays: 60,
        serviceScope: 'all',
        isForSale: true,
      }),
    });
    expect(allTicketTypeResponse.status).toBe(200);
    const allTicketTypePayload = (await toJson(allTicketTypeResponse)) as Record<string, unknown>;
    const allTicketTypeId = allTicketTypePayload.id as string;

    const specificTicketTypeResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-types',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          organizationId,
          name: 'Public Specific Ticket',
          totalCount: 5,
          serviceScope: 'specific',
          serviceIds: [serviceId],
          isForSale: true,
        }),
      },
    );
    expect(specificTicketTypeResponse.status).toBe(200);
    const specificTicketTypePayload = (await toJson(specificTicketTypeResponse)) as Record<
      string,
      unknown
    >;
    const specificTicketTypeId = specificTicketTypePayload.id as string;

    const inactiveTicketTypeResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-types',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          organizationId,
          name: 'Public Inactive Ticket',
          totalCount: 5,
          serviceScope: 'all',
          isActive: false,
          isForSale: true,
        }),
      },
    );
    expect(inactiveTicketTypeResponse.status).toBe(200);
    const inactiveTicketTypePayload = (await toJson(inactiveTicketTypeResponse)) as Record<
      string,
      unknown
    >;
    const inactiveTicketTypeId = inactiveTicketTypePayload.id as string;

    const notForSaleTicketTypeResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-types',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          organizationId,
          name: 'Public Hidden Ticket',
          totalCount: 5,
          serviceScope: 'all',
          isForSale: false,
        }),
      },
    );
    expect(notForSaleTicketTypeResponse.status).toBe(200);
    const notForSaleTicketTypePayload = (await toJson(notForSaleTicketTypeResponse)) as Record<
      string,
      unknown
    >;
    const notForSaleTicketTypeId = notForSaleTicketTypePayload.id as string;

    const secondPublicStoreResponse = await owner.request(
      '/api/v1/auth/orgs/public-events-org/stores',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Public Events Second Room',
          slug: 'public-events-second-room',
        }),
      },
    );
    expect(secondPublicStoreResponse.status).toBe(200);
    const otherStoreTicketTypeResponse = await owner.request(
      '/api/v1/auth/orgs/public-events-org/stores/public-events-second-room/ticket-types',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Other Store Ticket',
          totalCount: 4,
          serviceScope: 'all',
          isForSale: true,
        }),
      },
    );
    expect(otherStoreTicketTypeResponse.status).toBe(200);
    const otherStoreTicketTypePayload = (await toJson(otherStoreTicketTypeResponse)) as Record<
      string,
      unknown
    >;
    const otherStoreTicketTypeId = otherStoreTicketTypePayload.id as string;

    const publicSiteSettingResponse = await owner.request(
      '/api/v1/auth/orgs/public-events-org/stores/public-events-org/public-site',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          siteName: 'Public Events Site',
          description: '予約サイトトップページの説明です。',
          address: '東京都千代田区1-1-1',
          phone: '03-0000-0000',
          businessHours: '平日 10:00-18:00',
          imageUrl: 'https://example.com/public-site.webp',
        }),
      },
    );
    expect(publicSiteSettingResponse.status).toBe(200);
    expect(await toJson(publicSiteSettingResponse)).toMatchObject({
      organizationSlug: 'public-events-org',
      storeSlug: 'public-events-org',
      siteName: 'Public Events Site',
      address: '東京都千代田区1-1-1',
    });

    const publicFormCreateResponse = await owner.request(
      '/api/v1/auth/orgs/public-events-org/stores/public-events-org/forms',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          formType: 'reservation_input',
          name: '体験予約フォーム',
          description: '公開予約時に確認する項目です。',
          fields: [
            {
              fieldKey: 'experience',
              label: '経験年数',
              fieldType: 'select',
              required: true,
              options: [
                { value: 'none', label: '未経験' },
                { value: 'over_1_year', label: '1年以上' },
              ],
              placeholder: '選択してください',
            },
            {
              fieldKey: 'goal',
              label: '参加目的',
              fieldType: 'text',
              required: true,
              options: [],
              placeholder: '例: 体力づくり',
              description: '目的を一言で入力してください。',
            },
            {
              fieldKey: 'request',
              label: '希望内容',
              fieldType: 'textarea',
              required: false,
              options: [],
              placeholder: '配慮事項など',
            },
            {
              fieldKey: 'newsletter',
              label: '案内メールを受け取る',
              fieldType: 'checkbox',
              required: false,
              options: [{ value: 'subscribe', label: '受け取る' }],
            },
          ],
        }),
      },
    );
    expect(publicFormCreateResponse.status).toBe(200);
    const publicFormCreatePayload = (await toJson(publicFormCreateResponse)) as Record<
      string,
      unknown
    >;
    const publicFormId = publicFormCreatePayload.id as string;
    expect(publicFormId).toBeTruthy();

    const publicFormPublishResponse = await owner.request(
      `/api/v1/auth/orgs/public-events-org/stores/public-events-org/forms/${encodeURIComponent(publicFormId)}/publish`,
      {
        method: 'POST',
      },
    );
    expect(publicFormPublishResponse.status).toBe(200);
    const publicFormPublishPayload = (await toJson(publicFormPublishResponse)) as {
      currentPublishedVersion?: { id?: string; versionNumber?: number };
    };
    const publicFormVersionId = publicFormPublishPayload.currentPublishedVersion?.id;
    expect(publicFormVersionId).toBeTruthy();

    const publicFormAssignmentResponse = await owner.request(
      `/api/v1/auth/orgs/public-events-org/stores/public-events-org/forms/${encodeURIComponent(publicFormId)}/assignments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetType: 'store',
          targetId: publicStoreId,
        }),
      },
    );
    expect(publicFormAssignmentResponse.status).toBe(200);

    const publicEventsResponse = await app.request(
      '/api/v1/public/orgs/public-events-org/stores/public-events-org/events',
    );
    expect(publicEventsResponse.status).toBe(200);
    const publicEventsPayload = (await toJson(publicEventsResponse)) as {
      events?: Array<Record<string, unknown>>;
      ticketTypes?: Array<Record<string, unknown>>;
    };
    const publicEvent = publicEventsPayload.events?.find((row) => row.slotId === slotId);
    expect(publicEvent).toBeTruthy();
    expect(publicEvent?.serviceDescription).toBe('公開向けのサービス説明テキストです。');
    expect(publicEvent?.slotPublicStatus).toBe('public');
    expect(publicEventsPayload.events?.some((row) => row.slotId === privatePublicSlotId)).toBe(
      false,
    );
    const suspendedSlotPublicEvent = publicEventsPayload.events?.find(
      (row) => row.slotId === suspendedPublicSlotId,
    );
    expect(suspendedSlotPublicEvent).toMatchObject({
      slotPublicStatus: 'suspended',
      isBookable: false,
    });
    expect(publicEventsPayload.events?.some((row) => row.slotId === privateSlotId)).toBe(false);
    const suspendedPublicEvent = publicEventsPayload.events?.find(
      (row) => row.slotId === suspendedSlotId,
    );
    expect(suspendedPublicEvent).toMatchObject({
      serviceName: 'Suspended Public Event Service',
      isBookable: false,
    });
    const publicTicketTypeNames =
      publicEventsPayload.ticketTypes?.map((ticketType) => ticketType.name) ?? [];
    expect(publicTicketTypeNames).toEqual(
      expect.arrayContaining(['Public All Service Ticket', 'Public Specific Ticket']),
    );
    expect(publicTicketTypeNames).not.toContain('Public Inactive Ticket');
    expect(publicTicketTypeNames).not.toContain('Public Hidden Ticket');

    const allPublicTicketType = publicEventsPayload.ticketTypes?.find(
      (ticketType) => ticketType.name === 'Public All Service Ticket',
    );
    expect(allPublicTicketType).toMatchObject({
      totalCount: 10,
      expiresInDays: 60,
      serviceScope: 'all',
      serviceIds: [],
      serviceNames: [],
      href: `/public-events-org/public-events-org/tickets/${allTicketTypeId}`,
    });

    const specificPublicTicketType = publicEventsPayload.ticketTypes?.find(
      (ticketType) => ticketType.name === 'Public Specific Ticket',
    );
    expect(specificPublicTicketType).toMatchObject({
      totalCount: 5,
      expiresInDays: null,
      serviceScope: 'specific',
      serviceIds: [serviceId],
      serviceNames: ['Public Event Service'],
      href: `/public-events-org/public-events-org/tickets/${specificTicketTypeId}`,
    });

    const publicTicketTypeDetailResponse = await app.request(
      `/api/v1/public/orgs/public-events-org/stores/public-events-org/ticket-types/${encodeURIComponent(specificTicketTypeId)}`,
    );
    expect(publicTicketTypeDetailResponse.status).toBe(200);
    const publicTicketTypeDetail = (await toJson(publicTicketTypeDetailResponse)) as Record<
      string,
      unknown
    >;
    expect(publicTicketTypeDetail).toMatchObject({
      id: specificTicketTypeId,
      name: 'Public Specific Ticket',
      totalCount: 5,
      expiresInDays: null,
      serviceScope: 'specific',
      serviceIds: [serviceId],
      serviceNames: ['Public Event Service'],
      href: `/public-events-org/public-events-org/tickets/${specificTicketTypeId}`,
    });

    for (const hiddenTicketTypeId of [
      inactiveTicketTypeId,
      notForSaleTicketTypeId,
      otherStoreTicketTypeId,
      'missing-ticket-type',
    ]) {
      const hiddenTicketTypeResponse = await app.request(
        `/api/v1/public/orgs/public-events-org/stores/public-events-org/ticket-types/${encodeURIComponent(hiddenTicketTypeId)}`,
      );
      expect(hiddenTicketTypeResponse.status).toBe(404);
    }

    const publicEventDetailResponse = await app.request(
      `/api/v1/public/orgs/public-events-org/stores/public-events-org/events/${encodeURIComponent(slotId)}`,
    );
    expect(publicEventDetailResponse.status).toBe(200);
    const publicEventDetail = (await toJson(publicEventDetailResponse)) as Record<string, unknown>;
    expect(publicEventDetail.slotId).toBe(slotId);
    expect(publicEventDetail.organizationId).toBe(organizationId);
    expect(publicEventDetail.serviceDescription).toBe('公開向けのサービス説明テキストです。');
    expect(
      (publicEventDetail.ticketTypes as Array<Record<string, unknown>> | undefined)?.map(
        (ticketType) => ticketType.name,
      ),
    ).toEqual(expect.arrayContaining(['Public All Service Ticket', 'Public Specific Ticket']));
    expect(publicEventDetail).not.toHaveProperty('intakeFields');

    const publicRequiredFormsResponse = await app.request(
      `/api/v1/public/orgs/public-events-org/stores/public-events-org/forms/required?serviceId=${encodeURIComponent(
        serviceId,
      )}&slotId=${encodeURIComponent(slotId)}`,
    );
    expect(publicRequiredFormsResponse.status).toBe(200);
    const publicRequiredFormsPayload = (await toJson(publicRequiredFormsResponse)) as {
      formContextHash: string;
      forms: Array<{
        formTemplateId: string;
        formTemplateVersionId: string;
        formType: string;
        name: string;
        versionNumber: number;
        fields: Array<Record<string, unknown>>;
      }>;
    };
    expect(publicRequiredFormsPayload.formContextHash).toEqual(expect.stringMatching(/^ctx_/));
    expect(publicRequiredFormsPayload.forms).toEqual([
      expect.objectContaining({
        formTemplateId: publicFormId,
        formTemplateVersionId: publicFormVersionId,
        formType: 'reservation_input',
        name: '体験予約フォーム',
        versionNumber: 1,
        fields: [
          expect.objectContaining({
            fieldKey: 'experience',
            label: '経験年数',
            fieldType: 'select',
            required: true,
            options: [
              { value: 'none', label: '未経験' },
              { value: 'over_1_year', label: '1年以上' },
            ],
            placeholder: '選択してください',
          }),
          expect.objectContaining({
            fieldKey: 'goal',
            label: '参加目的',
            fieldType: 'text',
            required: true,
            placeholder: '例: 体力づくり',
            description: '目的を一言で入力してください。',
          }),
          expect.objectContaining({
            fieldKey: 'request',
            label: '希望内容',
            fieldType: 'textarea',
            required: false,
            placeholder: '配慮事項など',
          }),
          expect.objectContaining({
            fieldKey: 'newsletter',
            label: '案内メールを受け取る',
            fieldType: 'checkbox',
            required: false,
            options: [{ value: 'subscribe', label: '受け取る' }],
          }),
        ],
      }),
    ]);

    const validPublicFormSubmissions = [
      {
        formTemplateId: publicFormId,
        formTemplateVersionId: publicFormVersionId as string,
        answers: [
          {
            fieldKey: 'experience',
            value: 'over_1_year',
          },
          {
            fieldKey: 'goal',
            value: '体力づくり',
          },
          {
            fieldKey: 'request',
            value: '初回なのでゆっくり進めたい',
          },
          {
            fieldKey: 'newsletter',
            value: ['subscribe'],
          },
        ],
      },
    ];

    const privatePublicEventDetailResponse = await app.request(
      `/api/v1/public/orgs/public-events-org/stores/public-events-org/events/${encodeURIComponent(privateSlotId)}`,
    );
    expect(privatePublicEventDetailResponse.status).toBe(404);

    const privateSlotPublicEventDetailResponse = await app.request(
      `/api/v1/public/orgs/public-events-org/stores/public-events-org/events/${encodeURIComponent(privatePublicSlotId)}`,
    );
    expect(privateSlotPublicEventDetailResponse.status).toBe(404);

    const suspendedSlotPublicEventDetailResponse = await app.request(
      `/api/v1/public/orgs/public-events-org/stores/public-events-org/events/${encodeURIComponent(suspendedPublicSlotId)}`,
    );
    expect(suspendedSlotPublicEventDetailResponse.status).toBe(200);
    const suspendedSlotPublicEventDetail = (await toJson(
      suspendedSlotPublicEventDetailResponse,
    )) as Record<string, unknown>;
    expect(suspendedSlotPublicEventDetail).toMatchObject({
      slotId: suspendedPublicSlotId,
      slotPublicStatus: 'suspended',
      isBookable: false,
    });

    const suspendedPublicEventDetailResponse = await app.request(
      `/api/v1/public/orgs/public-events-org/stores/public-events-org/events/${encodeURIComponent(suspendedSlotId)}`,
    );
    expect(suspendedPublicEventDetailResponse.status).toBe(200);
    const suspendedPublicEventDetail = (await toJson(suspendedPublicEventDetailResponse)) as Record<
      string,
      unknown
    >;
    expect(suspendedPublicEventDetail).toMatchObject({
      slotId: suspendedSlotId,
      isBookable: false,
    });

    const publicSiteResponse = await app.request(
      '/api/v1/public/orgs/public-events-org/stores/public-events-org/site',
    );
    expect(publicSiteResponse.status).toBe(200);
    const publicSitePayload = (await toJson(publicSiteResponse)) as Record<string, unknown>;
    expect(publicSitePayload.site).toMatchObject({
      siteName: 'Public Events Site',
      description: '予約サイトトップページの説明です。',
      address: '東京都千代田区1-1-1',
      phone: '03-0000-0000',
      businessHours: '平日 10:00-18:00',
      imageUrl: 'https://example.com/public-site.webp',
    });
    expect(
      (publicSitePayload.bookingPages as Array<Record<string, unknown>> | undefined)?.some(
        (bookingPage) =>
          bookingPage.slotId === slotId &&
          bookingPage.href === `/public-events-org/public-events-org/events/${slotId}`,
      ),
    ).toBe(true);
    expect(
      (publicSitePayload.ticketTypes as Array<Record<string, unknown>> | undefined)?.map(
        (ticketType) => ticketType.name,
      ),
    ).toEqual(expect.arrayContaining(['Public All Service Ticket', 'Public Specific Ticket']));

    const missingAnswerBookingResponse = await app.request(
      '/api/v1/public/orgs/public-events-org/stores/public-events-org/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId,
          customer: {
            name: 'Missing Form Guest',
            email: 'missing-form@example.com',
          },
          participantsCount: 1,
          formContextHash: publicRequiredFormsPayload.formContextHash,
          formSubmissions: [],
        }),
      },
    );
    expect(missingAnswerBookingResponse.status).toBe(400);

    const suspendedPublicBookingResponse = await app.request(
      '/api/v1/public/orgs/public-events-org/stores/public-events-org/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: suspendedSlotId,
          customer: {
            name: 'Suspended Guest',
            email: 'suspended-guest@example.com',
          },
          participantsCount: 1,
          formContextHash: publicRequiredFormsPayload.formContextHash,
          formSubmissions: [],
        }),
      },
    );
    expect(suspendedPublicBookingResponse.status).toBe(409);

    const suspendedSlotPublicBookingResponse = await app.request(
      '/api/v1/public/orgs/public-events-org/stores/public-events-org/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: suspendedPublicSlotId,
          customer: {
            name: 'Suspended Slot Guest',
            email: 'suspended-slot-guest@example.com',
          },
          participantsCount: 1,
          formContextHash: publicRequiredFormsPayload.formContextHash,
          formSubmissions: [],
        }),
      },
    );
    expect(suspendedSlotPublicBookingResponse.status).toBe(409);

    const privateSlotPublicBookingResponse = await app.request(
      '/api/v1/public/orgs/public-events-org/stores/public-events-org/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: privatePublicSlotId,
          customer: {
            name: 'Private Slot Guest',
            email: 'private-slot-guest@example.com',
          },
          participantsCount: 1,
          formContextHash: publicRequiredFormsPayload.formContextHash,
          formSubmissions: [],
        }),
      },
    );
    expect(privateSlotPublicBookingResponse.status).toBe(404);

    const publicBookingResponse = await app.request(
      '/api/v1/public/orgs/public-events-org/stores/public-events-org/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId,
          serviceId,
          customer: {
            name: 'Guest Booker',
            email: 'guest-booker@example.com',
            phone: '090-0000-0000',
          },
          participantsCount: 2,
          companions: [{ name: 'Guest Companion' }],
          note: '公開予約の備考',
          formContextHash: publicRequiredFormsPayload.formContextHash,
          formSubmissions: validPublicFormSubmissions,
        }),
      },
    );
    expect(publicBookingResponse.status).toBe(200);
    const publicBookingPayload = (await toJson(publicBookingResponse)) as Record<string, unknown>;
    expect(publicBookingPayload.bookingPublicId).toMatch(/^bk_/);
    const publicBookingRow = await selectBookingByPublicId(
      publicBookingPayload.bookingPublicId as string,
    );
    expect(publicBookingRow).toMatchObject({
      participantId: null,
      source: 'public_site',
      customerName: 'Guest Booker',
      customerEmail: 'guest-booker@example.com',
      customerPhone: '090-0000-0000',
      status: 'confirmed',
    });
    expect(Number(publicBookingRow?.participantsCount ?? 0)).toBe(2);
    expect(await selectSlotReservedCount(slotId)).toBe(2);
    expect(await selectFormAnswerRowsByBooking(publicBookingRow?.id ?? '')).toEqual([
      {
        formTemplateId: publicFormId,
        formTemplateVersionId: publicFormVersionId,
        formType: 'reservation_input',
        source: 'public',
        customerNameSnapshot: 'Guest Booker',
        customerEmailSnapshot: 'guest-booker@example.com',
        fieldKey: 'experience',
        fieldType: 'select',
        labelSnapshot: '経験年数',
        valueJson: JSON.stringify('over_1_year'),
      },
      {
        formTemplateId: publicFormId,
        formTemplateVersionId: publicFormVersionId,
        formType: 'reservation_input',
        source: 'public',
        customerNameSnapshot: 'Guest Booker',
        customerEmailSnapshot: 'guest-booker@example.com',
        fieldKey: 'goal',
        fieldType: 'text',
        labelSnapshot: '参加目的',
        valueJson: JSON.stringify('体力づくり'),
      },
      {
        formTemplateId: publicFormId,
        formTemplateVersionId: publicFormVersionId,
        formType: 'reservation_input',
        source: 'public',
        customerNameSnapshot: 'Guest Booker',
        customerEmailSnapshot: 'guest-booker@example.com',
        fieldKey: 'request',
        fieldType: 'textarea',
        labelSnapshot: '希望内容',
        valueJson: JSON.stringify('初回なのでゆっくり進めたい'),
      },
      {
        formTemplateId: publicFormId,
        formTemplateVersionId: publicFormVersionId,
        formType: 'reservation_input',
        source: 'public',
        customerNameSnapshot: 'Guest Booker',
        customerEmailSnapshot: 'guest-booker@example.com',
        fieldKey: 'newsletter',
        fieldType: 'checkbox',
        labelSnapshot: '案内メールを受け取る',
        valueJson: JSON.stringify(['subscribe']),
      },
    ]);

    const publicCancelToken = 'test-public-cancel-token';
    await insertPublicCancelTokenForTest({
      bookingId: publicBookingRow?.id ?? '',
      token: publicCancelToken,
      emailSnapshot: 'guest-booker@example.com',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const publicCancelResponse = await app.request(
      `/api/v1/public/orgs/public-events-org/stores/public-events-org/bookings/${encodeURIComponent(
        publicBookingPayload.bookingPublicId as string,
      )}/cancel`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: publicCancelToken,
          reason: '公開予約キャンセル',
        }),
      },
    );
    expect(publicCancelResponse.status).toBe(200);
    expect(await selectBookingStatus(publicBookingRow?.id ?? '')).toBe('cancelled');
    expect(await selectSlotReservedCount(slotId)).toBe(0);

    const reusedPublicCancelResponse = await app.request(
      `/api/v1/public/orgs/public-events-org/stores/public-events-org/bookings/${encodeURIComponent(
        publicBookingPayload.bookingPublicId as string,
      )}/cancel`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: publicCancelToken,
        }),
      },
    );
    expect(reusedPublicCancelResponse.status).toBe(409);

    const staffCreateResponse = await owner.request(
      '/api/v1/auth/orgs/public-events-org/stores/public-events-org/bookings/staff-create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId,
          source: 'phone',
          customerName: 'Phone Booker',
          customerEmail: 'phone-booker@example.com',
          customerPhone: '03-1111-2222',
          participantsCount: 1,
          notifyCustomer: false,
          companions: [{ name: 'Phone Companion' }],
          note: '電話受付',
          formSubmissions: [
            {
              formTemplateId: publicFormId,
              formTemplateVersionId: publicFormVersionId,
              answers: [
                {
                  fieldKey: 'experience',
                  value: 'none',
                },
                {
                  fieldKey: 'goal',
                  value: '電話受付',
                },
              ],
            },
          ],
        }),
      },
    );
    expect(staffCreateResponse.status).toBe(200);
    const staffCreatePayload = (await toJson(staffCreateResponse)) as Record<string, unknown>;
    expect(staffCreatePayload).toMatchObject({
      participantId: null,
      source: 'phone',
      customerName: 'Phone Booker',
      customerEmail: 'phone-booker@example.com',
      customerPhone: '03-1111-2222',
      participantsCount: 1,
      status: 'confirmed',
    });
    expect(await selectSlotReservedCount(slotId)).toBe(1);
    expect(await selectFormAnswerRowsByBooking(staffCreatePayload.id as string)).toEqual([
      expect.objectContaining({
        formTemplateId: publicFormId,
        formTemplateVersionId: publicFormVersionId,
        formType: 'reservation_input',
        source: 'staff',
        customerNameSnapshot: 'Phone Booker',
        customerEmailSnapshot: 'phone-booker@example.com',
        fieldKey: 'experience',
        fieldType: 'select',
        labelSnapshot: '経験年数',
        valueJson: JSON.stringify('none'),
      }),
      expect.objectContaining({
        formTemplateId: publicFormId,
        formTemplateVersionId: publicFormVersionId,
        formType: 'reservation_input',
        source: 'staff',
        customerNameSnapshot: 'Phone Booker',
        customerEmailSnapshot: 'phone-booker@example.com',
        fieldKey: 'goal',
        fieldType: 'text',
        labelSnapshot: '参加目的',
        valueJson: JSON.stringify('電話受付'),
      }),
    ]);

    const scopedOrganizationId = await createOrganization({
      agent: owner,
      name: 'Scoped Public Events Org',
      slug: 'scoped-public-events-org',
    });
    await enablePremiumForOrganization(scopedOrganizationId);
    const scopedServiceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId: scopedOrganizationId,
        name: 'Scoped Public Event Service',
        kind: 'single',
        bookingPolicy: 'instant',
        durationMinutes: 45,
        capacity: 4,
      }),
    });
    expect(scopedServiceResponse.status).toBe(200);
    const scopedServicePayload = (await toJson(scopedServiceResponse)) as Record<string, unknown>;
    const scopedServiceId = scopedServicePayload.id as string;
    const scopedSlotResponse = await owner.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId: scopedOrganizationId,
        serviceId: scopedServiceId,
        startAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(scopedSlotResponse.status).toBe(200);
    const scopedSlotPayload = (await toJson(scopedSlotResponse)) as Record<string, unknown>;
    const scopedPublicEventsWithoutSiteResponse = await app.request(
      '/api/v1/public/orgs/scoped-public-events-org/stores/scoped-public-events-org/events',
    );
    expect(scopedPublicEventsWithoutSiteResponse.status).toBe(404);

    const privateScopedPublicSiteSettingResponse = await owner.request(
      '/api/v1/auth/orgs/scoped-public-events-org/stores/scoped-public-events-org/public-site',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          siteName: 'Scoped Private Events Site',
          status: 'private',
          acceptBookings: true,
        }),
      },
    );
    expect(privateScopedPublicSiteSettingResponse.status).toBe(200);
    const scopedPublicEventsPrivateResponse = await app.request(
      '/api/v1/public/orgs/scoped-public-events-org/stores/scoped-public-events-org/events',
    );
    expect(scopedPublicEventsPrivateResponse.status).toBe(404);

    const scopedPublicSiteSettingResponse = await owner.request(
      '/api/v1/auth/orgs/scoped-public-events-org/stores/scoped-public-events-org/public-site',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          siteName: 'Scoped Public Events Site',
          status: 'public',
          acceptBookings: true,
        }),
      },
    );
    expect(scopedPublicSiteSettingResponse.status).toBe(200);

    const scopedPublicEventsResponse = await app.request(
      '/api/v1/public/orgs/scoped-public-events-org/stores/scoped-public-events-org/events',
    );
    expect(scopedPublicEventsResponse.status).toBe(200);
    const scopedPublicEventsPayload = (await toJson(scopedPublicEventsResponse)) as {
      events?: Array<Record<string, unknown>>;
    };
    expect(
      scopedPublicEventsPayload.events?.some((row) => row.slotId === scopedSlotPayload.id),
    ).toBe(true);

    const scopedSelfEnrollPath =
      '/api/v1/auth/orgs/public-events-org/stores/public-events-org/participants/self-enroll';
    const scopedParticipantBookingsPath =
      '/api/v1/auth/orgs/public-events-org/stores/public-events-org/bookings';

    const unauthSelfEnrollResponse = await app.request(
      scopedSelfEnrollPath,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );
    expect(unauthSelfEnrollResponse.status).toBe(401);

    const participantUser = createAuthAgent(app);
    await signUpUser({
      agent: participantUser,
      name: 'Self Enroll User',
      email: 'self-enroll-user@example.com',
    });

    const forbiddenStaffCreateResponse = await participantUser.request(
      '/api/v1/auth/orgs/public-events-org/stores/public-events-org/bookings/staff-create',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          slotId,
          source: 'phone',
          customerName: 'Blocked Booker',
          customerEmail: 'blocked-booker@example.com',
          participantsCount: 1,
        }),
      },
    );
    expect(forbiddenStaffCreateResponse.status).toBe(403);

    const bookingBeforeSelfEnrollResponse = await participantUser.request(
      scopedParticipantBookingsPath,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          slotId,
        }),
      },
    );
    expect(bookingBeforeSelfEnrollResponse.status).toBe(403);

    const forbiddenSelfEnrollResponse = await participantUser.request(
      '/api/v1/auth/orgs/missing-org/stores/missing-store/participants/self-enroll',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );
    expect(forbiddenSelfEnrollResponse.status).toBe(404);

    const firstSelfEnrollResponse = await participantUser.request(
      scopedSelfEnrollPath,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );
    expect(firstSelfEnrollResponse.status).toBe(200);
    const firstSelfEnrollPayload = (await toJson(firstSelfEnrollResponse)) as Record<
      string,
      unknown
    >;
    expect(firstSelfEnrollPayload.created).toBe(true);

    const secondSelfEnrollResponse = await participantUser.request(
      scopedSelfEnrollPath,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );
    expect(secondSelfEnrollResponse.status).toBe(200);
    const secondSelfEnrollPayload = (await toJson(secondSelfEnrollResponse)) as Record<
      string,
      unknown
    >;
    expect(secondSelfEnrollPayload.created).toBe(false);
    expect(
      await selectParticipantCountByEmail(organizationId, 'self-enroll-user@example.com'),
    ).toBe(1);

    const bookingAfterSelfEnrollResponse = await participantUser.request(
      scopedParticipantBookingsPath,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          slotId,
        }),
      },
    );
    expect([200, 409]).toContain(bookingAfterSelfEnrollResponse.status);
  });

  it('サービス名・説明の上限を検証し更新時に説明を正規化する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Service Rule Owner',
      email: 'service-rule-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Service Rule Org',
      slug: 'service-rule-org',
    });

    const validServiceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        name: '名'.repeat(120),
        description: '説'.repeat(500),
        kind: 'single',
        durationMinutes: 60,
        capacity: 5,
      }),
    });
    expect(validServiceResponse.status).toBe(200);
    const validServicePayload = (await toJson(validServiceResponse)) as Record<string, unknown>;
    const serviceId = validServicePayload.id as string;
    expect(validServicePayload.description).toBe('説'.repeat(500));

    const tooLongNameResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        name: '名'.repeat(121),
        kind: 'single',
        durationMinutes: 60,
        capacity: 5,
      }),
    });
    expect([400, 422]).toContain(tooLongNameResponse.status);

    const tooLongDescriptionResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        name: '文字制限チェック',
        description: '説'.repeat(501),
        kind: 'single',
        durationMinutes: 60,
        capacity: 5,
      }),
    });
    expect([400, 422]).toContain(tooLongDescriptionResponse.status);

    const updateDescriptionResponse = await owner.request(
      '/api/v1/auth/organizations/services/update',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          serviceId,
          description: '   ',
        }),
      },
    );
    expect(updateDescriptionResponse.status).toBe(200);
    const updateDescriptionPayload = (await toJson(updateDescriptionResponse)) as Record<
      string,
      unknown
    >;
    expect(updateDescriptionPayload.description).toBeNull();
  });

  it('ガード条件付きで枠を更新し予約受付期間を再計算する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Slot Update Owner',
      email: 'slot-update-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Slot Update Org',
      slug: 'slot-update-org',
    });
    await enablePremiumForOrganization(organizationId);

    const participantInvite = await createParticipantInvitation({
      agent: owner,
      email: 'slot-update-participant@example.com',
      participantName: 'Slot Update Participant',
      organizationId,
    });
    expect(participantInvite.response.status).toBe(200);

    const participantUser = createAuthAgent(app);
    await signUpUser({
      agent: participantUser,
      name: 'Slot Update Participant',
      email: 'slot-update-participant@example.com',
    });
    const participantAcceptResponse = await participantUser.request(
      buildInvitationActionPath(participantInvite.payload?.id as string, 'accept'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invitationId: participantInvite.payload?.id,
        }),
      },
    );
    expect(participantAcceptResponse.status).toBe(200);

    const serviceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: 'Slot Update Service',
        kind: 'single',
        bookingPolicy: 'instant',
        durationMinutes: 60,
        capacity: 8,
        bookingOpenMinutesBefore: 120,
        bookingCloseMinutesBefore: 30,
      }),
    });
    expect(serviceResponse.status).toBe(200);
    const servicePayload = (await toJson(serviceResponse)) as Record<string, unknown>;
    const serviceId = servicePayload.id as string;

    const firstStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const firstEnd = new Date(firstStart.getTime() + 60 * 60 * 1000);
    const firstSlotResponse = await owner.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: firstStart.toISOString(),
        endAt: firstEnd.toISOString(),
      }),
    });
    expect(firstSlotResponse.status).toBe(200);
    const firstSlotPayload = (await toJson(firstSlotResponse)) as Record<string, unknown>;
    const firstSlotId = firstSlotPayload.id as string;

    const updatedStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const updatedEnd = new Date(updatedStart.getTime() + 90 * 60 * 1000);
    const updateResponse = await owner.request('/api/v1/auth/organizations/slots/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: firstSlotId,
        startAt: updatedStart.toISOString(),
        endAt: updatedEnd.toISOString(),
        capacity: 12,
        staffLabel: '  Coach  ',
        locationLabel: '  Room A  ',
      }),
    });
    expect(updateResponse.status).toBe(200);
    const updatePayload = (await toJson(updateResponse)) as Record<string, unknown>;
    expect(updatePayload.capacity).toBe(12);
    expect(updatePayload.staffLabel).toBe('Coach');
    expect(updatePayload.locationLabel).toBe('Room A');
    expect(updatePayload.bookingOpenAt).toBe(
      new Date(updatedStart.getTime() - 120 * 60 * 1000).toISOString(),
    );
    expect(updatePayload.bookingCloseAt).toBe(
      new Date(updatedStart.getTime() - 30 * 60 * 1000).toISOString(),
    );

    const invalidRangeResponse = await owner.request('/api/v1/auth/organizations/slots/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: firstSlotId,
        startAt: updatedStart.toISOString(),
        endAt: updatedStart.toISOString(),
      }),
    });
    expect(invalidRangeResponse.status).toBe(422);

    const canceledStart = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const canceledEnd = new Date(canceledStart.getTime() + 60 * 60 * 1000);
    const canceledSlotResponse = await owner.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: canceledStart.toISOString(),
        endAt: canceledEnd.toISOString(),
      }),
    });
    expect(canceledSlotResponse.status).toBe(200);
    const canceledSlotPayload = (await toJson(canceledSlotResponse)) as Record<string, unknown>;
    const canceledSlotId = canceledSlotPayload.id as string;

    const cancelSlotResponse = await owner.request('/api/v1/auth/organizations/slots/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: canceledSlotId,
      }),
    });
    expect(cancelSlotResponse.status).toBe(200);

    const updateCanceledSlotResponse = await owner.request(
      '/api/v1/auth/organizations/slots/update',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: canceledSlotId,
          startAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
          endAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
        }),
      },
    );
    expect(updateCanceledSlotResponse.status).toBe(409);

    const reservedStart = new Date(Date.now() + 90 * 60 * 1000);
    const reservedEnd = new Date(reservedStart.getTime() + 60 * 60 * 1000);
    const reservedSlotResponse = await owner.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: reservedStart.toISOString(),
        endAt: reservedEnd.toISOString(),
      }),
    });
    expect(reservedSlotResponse.status).toBe(200);
    const reservedSlotPayload = (await toJson(reservedSlotResponse)) as Record<string, unknown>;
    const reservedSlotId = reservedSlotPayload.id as string;

    const reservedBookingResponse = await participantUser.request(
      '/api/v1/auth/organizations/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: reservedSlotId,
        }),
      },
    );
    expect(reservedBookingResponse.status).toBe(200);

    const updateReservedSlotResponse = await owner.request(
      '/api/v1/auth/organizations/slots/update',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: reservedSlotId,
          startAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
        }),
      },
    );
    expect(updateReservedSlotResponse.status).toBe(409);

    const startedStart = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const startedEnd = new Date(startedStart.getTime() + 60 * 60 * 1000);
    const startedSlotResponse = await owner.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: startedStart.toISOString(),
        endAt: startedEnd.toISOString(),
      }),
    });
    expect(startedSlotResponse.status).toBe(200);
    const startedSlotPayload = (await toJson(startedSlotResponse)) as Record<string, unknown>;
    const startedSlotId = startedSlotPayload.id as string;

    await d1
      .prepare('UPDATE slot SET start_at = ?, end_at = ? WHERE id = ?')
      .bind(Date.now() - 10 * 60 * 1000, Date.now() + 20 * 60 * 1000, startedSlotId)
      .run();

    const updateStartedSlotResponse = await owner.request(
      '/api/v1/auth/organizations/slots/update',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: startedSlotId,
          startAt: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString(),
          endAt: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
        }),
      },
    );
    expect(updateStartedSlotResponse.status).toBe(409);
  });

  it('予約と回数券のフローを権限付きで処理する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Booking Owner',
      email: 'booking-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Booking Org',
      slug: 'booking-org',
    });
    await enablePremiumForOrganization(organizationId);

    const adminInvite = await createInvitation({
      agent: owner,
      email: 'booking-admin@example.com',
      role: 'admin',
      organizationId,
    });
    const memberInvite = await createInvitation({
      agent: owner,
      email: 'booking-member@example.com',
      role: 'member',
      organizationId,
    });

    const admin = createAuthAgent(app);
    await signUpUser({
      agent: admin,
      name: 'Booking Admin',
      email: 'booking-admin@example.com',
    });
    const acceptAdminResponse = await admin.request(
      buildInvitationActionPath(adminInvite.payload?.id as string, 'accept'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invitationId: adminInvite.payload?.id,
        }),
      },
    );
    expect(acceptAdminResponse.status).toBe(200);

    const member = createAuthAgent(app);
    await signUpUser({
      agent: member,
      name: 'Booking Member',
      email: 'booking-member@example.com',
    });
    const acceptMemberResponse = await member.request(
      buildInvitationActionPath(memberInvite.payload?.id as string, 'accept'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invitationId: memberInvite.payload?.id,
        }),
      },
    );
    expect(acceptMemberResponse.status).toBe(200);

    const participantInvite = await createParticipantInvitation({
      agent: admin,
      email: 'booking-participant@example.com',
      participantName: 'Booking Participant',
      organizationId,
    });
    expect(participantInvite.response.status).toBe(200);

    const participantUser = createAuthAgent(app);
    await signUpUser({
      agent: participantUser,
      name: 'Booking Participant',
      email: 'booking-participant@example.com',
    });
    const participantAcceptResponse = await participantUser.request(
      buildInvitationActionPath(participantInvite.payload?.id as string, 'accept'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invitationId: participantInvite.payload?.id,
        }),
      },
    );
    expect(participantAcceptResponse.status).toBe(200);

    const forbiddenServiceCreate = await member.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: 'Forbidden Service',
        kind: 'single',
        durationMinutes: 60,
        capacity: 5,
      }),
    });
    expect(forbiddenServiceCreate.status).toBe(403);

    const serviceCreateResponse = await admin.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: 'Ticket Class',
        kind: 'single',
        durationMinutes: 60,
        capacity: 2,
        cancellationDeadlineMinutes: 60,
        requiresTicket: true,
      }),
    });
    expect(serviceCreateResponse.status).toBe(200);
    const servicePayload = (await toJson(serviceCreateResponse)) as Record<string, unknown>;
    const serviceId = servicePayload.id as string;

    const ticketTypeCreateResponse = await admin.request(
      '/api/v1/auth/organizations/ticket-types',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          name: '3 Tickets',
          totalCount: 3,
          serviceIds: [serviceId],
        }),
      },
    );
    expect(ticketTypeCreateResponse.status).toBe(200);
    const ticketTypePayload = (await toJson(ticketTypeCreateResponse)) as Record<string, unknown>;
    const ticketTypeId = ticketTypePayload.id as string;

    const participantId = await selectParticipantIdByEmail(
      organizationId,
      'booking-participant@example.com',
    );
    expect(participantId).toBeTruthy();

    const grantTicketResponse = await admin.request(
      '/api/v1/auth/organizations/ticket-packs/grant',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          participantId,
          ticketTypeId,
          count: 3,
        }),
      },
    );
    expect(grantTicketResponse.status).toBe(200);
    const grantPayload = (await toJson(grantTicketResponse)) as Record<string, unknown>;
    const ticketPackId = grantPayload.id as string;

    const startAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    const slotCreateResponse = await admin.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      }),
    });
    expect(slotCreateResponse.status).toBe(200);
    const slotPayload = (await toJson(slotCreateResponse)) as Record<string, unknown>;
    const slotId = slotPayload.id as string;

    const availableSlotsResponse = await participantUser.request(
      `/api/v1/auth/organizations/slots/available?organizationId=${encodeURIComponent(
        organizationId,
      )}&from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(
        new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      )}`,
    );
    expect(availableSlotsResponse.status).toBe(200);

    const bookingCreateResponse = await participantUser.request(
      '/api/v1/auth/organizations/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId,
        }),
      },
    );
    const bookingCreatePayload = (await toJson(bookingCreateResponse)) as Record<string, unknown>;
    expect(bookingCreateResponse.status, JSON.stringify(bookingCreatePayload)).toBe(200);
    const bookingPayload = bookingCreatePayload;
    const bookingId = bookingPayload.id as string;
    expect(bookingPayload.attendanceStatus).toBe('not_checked');
    expect(await selectSlotReservedCount(slotId)).toBe(1);
    expect(await selectTicketPackRemaining(ticketPackId)).toBe(2);
    expect(await selectTicketLedgerActionCount(ticketPackId, 'consume')).toBe(1);
    expect(await selectBookingAuditActionCount(bookingId, 'created')).toBe(1);

    const duplicateBookingResponse = await participantUser.request(
      '/api/v1/auth/organizations/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId,
        }),
      },
    );
    expect(duplicateBookingResponse.status).toBe(409);

    const cancelBookingResponse = await participantUser.request(
      '/api/v1/auth/organizations/bookings/cancel',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId,
        }),
      },
    );
    expect(cancelBookingResponse.status).toBe(200);
    expect(await selectBookingStatus(bookingId)).toBe('cancelled');
    expect(await selectSlotReservedCount(slotId)).toBe(0);
    expect(await selectTicketPackRemaining(ticketPackId)).toBe(3);
    expect(await selectTicketLedgerActionCount(ticketPackId, 'restore')).toBe(1);
    expect(await selectBookingAuditActionCount(bookingId, 'cancelled_by_customer')).toBe(1);

    const nearStart = new Date(Date.now() + 30 * 60 * 1000);
    const nearEnd = new Date(nearStart.getTime() + 60 * 60 * 1000);
    const nearSlotCreateResponse = await admin.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: nearStart.toISOString(),
        endAt: nearEnd.toISOString(),
      }),
    });
    expect(nearSlotCreateResponse.status).toBe(200);
    const nearSlotPayload = (await toJson(nearSlotCreateResponse)) as Record<string, unknown>;
    const nearSlotId = nearSlotPayload.id as string;

    const secondBookingResponse = await participantUser.request(
      '/api/v1/auth/organizations/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: nearSlotId,
        }),
      },
    );
    expect(secondBookingResponse.status).toBe(200);
    const secondBookingPayload = (await toJson(secondBookingResponse)) as Record<string, unknown>;
    const secondBookingId = secondBookingPayload.id as string;
    expect(await selectTicketPackRemaining(ticketPackId)).toBe(2);

    const lateCancelResponse = await participantUser.request(
      '/api/v1/auth/organizations/bookings/cancel',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: secondBookingId,
        }),
      },
    );
    expect(lateCancelResponse.status).toBe(409);

    const staffCancelResponse = await admin.request(
      '/api/v1/auth/organizations/bookings/cancel-by-staff',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: secondBookingId,
        }),
      },
    );
    expect(staffCancelResponse.status).toBe(200);
    expect(await selectBookingStatus(secondBookingId)).toBe('cancelled');
    expect(await selectTicketPackRemaining(ticketPackId)).toBe(2);
    expect(await selectBookingAuditActionCount(secondBookingId, 'cancelled_by_staff')).toBe(1);

    const thirdStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const thirdEnd = new Date(thirdStart.getTime() + 60 * 60 * 1000);
    const thirdSlotCreateResponse = await admin.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: thirdStart.toISOString(),
        endAt: thirdEnd.toISOString(),
      }),
    });
    expect(thirdSlotCreateResponse.status).toBe(200);
    const thirdSlotPayload = (await toJson(thirdSlotCreateResponse)) as Record<string, unknown>;
    const thirdSlotId = thirdSlotPayload.id as string;

    const thirdBookingResponse = await participantUser.request(
      '/api/v1/auth/organizations/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: thirdSlotId,
        }),
      },
    );
    expect(thirdBookingResponse.status).toBe(200);
    const thirdBookingPayload = (await toJson(thirdBookingResponse)) as Record<string, unknown>;
    const thirdBookingId = thirdBookingPayload.id as string;

    const rescheduleStart = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const rescheduleEnd = new Date(rescheduleStart.getTime() + 60 * 60 * 1000);
    const rescheduleSlotCreateResponse = await admin.request('/api/v1/auth/organizations/slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        serviceId,
        startAt: rescheduleStart.toISOString(),
        endAt: rescheduleEnd.toISOString(),
      }),
    });
    expect(rescheduleSlotCreateResponse.status).toBe(200);
    const rescheduleSlotPayload = (await toJson(rescheduleSlotCreateResponse)) as Record<
      string,
      unknown
    >;
    const rescheduleSlotId = rescheduleSlotPayload.id as string;

    const rescheduleResponse = await admin.request(
      '/api/v1/auth/organizations/bookings/reschedule',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: thirdBookingId,
          targetSlotId: rescheduleSlotId,
          reason: '参加者希望',
        }),
      },
    );
    expect(rescheduleResponse.status).toBe(200);
    expect(await selectBookingStatus(thirdBookingId)).toBe('confirmed');
    expect(await selectBookingSlotId(thirdBookingId)).toBe(rescheduleSlotId);
    expect(await selectSlotReservedCount(thirdSlotId)).toBe(0);
    expect(await selectSlotReservedCount(rescheduleSlotId)).toBe(1);
    expect(await selectBookingChangeLogCount(thirdBookingId)).toBe(1);
    expect(await selectBookingAuditActionCount(thirdBookingId, 'rescheduled')).toBe(1);
    expect(
      await selectNotificationLogEventCount(thirdBookingId, 'booking_rescheduled'),
    ).toBeGreaterThan(0);

    const checkInResponse = await admin.request('/api/v1/auth/organizations/bookings/check-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: thirdBookingId,
        attendanceStatus: 'checked_in',
      }),
    });
    expect(checkInResponse.status).toBe(200);
    expect(await selectBookingStatus(thirdBookingId)).toBe('completed');
    const checkedInAttendance = await selectBookingAttendance(thirdBookingId);
    expect(checkedInAttendance?.attendanceStatus).toBe('checked_in');
    expect(checkedInAttendance?.attendanceMarkedAt).toBeTruthy();
    expect(checkedInAttendance?.attendanceMarkedByUserId).toBeTruthy();
    expect(await selectBookingAuditActionCount(thirdBookingId, 'checked_in')).toBe(1);

    const absentResponse = await admin.request('/api/v1/auth/organizations/bookings/check-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: thirdBookingId,
        attendanceStatus: 'absent',
      }),
    });
    expect(absentResponse.status).toBe(200);
    expect((await selectBookingAttendance(thirdBookingId))?.attendanceStatus).toBe('absent');

    const resetAttendanceResponse = await admin.request(
      '/api/v1/auth/organizations/bookings/check-in',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: thirdBookingId,
          attendanceStatus: 'not_checked',
        }),
      },
    );
    expect(resetAttendanceResponse.status).toBe(200);
    const resetAttendance = await selectBookingAttendance(thirdBookingId);
    expect(resetAttendance?.attendanceStatus).toBe('not_checked');
    expect(resetAttendance?.attendanceMarkedAt).toBeNull();
    expect(resetAttendance?.attendanceMarkedByUserId).toBeNull();
    expect(await selectBookingStatus(thirdBookingId)).toBe('confirmed');
    expect(await selectBookingAuditActionCount(thirdBookingId, 'checked_in')).toBe(1);

    const noShowResponse = await admin.request('/api/v1/auth/organizations/bookings/no-show', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: thirdBookingId,
      }),
    });
    expect(noShowResponse.status).toBe(200);
    expect(await selectBookingStatus(thirdBookingId)).toBe('no_show');
    expect((await selectBookingAttendance(thirdBookingId))?.attendanceStatus).toBe('no_show');
    expect(await selectBookingAuditActionCount(thirdBookingId, 'no_show_marked')).toBe(1);

    const checkInNoShowResponse = await admin.request(
      '/api/v1/auth/organizations/bookings/check-in',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: thirdBookingId,
          attendanceStatus: 'checked_in',
        }),
      },
    );
    expect(checkInNoShowResponse.status).toBe(409);

    const noShowTwiceResponse = await admin.request('/api/v1/auth/organizations/bookings/no-show', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: thirdBookingId,
      }),
    });
    expect(noShowTwiceResponse.status).toBe(409);

    const rescheduleNoShowResponse = await admin.request(
      '/api/v1/auth/organizations/bookings/reschedule',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: thirdBookingId,
          targetSlotId: thirdSlotId,
        }),
      },
    );
    expect(rescheduleNoShowResponse.status).toBe(409);
  });

  it('回数券消費時に発行済み回数券パックのサービススコープを適用する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Scoped Ticket Owner',
      email: 'scoped-ticket-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Scoped Ticket Org',
      slug: 'scoped-ticket-org',
    });
    await enablePremiumForOrganization(organizationId);

    const emptySpecificResponse = await owner.request('/api/v1/auth/organizations/ticket-types', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: 'Empty Specific Ticket',
        totalCount: 1,
        serviceScope: 'specific',
        serviceIds: [],
      }),
    });
    expect(emptySpecificResponse.status).toBe(400);

    const participantInvite = await createParticipantInvitation({
      agent: owner,
      email: 'scoped-ticket-participant@example.com',
      participantName: 'Scoped Ticket Participant',
      organizationId,
    });
    expect(participantInvite.response.status).toBe(200);

    const participantUser = createAuthAgent(app);
    await signUpUser({
      agent: participantUser,
      name: 'Scoped Ticket Participant',
      email: 'scoped-ticket-participant@example.com',
    });
    const participantAcceptResponse = await participantUser.request(
      buildInvitationActionPath(participantInvite.payload?.id as string, 'accept'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invitationId: participantInvite.payload?.id,
        }),
      },
    );
    expect(participantAcceptResponse.status).toBe(200);

    const createTicketRequiredService = async (name: string) => {
      const response = await owner.request('/api/v1/auth/organizations/services', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          name,
          kind: 'single',
          durationMinutes: 60,
          capacity: 3,
          cancellationDeadlineMinutes: 60,
          requiresTicket: true,
        }),
      });
      expect(response.status).toBe(200);
      const payload = (await toJson(response)) as Record<string, unknown>;
      return payload.id as string;
    };

    const createSlot = async (serviceId: string, offsetMs: number) => {
      const startAt = new Date(Date.now() + offsetMs);
      const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
      const response = await owner.request('/api/v1/auth/organizations/slots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          serviceId,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
        }),
      });
      expect(response.status).toBe(200);
      const payload = (await toJson(response)) as Record<string, unknown>;
      return payload.id as string;
    };

    const serviceAId = await createTicketRequiredService('Scoped Service A');
    const serviceBId = await createTicketRequiredService('Scoped Service B');

    const ticketTypeCreateResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-types',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          name: 'Service A Tickets',
          totalCount: 2,
          serviceScope: 'specific',
          serviceIds: [serviceAId],
        }),
      },
    );
    expect(ticketTypeCreateResponse.status).toBe(200);
    const ticketTypePayload = (await toJson(ticketTypeCreateResponse)) as Record<string, unknown>;
    const ticketTypeId = ticketTypePayload.id as string;
    expect(ticketTypePayload.serviceScope).toBe('specific');
    expect(ticketTypePayload.serviceIds).toEqual([serviceAId]);

    const participantId = await selectParticipantIdByEmail(
      organizationId,
      'scoped-ticket-participant@example.com',
    );
    expect(participantId).toBeTruthy();

    const grantSpecificResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-packs/grant',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          participantId,
          ticketTypeId,
          count: 2,
        }),
      },
    );
    expect(grantSpecificResponse.status).toBe(200);
    const grantSpecificPayload = (await toJson(grantSpecificResponse)) as Record<string, unknown>;
    const specificPackId = grantSpecificPayload.id as string;
    expect(grantSpecificPayload.serviceScope).toBe('specific');
    expect(grantSpecificPayload.serviceIds).toEqual([serviceAId]);

    const updateAllResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-types/update',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          ticketTypeId,
          serviceScope: 'all',
        }),
      },
    );
    expect(updateAllResponse.status).toBe(200);
    const updateAllPayload = (await toJson(updateAllResponse)) as Record<string, unknown>;
    expect(updateAllPayload.serviceScope).toBe('all');
    expect(updateAllPayload.serviceIds).toEqual([]);

    const serviceBSlotId = await createSlot(serviceBId, 3 * 24 * 60 * 60 * 1000);
    const serviceBBookingResponse = await participantUser.request(
      '/api/v1/auth/organizations/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: serviceBSlotId,
        }),
      },
    );
    expect(serviceBBookingResponse.status).toBe(409);
    expect(await selectSlotReservedCount(serviceBSlotId)).toBe(0);
    expect(await selectTicketPackRemaining(specificPackId)).toBe(2);

    const serviceASlotId = await createSlot(serviceAId, 4 * 24 * 60 * 60 * 1000);
    const serviceABookingResponse = await participantUser.request(
      '/api/v1/auth/organizations/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: serviceASlotId,
        }),
      },
    );
    expect(serviceABookingResponse.status).toBe(200);
    expect(await selectTicketPackRemaining(specificPackId)).toBe(1);

    const grantAllResponse = await owner.request('/api/v1/auth/organizations/ticket-packs/grant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        participantId,
        ticketTypeId,
        count: 1,
      }),
    });
    expect(grantAllResponse.status).toBe(200);
    const grantAllPayload = (await toJson(grantAllResponse)) as Record<string, unknown>;
    const allPackId = grantAllPayload.id as string;
    expect(grantAllPayload.serviceScope).toBe('all');
    expect(grantAllPayload.serviceIds).toEqual([]);

    const serviceCId = await createTicketRequiredService('Scoped Service C');
    const serviceCSlotId = await createSlot(serviceCId, 5 * 24 * 60 * 60 * 1000);
    const serviceCBookingResponse = await participantUser.request(
      '/api/v1/auth/organizations/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: serviceCSlotId,
        }),
      },
    );
    expect(serviceCBookingResponse.status).toBe(200);
    expect(await selectTicketPackRemaining(specificPackId)).toBe(1);
    expect(await selectTicketPackRemaining(allPackId)).toBe(0);
  });

  it('回数券購入の承認・拒否・参加者キャンセルフローを処理する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Ticket Purchase Owner',
      email: 'ticket-purchase-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Ticket Purchase Org',
      slug: 'ticket-purchase-org',
    });
    await enablePremiumForOrganization(organizationId);

    const participantInvite = await createParticipantInvitation({
      agent: owner,
      email: 'ticket-purchase-participant@example.com',
      participantName: 'Ticket Purchase Participant',
      organizationId,
    });
    expect(participantInvite.response.status).toBe(200);

    const participantUser = createAuthAgent(app);
    await signUpUser({
      agent: participantUser,
      name: 'Ticket Purchase Participant',
      email: 'ticket-purchase-participant@example.com',
    });
    const participantAcceptResponse = await participantUser.request(
      buildInvitationActionPath(participantInvite.payload?.id as string, 'accept'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invitationId: participantInvite.payload?.id,
        }),
      },
    );
    expect(participantAcceptResponse.status).toBe(200);

    const purchaseServiceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: 'Purchase Ticket Service',
        kind: 'single',
        durationMinutes: 60,
        capacity: 5,
        requiresTicket: true,
      }),
    });
    expect(purchaseServiceResponse.status).toBe(200);
    const purchaseServicePayload = (await toJson(purchaseServiceResponse)) as Record<
      string,
      unknown
    >;
    const purchaseServiceId = purchaseServicePayload.id as string;

    const ticketTypeCreateResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-types',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          name: 'Purchase Ticket',
          totalCount: 5,
          serviceScope: 'specific',
          serviceIds: [purchaseServiceId],
          isForSale: true,
        }),
      },
    );
    expect(ticketTypeCreateResponse.status).toBe(200);
    const ticketTypePayload = (await toJson(ticketTypeCreateResponse)) as Record<string, unknown>;
    const ticketTypeId = ticketTypePayload.id as string;
    expect(ticketTypePayload.serviceScope).toBe('specific');
    expect(ticketTypePayload.serviceIds).toEqual([purchaseServiceId]);
    expect(ticketTypePayload.stripePriceId).toBeNull();

    const participantId = await selectParticipantIdByEmail(
      organizationId,
      'ticket-purchase-participant@example.com',
    );
    expect(participantId).toBeTruthy();

    const stripePurchaseResponse = await participantUser.request(
      '/api/v1/auth/organizations/ticket-purchases',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          ticketTypeId,
          paymentMethod: 'stripe',
        }),
      },
    );
    expect(stripePurchaseResponse.status).toBe(422);
    const stripePurchasePayload = (await toJson(stripePurchaseResponse)) as Record<string, unknown>;
    expect(stripePurchasePayload.message).toBe(
      'Ticket purchase Stripe payment is currently unavailable.',
    );
    expect(
      await countTicketPurchasesForParticipantAndType(participantId as string, ticketTypeId),
    ).toBe(0);

    const bankPurchaseResponse = await participantUser.request(
      '/api/v1/auth/organizations/ticket-purchases',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          ticketTypeId,
          paymentMethod: 'bank_transfer',
        }),
      },
    );
    expect(bankPurchaseResponse.status).toBe(200);
    const bankPurchasePayload = (await toJson(bankPurchaseResponse)) as Record<string, unknown>;
    const bankPurchaseId = bankPurchasePayload.id as string;
    expect(bankPurchasePayload.status).toBe('pending_approval');
    expect(bankPurchasePayload.serviceScope).toBe('specific');
    expect(bankPurchasePayload.serviceIds).toEqual([purchaseServiceId]);

    const updateTicketTypeScopeResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-types/update',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          ticketTypeId,
          serviceScope: 'all',
        }),
      },
    );
    expect(updateTicketTypeScopeResponse.status).toBe(200);
    const updateTicketTypeScopePayload = (await toJson(updateTicketTypeScopeResponse)) as Record<
      string,
      unknown
    >;
    expect(updateTicketTypeScopePayload.serviceScope).toBe('all');
    expect(updateTicketTypeScopePayload.serviceIds).toEqual([]);

    const approveResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-purchases/approve',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purchaseId: bankPurchaseId,
        }),
      },
    );
    expect(approveResponse.status).toBe(200);
    const approvedPurchase = await selectTicketPurchaseRow(bankPurchaseId);
    expect(approvedPurchase?.status).toBe('approved');
    expect(JSON.parse(approvedPurchase?.serviceIdsJson ?? '[]')).toEqual([purchaseServiceId]);
    expect(approvedPurchase?.ticketPackId).toBeTruthy();
    const approvedPack = await selectTicketPackRow(approvedPurchase?.ticketPackId as string);
    expect(JSON.parse(approvedPack?.serviceIdsJson ?? '[]')).toEqual([purchaseServiceId]);
    expect(await countTicketPacksForParticipantAndType(participantId as string, ticketTypeId)).toBe(
      1,
    );

    const approveAgainResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-purchases/approve',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purchaseId: bankPurchaseId,
        }),
      },
    );
    expect(approveAgainResponse.status).toBe(409);

    const cashPurchaseResponse = await participantUser.request(
      '/api/v1/auth/organizations/ticket-purchases',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          ticketTypeId,
          paymentMethod: 'cash_on_site',
        }),
      },
    );
    expect(cashPurchaseResponse.status).toBe(200);
    const cashPurchasePayload = (await toJson(cashPurchaseResponse)) as Record<string, unknown>;
    const cashPurchaseId = cashPurchasePayload.id as string;
    expect(cashPurchasePayload.status).toBe('pending_approval');

    const rejectResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-purchases/reject',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purchaseId: cashPurchaseId,
          reason: '入金確認ができませんでした',
        }),
      },
    );
    expect(rejectResponse.status).toBe(200);
    const rejectedPurchase = await selectTicketPurchaseRow(cashPurchaseId);
    expect(rejectedPurchase?.status).toBe('rejected');
    expect(await countTicketPacksForParticipantAndType(participantId as string, ticketTypeId)).toBe(
      1,
    );

    const anotherPurchaseResponse = await participantUser.request(
      '/api/v1/auth/organizations/ticket-purchases',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          ticketTypeId,
          paymentMethod: 'bank_transfer',
        }),
      },
    );
    expect(anotherPurchaseResponse.status).toBe(200);
    const anotherPurchasePayload = (await toJson(anotherPurchaseResponse)) as Record<
      string,
      unknown
    >;
    const anotherPurchaseId = anotherPurchasePayload.id as string;
    expect(anotherPurchasePayload.status).toBe('pending_approval');

    const cancelResponse = await participantUser.request(
      '/api/v1/auth/organizations/ticket-purchases/cancel',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purchaseId: anotherPurchaseId,
        }),
      },
    );
    expect(cancelResponse.status).toBe(200);
    const canceledPurchase = await selectTicketPurchaseRow(anotherPurchaseId);
    expect(canceledPurchase?.status).toBe('cancelled_by_participant');

    const cancelApprovedResponse = await participantUser.request(
      '/api/v1/auth/organizations/ticket-purchases/cancel',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purchaseId: bankPurchaseId,
        }),
      },
    );
    expect(cancelApprovedResponse.status).toBe(409);

    const participantApproveForbidden = await participantUser.request(
      '/api/v1/auth/organizations/ticket-purchases/approve',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purchaseId: bankPurchaseId,
        }),
      },
    );
    expect(participantApproveForbidden.status).toBe(403);
  });

  it('履歴を削除せず回数券種別を更新し発行済み回数券パックを調整する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Ticket Edit Owner',
      email: 'ticket-edit-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Ticket Edit Org',
      slug: 'ticket-edit-org',
    });
    await enablePremiumForOrganization(organizationId);

    const serviceCreateResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: 'Ticket Edit Service',
        kind: 'single',
        durationMinutes: 60,
        capacity: 3,
      }),
    });
    expect(serviceCreateResponse.status).toBe(200);
    const servicePayload = (await toJson(serviceCreateResponse)) as Record<string, unknown>;
    const serviceId = servicePayload.id as string;

    const participantInvite = await createParticipantInvitation({
      agent: owner,
      email: 'ticket-edit-participant@example.com',
      participantName: 'Ticket Edit Participant',
      organizationId,
    });
    expect(participantInvite.response.status).toBe(200);

    const participantUser = createAuthAgent(app);
    await signUpUser({
      agent: participantUser,
      name: 'Ticket Edit Participant',
      email: 'ticket-edit-participant@example.com',
    });
    const participantAcceptResponse = await participantUser.request(
      buildInvitationActionPath(participantInvite.payload?.id as string, 'accept'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invitationId: participantInvite.payload?.id,
        }),
      },
    );
    expect(participantAcceptResponse.status).toBe(200);

    const participantId = await selectParticipantIdByEmail(
      organizationId,
      'ticket-edit-participant@example.com',
    );
    expect(participantId).toBeTruthy();

    const ticketTypeCreateResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-types',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          name: 'Editable Ticket',
          totalCount: 5,
          expiresInDays: 30,
          serviceIds: [serviceId],
          isForSale: true,
        }),
      },
    );
    expect(ticketTypeCreateResponse.status).toBe(200);
    const ticketTypePayload = (await toJson(ticketTypeCreateResponse)) as Record<string, unknown>;
    const ticketTypeId = ticketTypePayload.id as string;

    const grantTicketResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-packs/grant',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          participantId,
          ticketTypeId,
        }),
      },
    );
    expect(grantTicketResponse.status).toBe(200);
    const grantPayload = (await toJson(grantTicketResponse)) as Record<string, unknown>;
    const ticketPackId = grantPayload.id as string;

    const listPacksResponse = await owner.request(
      `/api/v1/auth/organizations/ticket-packs?organizationId=${encodeURIComponent(
        organizationId,
      )}&participantId=${encodeURIComponent(participantId as string)}`,
    );
    expect(listPacksResponse.status).toBe(200);
    const listPacksPayload = (await toJson(listPacksResponse)) as Array<Record<string, unknown>>;
    expect(listPacksPayload.map((pack) => pack.id)).toContain(ticketPackId);

    const participantAdjustResponse = await participantUser.request(
      '/api/v1/auth/organizations/ticket-packs/adjust',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ticketPackId,
          remainingCount: 2,
          reason: 'participant-forbidden',
        }),
      },
    );
    expect(participantAdjustResponse.status).toBe(403);

    const tooLargeAdjustResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-packs/adjust',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ticketPackId,
          remainingCount: 6,
          reason: 'too-large',
        }),
      },
    );
    expect(tooLargeAdjustResponse.status).toBe(422);

    const adjustedExpiresAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    const adjustResponse = await owner.request('/api/v1/auth/organizations/ticket-packs/adjust', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ticketPackId,
        remainingCount: 2,
        expiresAt: adjustedExpiresAt,
        reason: 'manual correction',
      }),
    });
    expect(adjustResponse.status).toBe(200);
    const adjustPayload = (await toJson(adjustResponse)) as Record<string, unknown>;
    expect(adjustPayload.remainingCount).toBe(2);
    expect(adjustPayload.status).toBe('active');
    expect(await selectTicketLedgerActionCount(ticketPackId, 'adjust')).toBe(1);

    const updateTypeResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-types/update',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          ticketTypeId,
          name: 'Updated Ticket',
          totalCount: 8,
          expiresInDays: null,
          serviceIds: [],
          isForSale: false,
        }),
      },
    );
    expect(updateTypeResponse.status).toBe(200);
    const updateTypePayload = (await toJson(updateTypeResponse)) as Record<string, unknown>;
    expect(updateTypePayload.name).toBe('Updated Ticket');
    expect(updateTypePayload.totalCount).toBe(8);
    expect(updateTypePayload.expiresInDays).toBeNull();
    expect(updateTypePayload.serviceIds).toEqual([]);
    expect(updateTypePayload.isForSale).toBe(false);

    const packAfterTypeUpdate = await selectTicketPackRow(ticketPackId);
    expect(Number(packAfterTypeUpdate?.initialCount ?? 0)).toBe(5);
    expect(Number(packAfterTypeUpdate?.remainingCount ?? 0)).toBe(2);

    const purchaseStoppedResponse = await participantUser.request(
      '/api/v1/auth/organizations/ticket-purchases',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          ticketTypeId,
          paymentMethod: 'cash_on_site',
        }),
      },
    );
    expect(purchaseStoppedResponse.status).toBe(409);

    const deactivateResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-types/update',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          ticketTypeId,
          isActive: false,
        }),
      },
    );
    expect(deactivateResponse.status).toBe(200);
    const deactivatePayload = (await toJson(deactivateResponse)) as Record<string, unknown>;
    expect(deactivatePayload.isActive).toBe(false);

    const grantInactiveResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-packs/grant',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          participantId,
          ticketTypeId,
        }),
      },
    );
    expect(grantInactiveResponse.status).toBe(409);
    const grantInactivePayload = (await toJson(grantInactiveResponse)) as Record<string, unknown>;
    expect(grantInactivePayload.message).toBe('Ticket type is inactive.');

    const purchasableResponse = await participantUser.request(
      `/api/v1/auth/organizations/ticket-types/purchasable?organizationId=${encodeURIComponent(
        organizationId,
      )}`,
    );
    expect(purchasableResponse.status).toBe(200);
    const purchasablePayload = (await toJson(purchasableResponse)) as Array<
      Record<string, unknown>
    >;
    expect(purchasablePayload.some((ticketType) => ticketType.id === ticketTypeId)).toBe(false);
  });

  it('旧 Stripe 回数券購入 Webhook を冪等に処理する', async () => {
    const stripeWebhookSecret = 'whsec_test_dummy';
    const authRuntimeWithStripe = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithStripe = createApp(authRuntimeWithStripe);

    const owner = createAuthAgent(appWithStripe);
    await signUpUser({
      agent: owner,
      name: 'Stripe Purchase Owner',
      email: 'stripe-purchase-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Stripe Purchase Org',
      slug: 'stripe-purchase-org',
    });
    await enablePremiumForOrganization(organizationId);

    const participantInvite = await createParticipantInvitation({
      agent: owner,
      email: 'stripe-purchase-participant@example.com',
      participantName: 'Stripe Purchase Participant',
      organizationId,
    });
    expect(participantInvite.response.status).toBe(200);

    const participantUser = createAuthAgent(appWithStripe);
    await signUpUser({
      agent: participantUser,
      name: 'Stripe Purchase Participant',
      email: 'stripe-purchase-participant@example.com',
    });
    const participantAcceptResponse = await participantUser.request(
      buildInvitationActionPath(participantInvite.payload?.id as string, 'accept'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invitationId: participantInvite.payload?.id,
        }),
      },
    );
    expect(participantAcceptResponse.status).toBe(200);

    const ticketTypeCreateResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-types',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          name: 'Stripe Ticket',
          totalCount: 4,
          isForSale: true,
          stripePriceId: 'price_test_webhook',
        }),
      },
    );
    expect(ticketTypeCreateResponse.status).toBe(200);
    const ticketTypePayload = (await toJson(ticketTypeCreateResponse)) as Record<string, unknown>;
    const ticketTypeId = ticketTypePayload.id as string;
    const storeId = ticketTypePayload.storeId as string;

    const participantId = await selectParticipantIdByEmail(
      organizationId,
      'stripe-purchase-participant@example.com',
    );
    expect(participantId).toBeTruthy();

    const purchaseId = crypto.randomUUID();
    await d1
      .prepare(
        'INSERT INTO ticket_purchase (id, organization_id, store_id, participant_id, ticket_type_id, payment_method, status, stripe_checkout_session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        purchaseId,
        organizationId,
        storeId,
        participantId as string,
        ticketTypeId,
        'stripe',
        'pending_payment',
        'cs_test_ticket_purchase',
      )
      .run();

    const purchaseBeforeWebhook = await selectTicketPurchaseRow(purchaseId);
    expect(purchaseBeforeWebhook?.stripeCheckoutSessionId).toBe('cs_test_ticket_purchase');

    const webhookPayload = JSON.stringify({
      id: 'evt_test_checkout_completed',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_ticket_purchase',
          metadata: {
            purchaseId,
          },
        },
      },
    });
    const validSignatureHeader = await createStripeSignatureHeader(
      webhookPayload,
      stripeWebhookSecret,
    );

    const webhookResponse = await appWithStripe.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': validSignatureHeader,
      },
      body: webhookPayload,
    });
    expect(webhookResponse.status).toBe(200);

    const purchaseAfterWebhook = await selectTicketPurchaseRow(purchaseId);
    expect(purchaseAfterWebhook?.status).toBe('approved');
    expect(purchaseAfterWebhook?.ticketPackId).toBeTruthy();
    expect(await countTicketPacksForParticipantAndType(participantId as string, ticketTypeId)).toBe(
      1,
    );

    const webhookDuplicateResponse = await appWithStripe.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': validSignatureHeader,
      },
      body: webhookPayload,
    });
    expect(webhookDuplicateResponse.status).toBe(200);
    expect(await countTicketPacksForParticipantAndType(participantId as string, ticketTypeId)).toBe(
      1,
    );

    const invalidSignatureResponse = await appWithStripe.request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1,v1=invalid',
      },
      body: webhookPayload,
    });
    expect(invalidSignatureResponse.status).toBe(400);
  });

  it('承認制予約ポリシーフローを処理する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Approval Owner',
      email: 'approval-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Approval Org',
      slug: 'approval-org',
    });
    await enablePremiumForOrganization(organizationId);

    const participantInvite1 = await createParticipantInvitation({
      agent: owner,
      email: 'approval-participant-1@example.com',
      participantName: 'Approval Participant 1',
      organizationId,
    });
    expect(participantInvite1.response.status).toBe(200);
    const participantInvite2 = await createParticipantInvitation({
      agent: owner,
      email: 'approval-participant-2@example.com',
      participantName: 'Approval Participant 2',
      organizationId,
    });
    expect(participantInvite2.response.status).toBe(200);

    const participantUser1 = createAuthAgent(app);
    await signUpUser({
      agent: participantUser1,
      name: 'Approval Participant 1',
      email: 'approval-participant-1@example.com',
    });
    const participantAcceptResponse1 = await participantUser1.request(
      buildInvitationActionPath(participantInvite1.payload?.id as string, 'accept'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invitationId: participantInvite1.payload?.id,
        }),
      },
    );
    expect(participantAcceptResponse1.status).toBe(200);

    const participantUser2 = createAuthAgent(app);
    await signUpUser({
      agent: participantUser2,
      name: 'Approval Participant 2',
      email: 'approval-participant-2@example.com',
    });
    const participantAcceptResponse2 = await participantUser2.request(
      buildInvitationActionPath(participantInvite2.payload?.id as string, 'accept'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invitationId: participantInvite2.payload?.id,
        }),
      },
    );
    expect(participantAcceptResponse2.status).toBe(200);

    const approvalServiceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: 'Approval Ticket Service',
        kind: 'single',
        durationMinutes: 60,
        capacity: 2,
        cancellationDeadlineMinutes: 60,
        bookingPolicy: 'approval',
        requiresTicket: true,
      }),
    });
    expect(approvalServiceResponse.status).toBe(200);
    const approvalServicePayload = (await toJson(approvalServiceResponse)) as Record<
      string,
      unknown
    >;
    const approvalServiceId = approvalServicePayload.id as string;

    const ticketTypeCreateResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-types',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          name: 'Approval Tickets',
          totalCount: 2,
          serviceIds: [approvalServiceId],
        }),
      },
    );
    expect(ticketTypeCreateResponse.status).toBe(200);
    const ticketTypePayload = (await toJson(ticketTypeCreateResponse)) as Record<string, unknown>;
    const ticketTypeId = ticketTypePayload.id as string;

    const participantId1 = await selectParticipantIdByEmail(
      organizationId,
      'approval-participant-1@example.com',
    );
    expect(participantId1).toBeTruthy();

    const grantTicketResponse = await owner.request(
      '/api/v1/auth/organizations/ticket-packs/grant',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          participantId: participantId1,
          ticketTypeId,
          count: 2,
        }),
      },
    );
    expect(grantTicketResponse.status).toBe(200);
    const grantPayload = (await toJson(grantTicketResponse)) as Record<string, unknown>;
    const ticketPackId = grantPayload.id as string;
    await syncOrganizationBillingV2FixtureFromLegacyRow(organizationId);

    const makeSlot = async (serviceId: string, offsetMs: number) => {
      const startAt = new Date(Date.now() + offsetMs);
      const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
      const slotResponse = await owner.request('/api/v1/auth/organizations/slots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          serviceId,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
        }),
      });
      expect(slotResponse.status).toBe(200);
      const slotPayload = (await toJson(slotResponse)) as Record<string, unknown>;
      return slotPayload.id as string;
    };

    const approvalSlotId = await makeSlot(approvalServiceId, 3 * 24 * 60 * 60 * 1000);
    const pendingCreateResponse = await participantUser1.request(
      '/api/v1/auth/organizations/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: approvalSlotId,
        }),
      },
    );
    expect(pendingCreateResponse.status).toBe(200);
    const pendingCreatePayload = (await toJson(pendingCreateResponse)) as Record<string, unknown>;
    const pendingBookingId = pendingCreatePayload.id as string;
    expect(pendingCreatePayload.status).toBe('pending_approval');
    expect(await selectBookingStatus(pendingBookingId)).toBe('pending_approval');
    expect(await selectSlotReservedCount(approvalSlotId)).toBe(0);
    expect(await selectTicketPackRemaining(ticketPackId)).toBe(2);

    const approveResponse = await owner.request('/api/v1/auth/organizations/bookings/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: pendingBookingId,
      }),
    });
    expect(approveResponse.status).toBe(200);
    expect(await selectBookingStatus(pendingBookingId)).toBe('confirmed');
    expect(await selectSlotReservedCount(approvalSlotId)).toBe(1);
    expect(await selectTicketPackRemaining(ticketPackId)).toBe(1);
    expect(await selectTicketLedgerActionCount(ticketPackId, 'consume')).toBe(1);
    expect(await selectBookingAuditActionCount(pendingBookingId, 'approved')).toBe(1);

    const approveAgainResponse = await owner.request(
      '/api/v1/auth/organizations/bookings/approve',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: pendingBookingId,
        }),
      },
    );
    expect(approveAgainResponse.status).toBe(409);
    const rejectConfirmedResponse = await owner.request(
      '/api/v1/auth/organizations/bookings/reject',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: pendingBookingId,
        }),
      },
    );
    expect(rejectConfirmedResponse.status).toBe(409);

    const nearSlotId = await makeSlot(approvalServiceId, 10 * 60 * 1000);
    const nearPendingResponse = await participantUser1.request(
      '/api/v1/auth/organizations/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: nearSlotId,
        }),
      },
    );
    expect(nearPendingResponse.status).toBe(200);
    const nearPendingPayload = (await toJson(nearPendingResponse)) as Record<string, unknown>;
    const nearPendingBookingId = nearPendingPayload.id as string;
    expect(nearPendingPayload.status).toBe('pending_approval');

    const cancelPendingResponse = await participantUser1.request(
      '/api/v1/auth/organizations/bookings/cancel',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: nearPendingBookingId,
        }),
      },
    );
    expect(cancelPendingResponse.status).toBe(200);
    expect(await selectBookingStatus(nearPendingBookingId)).toBe('cancelled');
    expect(await selectSlotReservedCount(nearSlotId)).toBe(0);
    expect(await selectTicketPackRemaining(ticketPackId)).toBe(1);

    const rejectSlotId = await makeSlot(approvalServiceId, 4 * 24 * 60 * 60 * 1000);
    const rejectPendingResponse = await participantUser1.request(
      '/api/v1/auth/organizations/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: rejectSlotId,
        }),
      },
    );
    expect(rejectPendingResponse.status).toBe(200);
    const rejectPendingPayload = (await toJson(rejectPendingResponse)) as Record<string, unknown>;
    const rejectPendingBookingId = rejectPendingPayload.id as string;
    expect(rejectPendingPayload.status).toBe('pending_approval');

    const rejectResponse = await owner.request('/api/v1/auth/organizations/bookings/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: rejectPendingBookingId,
        reason: '運営都合',
      }),
    });
    expect(rejectResponse.status).toBe(200);
    expect(await selectBookingStatus(rejectPendingBookingId)).toBe('rejected');
    expect(await selectBookingAuditActionCount(rejectPendingBookingId, 'rejected')).toBe(1);

    const rejectAgainResponse = await owner.request('/api/v1/auth/organizations/bookings/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bookingId: rejectPendingBookingId,
      }),
    });
    expect(rejectAgainResponse.status).toBe(409);

    const approvalCapacityServiceResponse = await owner.request(
      '/api/v1/auth/organizations/services',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          name: 'Approval Capacity Service',
          kind: 'single',
          durationMinutes: 60,
          capacity: 1,
          bookingPolicy: 'approval',
          requiresTicket: false,
        }),
      },
    );
    expect(approvalCapacityServiceResponse.status).toBe(200);
    const approvalCapacityServicePayload = (await toJson(
      approvalCapacityServiceResponse,
    )) as Record<string, unknown>;
    const approvalCapacityServiceId = approvalCapacityServicePayload.id as string;

    const capacitySlotId = await makeSlot(approvalCapacityServiceId, 5 * 24 * 60 * 60 * 1000);
    const capacityPendingResponse1 = await participantUser1.request(
      '/api/v1/auth/organizations/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: capacitySlotId,
        }),
      },
    );
    expect(capacityPendingResponse1.status).toBe(200);
    const capacityPendingPayload1 = (await toJson(capacityPendingResponse1)) as Record<
      string,
      unknown
    >;
    const capacityBookingId1 = capacityPendingPayload1.id as string;
    expect(capacityPendingPayload1.status).toBe('pending_approval');

    const capacityPendingResponse2 = await participantUser2.request(
      '/api/v1/auth/organizations/bookings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slotId: capacitySlotId,
        }),
      },
    );
    expect(capacityPendingResponse2.status).toBe(200);
    const capacityPendingPayload2 = (await toJson(capacityPendingResponse2)) as Record<
      string,
      unknown
    >;
    const capacityBookingId2 = capacityPendingPayload2.id as string;
    expect(capacityPendingPayload2.status).toBe('pending_approval');

    const approveCapacityFirst = await owner.request(
      '/api/v1/auth/organizations/bookings/approve',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: capacityBookingId1,
        }),
      },
    );
    expect(approveCapacityFirst.status).toBe(200);
    expect(await selectBookingStatus(capacityBookingId1)).toBe('confirmed');
    expect(await selectSlotReservedCount(capacitySlotId)).toBe(1);

    const approveCapacitySecond = await owner.request(
      '/api/v1/auth/organizations/bookings/approve',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: capacityBookingId2,
        }),
      },
    );
    expect(approveCapacitySecond.status).toBe(409);
    expect(await selectBookingStatus(capacityBookingId2)).toBe('pending_approval');
  });

  it('予約ライフサイクルイベントの予約通知メールを送信する', async () => {
    const authRuntimeWithEmail = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        RESEND_API_KEY: 'test-resend-api-key',
        RESEND_FROM_EMAIL: 'no-reply@example.com',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithEmail = createApp(authRuntimeWithEmail);

    const resendRequests: Array<{ to: string[]; subject: string }> = [];
    let shouldFailResend = false;
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === 'https://api.resend.com/emails') {
        const payloadText =
          typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '{}';
        const payload = JSON.parse(payloadText) as { to?: unknown; subject?: unknown };
        const to = Array.isArray(payload.to)
          ? payload.to.filter((value): value is string => typeof value === 'string')
          : [];
        const subject = typeof payload.subject === 'string' ? payload.subject : '';

        resendRequests.push({ to, subject });

        if (shouldFailResend) {
          return new Response('failed', { status: 500 });
        }
        return new Response(JSON.stringify({ id: crypto.randomUUID() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithEmail);
      await signUpUser({
        agent: owner,
        name: 'Booking Email Owner',
        email: 'booking-email-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Booking Email Org',
        slug: 'booking-email-org',
      });
      await enablePremiumForOrganization(organizationId);

      const participantInvite = await createParticipantInvitation({
        agent: owner,
        email: 'booking-email-participant@example.com',
        participantName: 'Booking Email Participant',
        organizationId,
      });
      expect(participantInvite.response.status).toBe(200);

      const participantUser = createAuthAgent(appWithEmail);
      await signUpUser({
        agent: participantUser,
        name: 'Booking Email Participant',
        email: 'booking-email-participant@example.com',
      });
      const participantAcceptResponse = await participantUser.request(
        buildInvitationActionPath(participantInvite.payload?.id as string, 'accept'),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            invitationId: participantInvite.payload?.id,
          }),
        },
      );
      expect(participantAcceptResponse.status).toBe(200);

      const serviceCreateResponse = await owner.request('/api/v1/auth/organizations/services', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          name: 'Email Notify Service',
          kind: 'single',
          durationMinutes: 60,
          capacity: 5,
          cancellationDeadlineMinutes: 30,
          requiresTicket: false,
        }),
      });
      expect(serviceCreateResponse.status).toBe(200);
      const servicePayload = (await toJson(serviceCreateResponse)) as Record<string, unknown>;
      const serviceId = servicePayload.id as string;
      await syncOrganizationBillingV2FixtureFromLegacyRow(organizationId);

      const makeSlot = async (offsetDays: number) => {
        const startAt = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
        const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
        const slotCreateResponse = await owner.request('/api/v1/auth/organizations/slots', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            organizationId,
            serviceId,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
          }),
        });
        expect(slotCreateResponse.status).toBe(200);
        const slotPayload = (await toJson(slotCreateResponse)) as Record<string, unknown>;
        return slotPayload.id as string;
      };

      const firstSlotId = await makeSlot(4);
      const firstBookingResponse = await participantUser.request(
        '/api/v1/auth/organizations/bookings',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            slotId: firstSlotId,
          }),
        },
      );
      expect(firstBookingResponse.status).toBe(200);
      const firstBookingPayload = (await toJson(firstBookingResponse)) as Record<string, unknown>;
      const firstBookingId = firstBookingPayload.id as string;

      const participantCancelResponse = await participantUser.request(
        '/api/v1/auth/organizations/bookings/cancel',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            bookingId: firstBookingId,
            reason: '都合が悪くなったため',
          }),
        },
      );
      expect(participantCancelResponse.status).toBe(200);

      const secondSlotId = await makeSlot(5);
      const secondBookingResponse = await participantUser.request(
        '/api/v1/auth/organizations/bookings',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            slotId: secondSlotId,
          }),
        },
      );
      expect(secondBookingResponse.status).toBe(200);
      const secondBookingPayload = (await toJson(secondBookingResponse)) as Record<string, unknown>;
      const secondBookingId = secondBookingPayload.id as string;

      const staffCancelResponse = await owner.request(
        '/api/v1/auth/organizations/bookings/cancel-by-staff',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            bookingId: secondBookingId,
            reason: '設備メンテナンス',
          }),
        },
      );
      expect(staffCancelResponse.status).toBe(200);

      const thirdSlotId = await makeSlot(6);
      const thirdBookingResponse = await participantUser.request(
        '/api/v1/auth/organizations/bookings',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            slotId: thirdSlotId,
          }),
        },
      );
      expect(thirdBookingResponse.status).toBe(200);
      const thirdBookingPayload = (await toJson(thirdBookingResponse)) as Record<string, unknown>;
      const thirdBookingId = thirdBookingPayload.id as string;

      const noShowResponse = await owner.request('/api/v1/auth/organizations/bookings/no-show', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: thirdBookingId,
        }),
      });
      expect(noShowResponse.status).toBe(200);

      const bookingNotificationRequests = resendRequests.filter((request) =>
        request.subject.startsWith('【予約通知】'),
      );
      const uniqueSubjects = Array.from(
        new Set(bookingNotificationRequests.map((request) => request.subject)),
      );
      expect(uniqueSubjects).toHaveLength(4);
      expect(uniqueSubjects).toContain('【予約通知】予約が確定しました');
      expect(uniqueSubjects).toContain('【予約通知】予約をキャンセルしました');
      expect(uniqueSubjects).toContain('【予約通知】運営により予約がキャンセルされました');
      expect(uniqueSubjects).toContain('【予約通知】予約がNo-showとして記録されました');
      expect(
        bookingNotificationRequests.every((request) =>
          request.to.includes('booking-email-participant@example.com'),
        ),
      ).toBe(true);

      shouldFailResend = true;
      const fourthSlotId = await makeSlot(7);
      const fourthBookingResponse = await participantUser.request(
        '/api/v1/auth/organizations/bookings',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            slotId: fourthSlotId,
          }),
        },
      );
      expect(fourthBookingResponse.status).toBe(200);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('承認ライフサイクルイベントの予約通知メールを送信する', async () => {
    const authRuntimeWithEmail = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        RESEND_API_KEY: 'test-resend-api-key',
        RESEND_FROM_EMAIL: 'no-reply@example.com',
        WEB_BASE_URL: 'http://localhost:5173',
      },
    });
    const appWithEmail = createApp(authRuntimeWithEmail);

    const resendRequests: Array<{ to: string[]; subject: string }> = [];
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === 'https://api.resend.com/emails') {
        const payloadText =
          typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '{}';
        const payload = JSON.parse(payloadText) as { to?: unknown; subject?: unknown };
        const to = Array.isArray(payload.to)
          ? payload.to.filter((value): value is string => typeof value === 'string')
          : [];
        const subject = typeof payload.subject === 'string' ? payload.subject : '';

        resendRequests.push({ to, subject });

        return new Response(JSON.stringify({ id: crypto.randomUUID() }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return originalFetch(input, init);
    });

    try {
      const owner = createAuthAgent(appWithEmail);
      await signUpUser({
        agent: owner,
        name: 'Booking Approval Email Owner',
        email: 'booking-approval-email-owner@example.com',
      });
      const organizationId = await createOrganization({
        agent: owner,
        name: 'Booking Approval Email Org',
        slug: 'booking-approval-email-org',
      });
      await enablePremiumForOrganization(organizationId);

      const participantInvite = await createParticipantInvitation({
        agent: owner,
        email: 'booking-approval-email-participant@example.com',
        participantName: 'Booking Approval Email Participant',
        organizationId,
      });
      expect(participantInvite.response.status).toBe(200);

      const participantUser = createAuthAgent(appWithEmail);
      await signUpUser({
        agent: participantUser,
        name: 'Booking Approval Email Participant',
        email: 'booking-approval-email-participant@example.com',
      });
      const participantAcceptResponse = await participantUser.request(
        buildInvitationActionPath(participantInvite.payload?.id as string, 'accept'),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            invitationId: participantInvite.payload?.id,
          }),
        },
      );
      expect(participantAcceptResponse.status).toBe(200);

      const serviceCreateResponse = await owner.request('/api/v1/auth/organizations/services', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          name: 'Approval Email Notify Service',
          kind: 'single',
          durationMinutes: 60,
          capacity: 5,
          bookingPolicy: 'approval',
          requiresTicket: false,
        }),
      });
      expect(serviceCreateResponse.status).toBe(200);
      const servicePayload = (await toJson(serviceCreateResponse)) as Record<string, unknown>;
      const serviceId = servicePayload.id as string;
      await syncOrganizationBillingV2FixtureFromLegacyRow(organizationId);

      const makeSlot = async (offsetDays: number) => {
        const startAt = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
        const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
        const slotCreateResponse = await owner.request('/api/v1/auth/organizations/slots', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            organizationId,
            serviceId,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
          }),
        });
        expect(slotCreateResponse.status).toBe(200);
        const slotPayload = (await toJson(slotCreateResponse)) as Record<string, unknown>;
        return slotPayload.id as string;
      };

      const slotId1 = await makeSlot(4);
      const bookingResponse1 = await participantUser.request(
        '/api/v1/auth/organizations/bookings',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            slotId: slotId1,
          }),
        },
      );
      expect(bookingResponse1.status).toBe(200);
      const bookingPayload1 = (await toJson(bookingResponse1)) as Record<string, unknown>;
      const bookingId1 = bookingPayload1.id as string;

      const approveResponse = await owner.request('/api/v1/auth/organizations/bookings/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: bookingId1,
        }),
      });
      expect(approveResponse.status).toBe(200);

      const slotId2 = await makeSlot(5);
      const bookingResponse2 = await participantUser.request(
        '/api/v1/auth/organizations/bookings',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            slotId: slotId2,
          }),
        },
      );
      expect(bookingResponse2.status).toBe(200);
      const bookingPayload2 = (await toJson(bookingResponse2)) as Record<string, unknown>;
      const bookingId2 = bookingPayload2.id as string;

      const rejectResponse = await owner.request('/api/v1/auth/organizations/bookings/reject', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingId: bookingId2,
          reason: '運営都合',
        }),
      });
      expect(rejectResponse.status).toBe(200);

      const bookingNotificationRequests = resendRequests.filter((request) =>
        request.subject.startsWith('【予約通知】'),
      );
      expect(
        bookingNotificationRequests.some(
          (request) => request.subject === '【予約通知】予約申請を受け付けました',
        ),
      ).toBe(true);
      expect(
        bookingNotificationRequests.some(
          (request) => request.subject === '【予約通知】予約が承認されました',
        ),
      ).toBe(true);
      expect(
        bookingNotificationRequests.some(
          (request) => request.subject === '【予約通知】予約が却下されました',
        ),
      ).toBe(true);
      expect(
        bookingNotificationRequests.every((request) =>
          request.to.includes('booking-approval-email-participant@example.com'),
        ),
      ).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('繰り返し枠を生成しスキップ例外を適用する', async () => {
    const owner = createAuthAgent(app);
    await signUpUser({
      agent: owner,
      name: 'Recurring Owner',
      email: 'recurring-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Recurring Org',
      slug: 'recurring-org',
    });
    await enablePremiumForOrganization(organizationId);

    const serviceResponse = await owner.request('/api/v1/auth/organizations/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        name: 'Recurring Service',
        kind: 'recurring',
        durationMinutes: 60,
        capacity: 8,
      }),
    });
    expect(serviceResponse.status).toBe(200);
    const servicePayload = (await toJson(serviceResponse)) as Record<string, unknown>;
    const serviceId = servicePayload.id as string;

    const now = new Date();
    const weekday = ((now.getUTCDay() + 6) % 7) + 1;
    const startDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const startDateStr = `${startDate.getUTCFullYear()}-${String(
      startDate.getUTCMonth() + 1,
    ).padStart(2, '0')}-${String(startDate.getUTCDate()).padStart(2, '0')}`;

    const recurringCreateResponse = await owner.request(
      '/api/v1/auth/organizations/recurring-schedules',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          serviceId,
          timezone: 'Asia/Tokyo',
          frequency: 'weekly',
          interval: 1,
          byWeekday: [weekday],
          startDate: startDateStr,
          startTimeLocal: '10:00',
        }),
      },
    );
    expect(recurringCreateResponse.status).toBe(200);
    const recurringPayload = (await toJson(recurringCreateResponse)) as Record<string, unknown>;
    const recurringScheduleId = recurringPayload.id as string;
    const generated = recurringPayload.generated as Record<string, unknown>;
    expect(Number(generated.createdCount ?? 0)).toBeGreaterThan(0);

    const generateAgainResponse = await owner.request(
      '/api/v1/auth/organizations/recurring-schedules/generate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recurringScheduleId,
        }),
      },
    );
    expect(generateAgainResponse.status).toBe(200);
    const generateAgainPayload = (await toJson(generateAgainResponse)) as Record<string, unknown>;
    expect(Number(generateAgainPayload.createdCount ?? 0)).toBe(0);

    const slots = await listSlotStartsByRecurringSchedule(recurringScheduleId);
    expect(slots.length).toBeGreaterThan(0);
    const targetSlot = slots[0];
    const startAtDate = new Date(Number(targetSlot.startAt));
    const dateKey = `${startAtDate.getUTCFullYear()}-${String(
      startAtDate.getUTCMonth() + 1,
    ).padStart(2, '0')}-${String(startAtDate.getUTCDate()).padStart(2, '0')}`;

    const skipExceptionResponse = await owner.request(
      '/api/v1/auth/organizations/recurring-schedules/exceptions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recurringScheduleId,
          date: dateKey,
          action: 'skip',
        }),
      },
    );
    expect(skipExceptionResponse.status).toBe(200);

    const skippedSlotRow = await d1
      .prepare('SELECT status FROM slot WHERE id = ?')
      .bind(targetSlot.id)
      .first<{ status: string }>();
    expect(skippedSlotRow?.status).toBe('canceled');
  });

  it('組織オーナーでも内部ユーザーでない場合は内部課金調査を拒否する', async () => {
    const authRuntimeWithInternalInspection = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        INTERNAL_OPERATOR_EMAILS: 'internal-ops@example.com',
      },
    });
    const appWithInternalInspection = createApp(authRuntimeWithInternalInspection);

    const owner = createAuthAgent(appWithInternalInspection);
    await signUpUser({
      agent: owner,
      name: 'Inspection Owner',
      email: 'inspection-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Inspection Denied Org',
      slug: 'inspection-denied-org',
    });

    const deniedResponse = await owner.request(
      `/api/v1/auth/internal/organizations/${encodeURIComponent(organizationId)}/billing-inspection`,
    );

    expect(deniedResponse.status).toBe(403);
    await expect(toJson(deniedResponse)).resolves.toEqual({
      message: 'Internal billing inspection access denied.',
    });
  });

  it('内部課金調査前に許可リスト登録オペレーターへメール確認済みを要求する', async () => {
    const authRuntimeWithInternalInspection = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        INTERNAL_OPERATOR_EMAILS: 'internal-ops-verified@example.com',
      },
    });
    const appWithInternalInspection = createApp(authRuntimeWithInternalInspection);

    const internalOperator = createAuthAgent(appWithInternalInspection);
    await signUpUser({
      agent: internalOperator,
      name: 'Internal Operator',
      email: 'internal-ops-verified@example.com',
    });

    const owner = createAuthAgent(appWithInternalInspection);
    await signUpUser({
      agent: owner,
      name: 'Inspection Fixture Owner',
      email: 'inspection-verified-fixture-owner@example.com',
    });
    const organizationId = await createOrganization({
      agent: owner,
      name: 'Inspection Verified Org',
      slug: 'inspection-verified-org',
    });

    const deniedResponse = await internalOperator.request(
      `/api/v1/auth/internal/organizations/${encodeURIComponent(organizationId)}/billing-inspection`,
    );
    expect(deniedResponse.status).toBe(403);

    await setUserEmailVerified({ email: 'internal-ops-verified@example.com' });

    const allowedResponse = await internalOperator.request(
      `/api/v1/auth/internal/organizations/${encodeURIComponent(organizationId)}/billing-inspection`,
    );
    expect(allowedResponse.status).toBe(200);
  });

  it('受信者結果・古い失敗・サポートシグナルを含む内部支払い問題調査を返す', async () => {
    const authRuntimeWithInternalInspection = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        INTERNAL_OPERATOR_EMAILS: 'internal-payment-issue@example.com',
      },
    });
    const appWithInternalInspection = createApp(authRuntimeWithInternalInspection);
    const internalOperator = createAuthAgent(appWithInternalInspection);
    await signUpUser({
      agent: internalOperator,
      name: 'Internal Payment Issue Operator',
      email: 'internal-payment-issue@example.com',
    });
    await setUserEmailVerified({ email: 'internal-payment-issue@example.com' });

    const issueOccurredAt = new Date('2026-05-01T00:00:00.000Z');
    const recoveredAt = new Date('2026-05-02T00:00:00.000Z');
    const { organizationId, userId } = await createPaymentIssueBillingFixture({
      application: appWithInternalInspection,
      name: 'Internal Payment Issue Owner',
      email: 'internal-payment-issue-owner@example.com',
      organizationName: 'Internal Payment Issue Org',
      slug: `internal-payment-issue-${crypto.randomUUID().slice(0, 8)}`,
      subscriptionStatus: 'active',
      paymentIssueStartedAt: null,
      pastDueGraceEndsAt: null,
    });
    await insertOrganizationBillingInvoiceEventRow({
      organizationId,
      stripeEventId: 'evt_internal_payment_failed',
      eventType: 'payment_failed',
      ownerFacingStatus: 'failed',
      stripeInvoiceId: 'in_internal_payment_failed',
      stripePaymentIntentId: 'pi_internal_payment_failed',
      providerStatus: 'open',
      occurredAt: issueOccurredAt,
    });
    await insertOrganizationBillingInvoiceEventRow({
      organizationId,
      stripeEventId: 'evt_internal_payment_succeeded',
      eventType: 'payment_succeeded',
      ownerFacingStatus: 'succeeded',
      stripeInvoiceId: 'in_internal_payment_succeeded',
      stripePaymentIntentId: 'pi_internal_payment_succeeded',
      providerStatus: 'paid',
      occurredAt: recoveredAt,
    });
    await insertReserveAppBillingNotificationRow({
      organizationId,
      sequenceNumber: 1,
      notificationKind: 'payment_failed_email',
      deliveryState: 'sent',
      attemptNumber: 1,
      stripeEventId: 'evt_internal_payment_failed',
      recipientUserId: userId,
      recipientEmail: 'internal-payment-issue-owner@example.com',
      planState: 'premium_paid',
      subscriptionStatus: 'past_due',
      paymentMethodStatus: 'registered',
    });
    await insertReserveAppBillingNotificationRow({
      organizationId,
      sequenceNumber: 2,
      notificationKind: 'payment_failed_email',
      deliveryState: 'skipped',
      attemptNumber: 2,
      stripeEventId: 'evt_internal_payment_failed',
      recipientUserId: userId,
      recipientEmail: 'internal-payment-issue-owner@example.com',
      planState: 'premium_paid',
      subscriptionStatus: 'past_due',
      paymentMethodStatus: 'registered',
    });
    await insertOrganizationBillingSignalRow({
      organizationId,
      sequenceNumber: 1,
      signalKind: 'reconciliation',
      signalStatus: 'resolved',
      sourceKind: 'webhook_payment_failed',
      reason: 'stale_payment_issue_after_recovery',
      stripeEventId: 'evt_internal_payment_failed',
      appPlanState: 'premium_paid',
      appSubscriptionStatus: 'active',
      appPaymentMethodStatus: 'registered',
      appEntitlementState: 'premium_enabled',
    });

    const response = await internalOperator.request(
      `/api/v1/auth/internal/organizations/${encodeURIComponent(organizationId)}/billing-inspection`,
    );
    expect(response.status).toBe(200);
    const payload = (await toJson(response)) as Record<string, unknown>;

    expect(payload).toMatchObject({
      paymentIssue: {
        paymentIssueState: 'recovered',
        notificationRecipients: [
          expect.objectContaining({
            recipientEmail: 'internal-payment-issue-owner@example.com',
            deliveryState: 'skipped',
            retryEligible: false,
          }),
        ],
        staleFailureEvents: [
          expect.objectContaining({
            eventType: 'payment_failed',
            stripeEventId: 'evt_internal_payment_failed',
          }),
        ],
        supportSignals: [
          expect.objectContaining({
            reason: 'stale_payment_issue_after_recovery',
            status: 'resolved',
          }),
        ],
      },
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('4242');
    expect(serialized).not.toContain('payment_method_details');
    expect(serialized).not.toContain('tax_details');
    expect(serialized).not.toContain('data.object');
    expect(serialized).not.toContain('rawPayload');
  });

  it('認証と課金の境界事例を正規化した読み取り専用の内部課金調査ビューを返す', async () => {
    const authRuntimeWithInternalInspection = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        INTERNAL_OPERATOR_EMAILS: 'internal-ops-inspection@example.com',
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: 'price_trial_inspection',
        STRIPE_PREMIUM_YEARLY_PRICE_ID: 'price_linked_without_signal',
      },
    });
    const appWithInternalInspection = createApp(authRuntimeWithInternalInspection);

    const internalOperator = createAuthAgent(appWithInternalInspection);
    await signUpUser({
      agent: internalOperator,
      name: 'Internal Operator',
      email: 'internal-ops-inspection@example.com',
    });
    await setUserEmailVerified({ email: 'internal-ops-inspection@example.com' });

    const owner = createAuthAgent(appWithInternalInspection);
    await signUpUser({
      agent: owner,
      name: 'Inspection Fixture Owner',
      email: 'inspection-edge-fixture-owner@example.com',
    });

    const freeOrganizationId = await createOrganization({
      agent: owner,
      name: 'Inspection Free Org',
      slug: 'inspection-free-org',
    });
    const trialOrganizationId = await createOrganization({
      agent: owner,
      name: 'Inspection Trial Org',
      slug: 'inspection-trial-org',
    });
    const paidOrganizationId = await createOrganization({
      agent: owner,
      name: 'Inspection Paid Org',
      slug: 'inspection-paid-org',
    });
    const canceledOrganizationId = await createOrganization({
      agent: owner,
      name: 'Inspection Canceled Org',
      slug: 'inspection-canceled-org',
    });
    const linkedWithoutSignalOrganizationId = await createOrganization({
      agent: owner,
      name: 'Inspection Linked No Signal Org',
      slug: 'inspection-linked-no-signal-org',
    });
    const malformedOrganizationId = await createOrganization({
      agent: owner,
      name: 'Inspection Malformed Org',
      slug: 'inspection-malformed-org',
    });

    const now = Date.now();
    const trialEndsAt = new Date(now + 3 * 24 * 60 * 60 * 1000);
    const paidPeriodStart = new Date(now - 2 * 24 * 60 * 60 * 1000);
    const paidPeriodEnd = new Date(now + 28 * 24 * 60 * 60 * 1000);
    const canceledPeriodEnd = new Date(now + 14 * 24 * 60 * 60 * 1000);

    await setOrganizationBillingState({
      organizationId: trialOrganizationId,
      planCode: 'premium',
      subscriptionStatus: 'trialing',
      billingInterval: null,
      currentPeriodEnd: trialEndsAt,
      stripeCustomerId: 'cus_trial_inspection',
      stripeSubscriptionId: 'sub_trial_inspection',
      stripePriceId: 'price_trial_inspection',
    });
    await insertOrganizationBillingAuditEventRow({
      organizationId: trialOrganizationId,
      sequenceNumber: 1,
      sourceKind: 'trial_start',
      previousPlanCode: 'free',
      nextPlanCode: 'premium',
      previousPlanState: 'free',
      nextPlanState: 'premium_trial',
      previousSubscriptionStatus: 'free',
      nextSubscriptionStatus: 'trialing',
      previousPaymentMethodStatus: 'not_started',
      nextPaymentMethodStatus: 'pending',
      previousEntitlementState: 'free_only',
      nextEntitlementState: 'premium_enabled',
      sourceContext: 'owner_started_premium_trial',
      stripeCustomerId: 'cus_trial_inspection',
      stripeSubscriptionId: 'sub_trial_inspection',
      createdAt: new Date(now - 60_000),
    });
    await insertOrganizationBillingSignalRow({
      organizationId: trialOrganizationId,
      sequenceNumber: 1,
      signalKind: 'reconciliation',
      signalStatus: 'pending',
      sourceKind: 'trial_completion',
      reason: 'trial_completion_pending',
      providerPlanState: 'premium_trial',
      providerSubscriptionStatus: 'trialing',
      appPlanState: 'premium_trial',
      appSubscriptionStatus: 'trialing',
      appPaymentMethodStatus: 'pending',
      appEntitlementState: 'premium_enabled',
      stripeCustomerId: 'cus_trial_inspection',
      stripeSubscriptionId: 'sub_trial_inspection',
      createdAt: new Date(now - 30_000),
    });

    await setOrganizationBillingState({
      organizationId: paidOrganizationId,
      planCode: 'premium',
      subscriptionStatus: 'active',
      billingInterval: 'month',
      currentPeriodStart: paidPeriodStart,
      currentPeriodEnd: paidPeriodEnd,
      stripeCustomerId: 'cus_paid_inspection',
      stripeSubscriptionId: 'sub_paid_inspection',
      stripePriceId: 'price_paid_inspection',
      cancelAtPeriodEnd: true,
    });
    await insertOrganizationBillingAuditEventRow({
      organizationId: paidOrganizationId,
      sequenceNumber: 1,
      sourceKind: 'webhook_subscription_lifecycle',
      previousPlanCode: 'premium',
      nextPlanCode: 'premium',
      previousPlanState: 'premium_trial',
      nextPlanState: 'premium_paid',
      previousSubscriptionStatus: 'trialing',
      nextSubscriptionStatus: 'active',
      previousPaymentMethodStatus: 'pending',
      nextPaymentMethodStatus: 'registered',
      previousEntitlementState: 'premium_enabled',
      nextEntitlementState: 'premium_enabled',
      previousBillingInterval: null,
      nextBillingInterval: 'month',
      sourceContext: 'stripe_subscription_activated',
      stripeCustomerId: 'cus_paid_inspection',
      stripeSubscriptionId: 'sub_paid_inspection',
      stripeEventId: 'evt_paid_inspection',
      createdAt: new Date(now - 120_000),
    });
    await insertOrganizationBillingSignalRow({
      organizationId: paidOrganizationId,
      sequenceNumber: 1,
      signalKind: 'reconciliation',
      signalStatus: 'resolved',
      sourceKind: 'webhook_subscription_lifecycle',
      reason: 'billing_state_synchronized',
      providerPlanState: 'premium_paid',
      providerSubscriptionStatus: 'active',
      appPlanState: 'premium_paid',
      appSubscriptionStatus: 'active',
      appPaymentMethodStatus: 'registered',
      appEntitlementState: 'premium_enabled',
      stripeCustomerId: 'cus_paid_inspection',
      stripeSubscriptionId: 'sub_paid_inspection',
      stripeEventId: 'evt_paid_inspection',
      createdAt: new Date(now - 90_000),
    });

    await setOrganizationBillingState({
      organizationId: canceledOrganizationId,
      planCode: 'premium',
      subscriptionStatus: 'canceled',
      billingInterval: 'month',
      currentPeriodStart: paidPeriodStart,
      currentPeriodEnd: canceledPeriodEnd,
      stripeCustomerId: 'cus_canceled_inspection',
      stripeSubscriptionId: 'sub_canceled_inspection',
      stripePriceId: 'price_canceled_inspection',
      cancelAtPeriodEnd: true,
    });
    await insertOrganizationBillingSignalRow({
      organizationId: canceledOrganizationId,
      sequenceNumber: 1,
      signalKind: 'reconciliation',
      signalStatus: 'resolved',
      sourceKind: 'webhook_subscription_lifecycle',
      reason: 'subscription_canceled',
      providerPlanState: 'premium_paid',
      providerSubscriptionStatus: 'canceled',
      appPlanState: 'premium_paid',
      appSubscriptionStatus: 'canceled',
      appPaymentMethodStatus: 'registered',
      appEntitlementState: 'free_only',
      stripeCustomerId: 'cus_canceled_inspection',
      stripeSubscriptionId: 'sub_canceled_inspection',
      stripeEventId: 'evt_canceled_inspection',
      createdAt: new Date(now - 45_000),
    });

    await setOrganizationBillingState({
      organizationId: linkedWithoutSignalOrganizationId,
      planCode: 'premium',
      subscriptionStatus: 'active',
      billingInterval: 'year',
      currentPeriodStart: paidPeriodStart,
      currentPeriodEnd: paidPeriodEnd,
      stripeCustomerId: 'cus_linked_without_signal',
      stripeSubscriptionId: 'sub_linked_without_signal',
      stripePriceId: 'price_linked_without_signal',
    });

    await setOrganizationBillingState({
      organizationId: malformedOrganizationId,
      planCode: 'premium',
      subscriptionStatus: 'trialing',
      billingInterval: null,
      stripeCustomerId: 'cus_malformed_inspection',
      stripeSubscriptionId: 'sub_malformed_inspection',
      stripePriceId: 'price_malformed_inspection',
    });
    await d1
      .prepare(
        "UPDATE billing_subscription SET current_period_end = ?, updated_at = ? WHERE billing_account_id = (SELECT id FROM billing_account WHERE subject_type = 'organization' AND subject_id = ? LIMIT 1)",
      )
      .bind('not-a-real-timestamp', Date.now(), malformedOrganizationId)
      .run();
    await insertOrganizationBillingSignalRow({
      organizationId: malformedOrganizationId,
      sequenceNumber: 1,
      signalKind: 'reconciliation',
      signalStatus: 'resolved',
      sourceKind: 'webhook_subscription_lifecycle',
      reason: 'billing_state_synchronized',
      providerPlanState: 'unexpected_provider_state',
      providerSubscriptionStatus: 'unexpected_subscription_state',
      appPlanState: 'premium_trial',
      appSubscriptionStatus: 'trialing',
      appPaymentMethodStatus: 'pending',
      appEntitlementState: 'premium_enabled',
      stripeCustomerId: 'cus_malformed_inspection',
      stripeSubscriptionId: 'sub_malformed_inspection',
      stripeEventId: 'evt_malformed_inspection',
      createdAt: new Date(now - 15_000),
    });

    const [
      freeResponse,
      trialResponse,
      paidResponse,
      canceledResponse,
      linkedWithoutSignalResponse,
      malformedResponse,
    ] = await Promise.all([
      internalOperator.request(
        `/api/v1/auth/internal/organizations/${encodeURIComponent(freeOrganizationId)}/billing-inspection`,
      ),
      internalOperator.request(
        `/api/v1/auth/internal/organizations/${encodeURIComponent(trialOrganizationId)}/billing-inspection`,
      ),
      internalOperator.request(
        `/api/v1/auth/internal/organizations/${encodeURIComponent(paidOrganizationId)}/billing-inspection`,
      ),
      internalOperator.request(
        `/api/v1/auth/internal/organizations/${encodeURIComponent(canceledOrganizationId)}/billing-inspection`,
      ),
      internalOperator.request(
        `/api/v1/auth/internal/organizations/${encodeURIComponent(linkedWithoutSignalOrganizationId)}/billing-inspection`,
      ),
      internalOperator.request(
        `/api/v1/auth/internal/organizations/${encodeURIComponent(malformedOrganizationId)}/billing-inspection`,
      ),
    ]);

    expect(freeResponse.status).toBe(200);
    expect(trialResponse.status).toBe(200);
    expect(paidResponse.status).toBe(200);
    expect(canceledResponse.status).toBe(200);
    expect(linkedWithoutSignalResponse.status).toBe(200);
    expect(malformedResponse.status).toBe(200);

    const freePayload = (await toJson(freeResponse)) as Record<string, unknown>;
    expect(freePayload).toMatchObject({
      organizationId: freeOrganizationId,
      summary: {
        planCode: 'free',
        planState: 'free',
        lifecycleStage: 'free',
        paymentMethodStatus: 'not_started',
      },
      provider: null,
    });

    const trialPayload = (await toJson(trialResponse)) as Record<string, unknown>;
    expect(trialPayload).toMatchObject({
      organizationId: trialOrganizationId,
      summary: {
        planCode: 'premium',
        planState: 'premium_trial',
        lifecycleStage: 'trial',
        subscriptionStatus: 'trialing',
        stripeLinked: true,
      },
      provider: {
        stripeCustomerId: 'cus_trial_inspection',
        stripeSubscriptionId: 'sub_trial_inspection',
        stripePriceId: 'price_trial_inspection',
        providerSubscriptionStatus: 'trialing',
        providerPlanState: 'premium_trial',
      },
    });
    expect(trialPayload).toHaveProperty('lifecycle.recentEvents');
    expect(trialPayload).toHaveProperty('lifecycle.latestSignal');
    expect(trialPayload).toHaveProperty('paymentDocuments', {
      aggregateRoot: 'billing_account',
      provider: 'stripe',
      ownerAccess: 'owner_only',
      persistenceStrategy: 'provider_reference_only',
      stripeCustomerId: 'cus_trial_inspection',
      stripeSubscriptionId: 'sub_trial_inspection',
      diagnosticReason: null,
      documents: [],
    });
    expect(trialPayload).not.toHaveProperty('actions');
    expect(trialPayload).not.toHaveProperty('rawProviderPayload');
    expect(trialPayload.provider as Record<string, unknown>).not.toHaveProperty('rawPayload');

    const paidPayload = (await toJson(paidResponse)) as Record<string, unknown>;
    expect(paidPayload).toMatchObject({
      organizationId: paidOrganizationId,
      summary: {
        planCode: 'premium',
        planState: 'free',
        paidTier: {
          code: 'premium_unknown',
          label: 'Premium',
          resolution: 'unknown_price',
          diagnosticReason: 'stripe_price_id_not_in_paid_tier_catalog',
        },
        lifecycleStage: 'free',
        subscriptionStatus: 'active',
        billingInterval: 'month',
        cancelAtPeriodEnd: true,
        stripeLinked: true,
      },
      provider: {
        stripeCustomerId: 'cus_paid_inspection',
        stripeSubscriptionId: 'sub_paid_inspection',
        stripePriceId: 'price_paid_inspection',
        providerSubscriptionStatus: 'active',
        providerPlanState: 'premium_paid',
      },
      lifecycle: {
        latestSignal: {
          signalStatus: 'resolved',
          reason: 'billing_state_synchronized',
        },
      },
    });
    expect(paidPayload).not.toHaveProperty('actions');
    expect(paidPayload).toHaveProperty('paymentDocuments.stripeCustomerId', 'cus_paid_inspection');
    expect(paidPayload).toHaveProperty(
      'paymentDocuments.stripeSubscriptionId',
      'sub_paid_inspection',
    );

    const canceledPayload = (await toJson(canceledResponse)) as Record<string, unknown>;
    expect(canceledPayload).toMatchObject({
      organizationId: canceledOrganizationId,
      summary: {
        planCode: 'premium',
        planState: 'free',
        lifecycleStage: 'free',
        lifecycleReason: 'premium_paid_unknown_price',
        subscriptionStatus: 'canceled',
        billingInterval: 'month',
        cancelAtPeriodEnd: true,
        stripeLinked: true,
      },
      provider: {
        stripeCustomerId: 'cus_canceled_inspection',
        stripeSubscriptionId: 'sub_canceled_inspection',
        stripePriceId: 'price_canceled_inspection',
        providerPlanState: 'premium_paid',
        providerSubscriptionStatus: 'canceled',
      },
    });

    const linkedWithoutSignalPayload = (await toJson(linkedWithoutSignalResponse)) as Record<
      string,
      unknown
    >;
    expect(linkedWithoutSignalPayload).toMatchObject({
      organizationId: linkedWithoutSignalOrganizationId,
      summary: {
        planCode: 'premium',
        planState: 'premium_paid',
        lifecycleStage: 'paid',
        subscriptionStatus: 'active',
        billingInterval: 'year',
        stripeLinked: true,
      },
      provider: {
        stripeCustomerId: 'cus_linked_without_signal',
        stripeSubscriptionId: 'sub_linked_without_signal',
        stripePriceId: 'price_linked_without_signal',
        providerPlanState: null,
        providerSubscriptionStatus: null,
      },
      lifecycle: {
        latestSignal: null,
      },
    });

    const malformedPayload = (await toJson(malformedResponse)) as Record<string, unknown>;
    expect(malformedPayload).toMatchObject({
      organizationId: malformedOrganizationId,
      summary: {
        planCode: 'premium',
        planState: 'free',
        lifecycleStage: 'free',
        lifecycleReason: 'premium_paid_unknown_price',
        subscriptionStatus: 'trialing',
        currentPeriodEnd: null,
        trialEndsAt: null,
        stripeLinked: true,
      },
      provider: {
        stripeCustomerId: 'cus_malformed_inspection',
        stripeSubscriptionId: 'sub_malformed_inspection',
        stripePriceId: 'price_malformed_inspection',
        providerPlanState: null,
        providerSubscriptionStatus: null,
      },
      lifecycle: {
        latestSignal: {
          providerPlanState: null,
          providerSubscriptionStatus: null,
        },
      },
    });
  });

  it('配信済み・保留・失敗・欠落・不明のリマインド結果に対する内部配信監査調査を返す', async () => {
    const authRuntimeWithInternalInspection = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        INTERNAL_OPERATOR_EMAILS: 'internal-ops-reminder-audit@example.com',
      },
    });
    const appWithInternalInspection = createApp(authRuntimeWithInternalInspection);

    const internalOperator = createAuthAgent(appWithInternalInspection);
    await signUpUser({
      agent: internalOperator,
      name: 'Internal Reminder Audit Operator',
      email: 'internal-ops-reminder-audit@example.com',
    });
    await setUserEmailVerified({ email: 'internal-ops-reminder-audit@example.com' });

    const owner = createAuthAgent(appWithInternalInspection);
    await signUpUser({
      agent: owner,
      name: 'Reminder Audit Fixture Owner',
      email: 'reminder-audit-fixture-owner@example.com',
    });

    const deliveredOrganizationId = await createOrganization({
      agent: owner,
      name: 'Reminder Delivered Org',
      slug: 'reminder-delivered-org',
    });
    const pendingOrganizationId = await createOrganization({
      agent: owner,
      name: 'Reminder Pending Org',
      slug: 'reminder-pending-org',
    });
    const failedOrganizationId = await createOrganization({
      agent: owner,
      name: 'Reminder Failed Org',
      slug: 'reminder-failed-org',
    });
    const missingOrganizationId = await createOrganization({
      agent: owner,
      name: 'Reminder Missing Org',
      slug: 'reminder-missing-org',
    });
    const unknownOrganizationId = await createOrganization({
      agent: owner,
      name: 'Reminder Unknown Org',
      slug: 'reminder-unknown-org',
    });

    const now = Date.now();
    const deliveredTrialEndsAt = new Date(now + 2 * 24 * 60 * 60 * 1000);
    const pendingTrialEndsAt = new Date(now + 2 * 24 * 60 * 60 * 1000);
    const failedTrialEndsAt = new Date(now + 2 * 24 * 60 * 60 * 1000);
    const missingTrialEndsAt = new Date(now + 2 * 24 * 60 * 60 * 1000);
    const unknownTrialEndsAt = new Date(now + 2 * 24 * 60 * 60 * 1000);

    for (const [
      organizationId,
      stripeCustomerId,
      stripeSubscriptionId,
      stripePriceId,
      currentPeriodEnd,
    ] of [
      [
        deliveredOrganizationId,
        'cus_delivered_audit',
        'sub_delivered_audit',
        'price_delivered_audit',
        deliveredTrialEndsAt,
      ],
      [
        pendingOrganizationId,
        'cus_pending_audit',
        'sub_pending_audit',
        'price_pending_audit',
        pendingTrialEndsAt,
      ],
      [
        failedOrganizationId,
        'cus_failed_audit',
        'sub_failed_audit',
        'price_failed_audit',
        failedTrialEndsAt,
      ],
      [
        missingOrganizationId,
        'cus_missing_audit',
        'sub_missing_audit',
        'price_missing_audit',
        missingTrialEndsAt,
      ],
      [
        unknownOrganizationId,
        'cus_unknown_audit',
        'sub_unknown_audit',
        'price_unknown_audit',
        unknownTrialEndsAt,
      ],
    ] as const) {
      await setOrganizationBillingState({
        organizationId,
        planCode: 'premium',
        subscriptionStatus: 'trialing',
        billingInterval: null,
        currentPeriodEnd,
        stripeCustomerId,
        stripeSubscriptionId,
        stripePriceId,
      });
    }

    await insertReserveAppBillingNotificationRow({
      organizationId: deliveredOrganizationId,
      sequenceNumber: 1,
      deliveryState: 'requested',
      attemptNumber: 1,
      stripeEventId: 'evt_delivered_audit',
      recipientEmail: 'reminder-audit-fixture-owner@example.com',
      stripeCustomerId: 'cus_delivered_audit',
      stripeSubscriptionId: 'sub_delivered_audit',
      trialEndsAt: deliveredTrialEndsAt,
      createdAt: new Date(now - 120_000),
    });
    await insertReserveAppBillingNotificationRow({
      organizationId: deliveredOrganizationId,
      sequenceNumber: 2,
      deliveryState: 'sent',
      attemptNumber: 1,
      stripeEventId: 'evt_delivered_audit',
      recipientEmail: 'reminder-audit-fixture-owner@example.com',
      stripeCustomerId: 'cus_delivered_audit',
      stripeSubscriptionId: 'sub_delivered_audit',
      trialEndsAt: deliveredTrialEndsAt,
      createdAt: new Date(now - 90_000),
    });
    await insertReserveAppBillingNotificationRow({
      organizationId: deliveredOrganizationId,
      sequenceNumber: 3,
      notificationKind: 'trial_will_end',
      channel: 'web_push',
      deliveryState: 'sent',
      attemptNumber: 1,
      stripeEventId: 'evt_delivered_audit_push',
      recipientEmail: null,
      stripeCustomerId: 'cus_delivered_audit',
      stripeSubscriptionId: 'sub_delivered_audit',
      trialEndsAt: deliveredTrialEndsAt,
      createdAt: new Date(now - 85_000),
    });
    await insertOrganizationBillingSignalRow({
      organizationId: deliveredOrganizationId,
      sequenceNumber: 1,
      signalKind: 'notification_delivery',
      signalStatus: 'resolved',
      sourceKind: 'trial_will_end_email',
      reason: 'trial_reminder_delivery_succeeded',
      stripeEventId: 'evt_delivered_audit',
      stripeCustomerId: 'cus_delivered_audit',
      stripeSubscriptionId: 'sub_delivered_audit',
      appPlanState: 'premium_trial',
      appSubscriptionStatus: 'trialing',
      appPaymentMethodStatus: 'pending',
      appEntitlementState: 'premium_enabled',
      createdAt: new Date(now - 80_000),
    });
    await insertStripeWebhookEventRow({
      id: 'evt_delivered_audit',
      eventType: 'customer.subscription.trial_will_end',
      processingStatus: 'processed',
      organizationId: deliveredOrganizationId,
      stripeCustomerId: 'cus_delivered_audit',
      stripeSubscriptionId: 'sub_delivered_audit',
      createdAt: new Date(now - 95_000),
    });

    await insertReserveAppBillingNotificationRow({
      organizationId: pendingOrganizationId,
      sequenceNumber: 1,
      deliveryState: 'requested',
      attemptNumber: 1,
      stripeEventId: 'evt_pending_audit',
      recipientEmail: 'reminder-audit-fixture-owner@example.com',
      stripeCustomerId: 'cus_pending_audit',
      stripeSubscriptionId: 'sub_pending_audit',
      trialEndsAt: pendingTrialEndsAt,
      createdAt: new Date(now - 110_000),
    });
    await insertReserveAppBillingNotificationRow({
      organizationId: pendingOrganizationId,
      sequenceNumber: 2,
      deliveryState: 'failed',
      attemptNumber: 1,
      stripeEventId: 'evt_pending_audit',
      recipientEmail: 'reminder-audit-fixture-owner@example.com',
      stripeCustomerId: 'cus_pending_audit',
      stripeSubscriptionId: 'sub_pending_audit',
      trialEndsAt: pendingTrialEndsAt,
      failureReason: 'resend_delivery_failed',
      createdAt: new Date(now - 100_000),
    });
    await insertReserveAppBillingNotificationRow({
      organizationId: pendingOrganizationId,
      sequenceNumber: 3,
      deliveryState: 'retried',
      attemptNumber: 2,
      stripeEventId: 'evt_pending_audit',
      recipientEmail: 'reminder-audit-fixture-owner@example.com',
      stripeCustomerId: 'cus_pending_audit',
      stripeSubscriptionId: 'sub_pending_audit',
      trialEndsAt: pendingTrialEndsAt,
      createdAt: new Date(now - 90_000),
    });
    await insertOrganizationBillingSignalRow({
      organizationId: pendingOrganizationId,
      sequenceNumber: 1,
      signalKind: 'notification_delivery',
      signalStatus: 'pending',
      sourceKind: 'trial_will_end_email',
      reason: 'resend_delivery_failed',
      stripeEventId: 'evt_pending_audit',
      stripeCustomerId: 'cus_pending_audit',
      stripeSubscriptionId: 'sub_pending_audit',
      appPlanState: 'premium_trial',
      appSubscriptionStatus: 'trialing',
      appPaymentMethodStatus: 'pending',
      appEntitlementState: 'premium_enabled',
      createdAt: new Date(now - 85_000),
    });
    await insertStripeWebhookEventRow({
      id: 'evt_pending_audit',
      eventType: 'customer.subscription.trial_will_end',
      processingStatus: 'failed',
      organizationId: pendingOrganizationId,
      stripeCustomerId: 'cus_pending_audit',
      stripeSubscriptionId: 'sub_pending_audit',
      failureReason: 'trial_reminder_delivery_failed',
      createdAt: new Date(now - 92_000),
    });

    await insertReserveAppBillingNotificationRow({
      organizationId: failedOrganizationId,
      sequenceNumber: 1,
      deliveryState: 'requested',
      attemptNumber: 1,
      stripeEventId: 'evt_failed_audit',
      recipientEmail: 'reminder-audit-fixture-owner@example.com',
      stripeCustomerId: 'cus_failed_audit',
      stripeSubscriptionId: 'sub_failed_audit',
      trialEndsAt: failedTrialEndsAt,
      createdAt: new Date(now - 75_000),
    });
    await insertReserveAppBillingNotificationRow({
      organizationId: failedOrganizationId,
      sequenceNumber: 2,
      deliveryState: 'failed',
      attemptNumber: 1,
      stripeEventId: 'evt_failed_audit',
      recipientEmail: 'reminder-audit-fixture-owner@example.com',
      stripeCustomerId: 'cus_failed_audit',
      stripeSubscriptionId: 'sub_failed_audit',
      trialEndsAt: failedTrialEndsAt,
      failureReason: 'owner_not_found',
      createdAt: new Date(now - 70_000),
    });
    await insertOrganizationBillingSignalRow({
      organizationId: failedOrganizationId,
      sequenceNumber: 1,
      signalKind: 'notification_delivery',
      signalStatus: 'unavailable',
      sourceKind: 'trial_will_end_email',
      reason: 'owner_not_found',
      stripeEventId: 'evt_failed_audit',
      stripeCustomerId: 'cus_failed_audit',
      stripeSubscriptionId: 'sub_failed_audit',
      appPlanState: 'premium_trial',
      appSubscriptionStatus: 'trialing',
      appPaymentMethodStatus: 'pending',
      appEntitlementState: 'premium_enabled',
      createdAt: new Date(now - 65_000),
    });
    await insertStripeWebhookEventRow({
      id: 'evt_failed_audit',
      eventType: 'customer.subscription.trial_will_end',
      processingStatus: 'failed',
      organizationId: failedOrganizationId,
      stripeCustomerId: 'cus_failed_audit',
      stripeSubscriptionId: 'sub_failed_audit',
      failureReason: 'trial_reminder_owner_not_found',
      createdAt: new Date(now - 72_000),
    });

    await insertStripeWebhookEventRow({
      id: 'evt_unknown_audit',
      eventType: 'customer.subscription.trial_will_end',
      processingStatus: 'processed',
      organizationId: unknownOrganizationId,
      stripeCustomerId: 'cus_unknown_audit',
      stripeSubscriptionId: 'sub_unknown_audit',
      createdAt: new Date(now - 55_000),
    });
    await insertReserveAppBillingNotificationRow({
      organizationId: unknownOrganizationId,
      sequenceNumber: 1,
      notificationKind: 'trial_will_end',
      channel: 'web_push',
      deliveryState: 'provider_unknown',
      attemptNumber: 1,
      stripeEventId: 'evt_unknown_audit',
      recipientEmail: null,
      stripeCustomerId: 'cus_unknown_audit',
      stripeSubscriptionId: 'sub_unknown_audit',
      trialEndsAt: unknownTrialEndsAt,
      failureReason: 'push_provider_pending',
      createdAt: new Date(now - 50_000),
    });

    const [deliveredResponse, pendingResponse, failedResponse, missingResponse, unknownResponse] =
      await Promise.all([
        internalOperator.request(
          `/api/v1/auth/internal/organizations/${encodeURIComponent(deliveredOrganizationId)}/billing-inspection`,
        ),
        internalOperator.request(
          `/api/v1/auth/internal/organizations/${encodeURIComponent(pendingOrganizationId)}/billing-inspection`,
        ),
        internalOperator.request(
          `/api/v1/auth/internal/organizations/${encodeURIComponent(failedOrganizationId)}/billing-inspection`,
        ),
        internalOperator.request(
          `/api/v1/auth/internal/organizations/${encodeURIComponent(missingOrganizationId)}/billing-inspection`,
        ),
        internalOperator.request(
          `/api/v1/auth/internal/organizations/${encodeURIComponent(unknownOrganizationId)}/billing-inspection`,
        ),
      ]);

    expect(deliveredResponse.status).toBe(200);
    expect(pendingResponse.status).toBe(200);
    expect(failedResponse.status).toBe(200);
    expect(missingResponse.status).toBe(200);
    expect(unknownResponse.status).toBe(200);

    const deliveredPayload = (await toJson(deliveredResponse)) as Record<string, unknown>;
    expect(deliveredPayload).toMatchObject({
      organizationId: deliveredOrganizationId,
      notifications: {
        reminderDelivery: {
          status: 'delivered',
          expected: true,
          eventFound: true,
          outcomeKnown: true,
          latestEventId: 'evt_delivered_audit',
          latestEventProcessingStatus: 'processed',
          latestSignalStatus: 'resolved',
          latestSignalReason: 'trial_reminder_delivery_succeeded',
        },
      },
    });
    expect(deliveredPayload).toHaveProperty(
      'notifications.reminderDelivery.history.0.deliveryState',
      'requested',
    );
    expect(deliveredPayload).toHaveProperty(
      'notifications.reminderDelivery.history.1.deliveryState',
      'sent',
    );
    expect(deliveredPayload).toHaveProperty(
      'notifications.reminderDelivery.history.1.recipientEmail',
      'reminder-audit-fixture-owner@example.com',
    );
    expect(deliveredPayload).toHaveProperty(
      'notifications.reminderDelivery.history.2.notificationKind',
      'trial_will_end',
    );
    expect(deliveredPayload).toHaveProperty(
      'notifications.reminderDelivery.history.2.communicationType',
      'trial_will_end',
    );
    expect(deliveredPayload).toHaveProperty(
      'notifications.reminderDelivery.history.2.channel',
      'web_push',
    );
    expect(deliveredPayload).toHaveProperty(
      'notifications.reminderDelivery.history.2.channelLabel',
      'プッシュ通知',
    );
    expect(deliveredPayload).toHaveProperty(
      'notifications.reminderDelivery.history.2.deliveryOutcome',
      'delivered',
    );

    const pendingPayload = (await toJson(pendingResponse)) as Record<string, unknown>;
    expect(pendingPayload).toMatchObject({
      organizationId: pendingOrganizationId,
      notifications: {
        reminderDelivery: {
          status: 'pending',
          expected: true,
          eventFound: true,
          outcomeKnown: false,
          latestEventId: 'evt_pending_audit',
          latestEventProcessingStatus: 'failed',
          latestSignalStatus: 'pending',
          latestSignalReason: 'resend_delivery_failed',
          latestFailureReason: 'resend_delivery_failed',
        },
      },
    });
    expect(pendingPayload).toHaveProperty(
      'notifications.reminderDelivery.history.2.deliveryState',
      'retried',
    );

    const failedPayload = (await toJson(failedResponse)) as Record<string, unknown>;
    expect(failedPayload).toMatchObject({
      organizationId: failedOrganizationId,
      notifications: {
        reminderDelivery: {
          status: 'failed',
          expected: true,
          eventFound: true,
          outcomeKnown: true,
          latestEventId: 'evt_failed_audit',
          latestEventProcessingStatus: 'failed',
          latestSignalStatus: 'unavailable',
          latestSignalReason: 'owner_not_found',
          latestFailureReason: 'owner_not_found',
        },
      },
    });
    expect(failedPayload).toHaveProperty(
      'notifications.reminderDelivery.history.1.failureReason',
      'owner_not_found',
    );

    const missingPayload = (await toJson(missingResponse)) as Record<string, unknown>;
    expect(missingPayload).toMatchObject({
      organizationId: missingOrganizationId,
      notifications: {
        reminderDelivery: {
          status: 'missing',
          expected: true,
          eventFound: false,
          outcomeKnown: false,
          latestEventId: null,
          latestSignalStatus: null,
        },
      },
    });
    expect(missingPayload).toHaveProperty('notifications.reminderDelivery.history', []);

    const unknownPayload = (await toJson(unknownResponse)) as Record<string, unknown>;
    expect(unknownPayload).toMatchObject({
      organizationId: unknownOrganizationId,
      notifications: {
        reminderDelivery: {
          status: 'unknown',
          expected: true,
          eventFound: true,
          outcomeKnown: false,
          latestEventId: 'evt_unknown_audit',
          latestEventProcessingStatus: 'processed',
          latestSignalStatus: null,
        },
      },
    });
    expect(unknownPayload).toHaveProperty(
      'notifications.reminderDelivery.history.0.channel',
      'web_push',
    );
    expect(unknownPayload).toHaveProperty(
      'notifications.reminderDelivery.history.0.channelLabel',
      'プッシュ通知',
    );
    expect(unknownPayload).toHaveProperty(
      'notifications.reminderDelivery.history.0.deliveryState',
      'unknown',
    );
    expect(unknownPayload).toHaveProperty(
      'notifications.reminderDelivery.history.0.deliveryOutcome',
      'unknown',
    );
    expect(unknownPayload).toHaveProperty(
      'notifications.reminderDelivery.history.0.failureReason',
      'push_provider_pending',
    );
  });

  it('不一致・復旧一致・保留・利用不可・未完了・対象外組織の内部照合診断を返す', async () => {
    const authRuntimeWithInternalInspection = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        INTERNAL_OPERATOR_EMAILS: 'internal-ops-reconciliation@example.com',
        STRIPE_PREMIUM_YEARLY_PRICE_ID: 'price_reconciliation_linked_no_signal',
      },
    });
    const appWithInternalInspection = createApp(authRuntimeWithInternalInspection);

    const internalOperator = createAuthAgent(appWithInternalInspection);
    await signUpUser({
      agent: internalOperator,
      name: 'Internal Reconciliation Operator',
      email: 'internal-ops-reconciliation@example.com',
    });
    await setUserEmailVerified({ email: 'internal-ops-reconciliation@example.com' });

    const owner = createAuthAgent(appWithInternalInspection);
    await signUpUser({
      agent: owner,
      name: 'Reconciliation Fixture Owner',
      email: 'reconciliation-fixture-owner@example.com',
    });

    const mismatchOrganizationId = await createOrganization({
      agent: owner,
      name: 'Reconciliation Mismatch Org',
      slug: 'reconciliation-mismatch-org',
    });
    const recoveredOrganizationId = await createOrganization({
      agent: owner,
      name: 'Reconciliation Recovered Org',
      slug: 'reconciliation-recovered-org',
    });
    const pendingOrganizationId = await createOrganization({
      agent: owner,
      name: 'Reconciliation Pending Org',
      slug: 'reconciliation-pending-org',
    });
    const unavailableOrganizationId = await createOrganization({
      agent: owner,
      name: 'Reconciliation Unavailable Org',
      slug: 'reconciliation-unavailable-org',
    });
    const linkedWithoutSignalOrganizationId = await createOrganization({
      agent: owner,
      name: 'Reconciliation Linked Without Signal Org',
      slug: 'reconciliation-linked-without-signal-org',
    });
    const freeOrganizationId = await createOrganization({
      agent: owner,
      name: 'Reconciliation Free Org',
      slug: 'reconciliation-free-org',
    });

    const now = Date.now();
    const futurePeriodEnd = new Date(now + 14 * 24 * 60 * 60 * 1000);
    const futureTrialEnd = new Date(now + 2 * 24 * 60 * 60 * 1000);
    const currentPeriodStart = new Date(now - 2 * 24 * 60 * 60 * 1000);

    await setOrganizationBillingState({
      organizationId: mismatchOrganizationId,
      planCode: 'premium',
      subscriptionStatus: 'active',
      billingInterval: 'month',
      currentPeriodStart,
      currentPeriodEnd: futurePeriodEnd,
      stripeCustomerId: 'cus_reconciliation_mismatch',
      stripeSubscriptionId: 'sub_reconciliation_mismatch',
      stripePriceId: 'price_reconciliation_mismatch',
    });
    await insertOrganizationBillingSignalRow({
      organizationId: mismatchOrganizationId,
      sequenceNumber: 1,
      signalKind: 'reconciliation',
      signalStatus: 'mismatch',
      sourceKind: 'webhook_subscription_lifecycle',
      reason: 'plan_state_mismatch',
      stripeEventId: 'evt_reconciliation_mismatch',
      stripeCustomerId: 'cus_reconciliation_mismatch',
      stripeSubscriptionId: 'sub_reconciliation_mismatch',
      providerPlanState: 'free',
      providerSubscriptionStatus: 'canceled',
      appPlanState: 'premium_paid',
      appSubscriptionStatus: 'active',
      appPaymentMethodStatus: 'registered',
      appEntitlementState: 'premium_enabled',
      createdAt: new Date(now - 140_000),
    });
    await insertStripeWebhookEventRow({
      id: 'evt_reconciliation_mismatch',
      eventType: 'customer.subscription.deleted',
      processingStatus: 'processed',
      organizationId: mismatchOrganizationId,
      stripeCustomerId: 'cus_reconciliation_mismatch',
      stripeSubscriptionId: 'sub_reconciliation_mismatch',
      createdAt: new Date(now - 145_000),
    });

    await setOrganizationBillingState({
      organizationId: recoveredOrganizationId,
      planCode: 'premium',
      subscriptionStatus: 'active',
      billingInterval: 'month',
      currentPeriodStart,
      currentPeriodEnd: futurePeriodEnd,
      stripeCustomerId: 'cus_reconciliation_recovered',
      stripeSubscriptionId: 'sub_reconciliation_recovered',
      stripePriceId: 'price_reconciliation_recovered',
    });
    await insertOrganizationBillingAuditEventRow({
      organizationId: recoveredOrganizationId,
      sequenceNumber: 1,
      sourceKind: 'webhook_checkout_completed',
      previousPlanCode: 'free',
      nextPlanCode: 'premium',
      previousPlanState: 'free',
      nextPlanState: 'premium_paid',
      previousSubscriptionStatus: 'free',
      nextSubscriptionStatus: 'active',
      previousPaymentMethodStatus: 'not_started',
      nextPaymentMethodStatus: 'registered',
      previousEntitlementState: 'free_only',
      nextEntitlementState: 'premium_enabled',
      nextBillingInterval: 'month',
      stripeCustomerId: 'cus_reconciliation_recovered',
      stripeSubscriptionId: 'sub_reconciliation_recovered',
      stripeEventId: 'evt_recovered_checkout',
      sourceContext: 'checkout.session.completed',
      createdAt: new Date(now - 210_000),
    });
    await insertOrganizationBillingAuditEventRow({
      organizationId: recoveredOrganizationId,
      sequenceNumber: 2,
      sourceKind: 'webhook_subscription_lifecycle',
      previousPlanCode: 'premium',
      nextPlanCode: 'premium',
      previousPlanState: 'premium_paid',
      nextPlanState: 'premium_paid',
      previousSubscriptionStatus: 'active',
      nextSubscriptionStatus: 'active',
      previousPaymentMethodStatus: 'registered',
      nextPaymentMethodStatus: 'registered',
      previousEntitlementState: 'premium_enabled',
      nextEntitlementState: 'premium_enabled',
      previousBillingInterval: 'month',
      nextBillingInterval: 'month',
      stripeCustomerId: 'cus_reconciliation_recovered',
      stripeSubscriptionId: 'sub_reconciliation_recovered',
      stripeEventId: 'evt_recovered_subscription',
      sourceContext: 'customer.subscription.updated',
      createdAt: new Date(now - 120_000),
    });
    await insertOrganizationBillingSignalRow({
      organizationId: recoveredOrganizationId,
      sequenceNumber: 1,
      signalKind: 'reconciliation',
      signalStatus: 'mismatch',
      sourceKind: 'webhook_subscription_lifecycle',
      reason: 'plan_state_mismatch',
      stripeEventId: 'evt_recovered_checkout',
      stripeCustomerId: 'cus_reconciliation_recovered',
      stripeSubscriptionId: 'sub_reconciliation_recovered',
      providerPlanState: 'free',
      providerSubscriptionStatus: 'canceled',
      appPlanState: 'premium_paid',
      appSubscriptionStatus: 'active',
      appPaymentMethodStatus: 'registered',
      appEntitlementState: 'premium_enabled',
      createdAt: new Date(now - 180_000),
    });
    await insertOrganizationBillingSignalRow({
      organizationId: recoveredOrganizationId,
      sequenceNumber: 2,
      signalKind: 'reconciliation',
      signalStatus: 'resolved',
      sourceKind: 'webhook_subscription_lifecycle',
      reason: 'provider_and_app_state_aligned',
      stripeEventId: 'evt_recovered_subscription',
      stripeCustomerId: 'cus_reconciliation_recovered',
      stripeSubscriptionId: 'sub_reconciliation_recovered',
      providerPlanState: 'premium_paid',
      providerSubscriptionStatus: 'active',
      appPlanState: 'premium_paid',
      appSubscriptionStatus: 'active',
      appPaymentMethodStatus: 'registered',
      appEntitlementState: 'premium_enabled',
      createdAt: new Date(now - 110_000),
    });
    await insertOrganizationBillingSignalRow({
      organizationId: recoveredOrganizationId,
      sequenceNumber: 3,
      signalKind: 'notification_delivery',
      signalStatus: 'resolved',
      sourceKind: 'trial_will_end_email',
      reason: 'trial_reminder_delivery_succeeded',
      stripeEventId: 'evt_recovered_notification',
      stripeCustomerId: 'cus_reconciliation_recovered',
      stripeSubscriptionId: 'sub_reconciliation_recovered',
      appPlanState: 'premium_paid',
      appSubscriptionStatus: 'active',
      appPaymentMethodStatus: 'registered',
      appEntitlementState: 'premium_enabled',
      createdAt: new Date(now - 60_000),
    });
    await insertStripeWebhookEventRow({
      id: 'evt_recovered_checkout',
      eventType: 'checkout.session.completed',
      processingStatus: 'processed',
      organizationId: recoveredOrganizationId,
      stripeCustomerId: 'cus_reconciliation_recovered',
      stripeSubscriptionId: 'sub_reconciliation_recovered',
      createdAt: new Date(now - 205_000),
    });
    await insertStripeWebhookEventRow({
      id: 'evt_recovered_subscription',
      eventType: 'customer.subscription.updated',
      processingStatus: 'processed',
      organizationId: recoveredOrganizationId,
      stripeCustomerId: 'cus_reconciliation_recovered',
      stripeSubscriptionId: 'sub_reconciliation_recovered',
      createdAt: new Date(now - 115_000),
    });

    await setOrganizationBillingState({
      organizationId: pendingOrganizationId,
      planCode: 'premium',
      subscriptionStatus: 'trialing',
      billingInterval: null,
      currentPeriodEnd: futureTrialEnd,
      stripeCustomerId: 'cus_reconciliation_pending',
      stripeSubscriptionId: 'sub_reconciliation_pending',
      stripePriceId: 'price_reconciliation_pending',
    });
    await insertOrganizationBillingSignalRow({
      organizationId: pendingOrganizationId,
      sequenceNumber: 1,
      signalKind: 'reconciliation',
      signalStatus: 'pending',
      sourceKind: 'webhook_trial_completion',
      reason: 'trial_completion_pending',
      stripeEventId: 'evt_reconciliation_pending',
      stripeCustomerId: 'cus_reconciliation_pending',
      stripeSubscriptionId: 'sub_reconciliation_pending',
      providerPlanState: 'premium_trial',
      providerSubscriptionStatus: 'trialing',
      appPlanState: 'premium_trial',
      appSubscriptionStatus: 'trialing',
      appPaymentMethodStatus: 'pending',
      appEntitlementState: 'premium_enabled',
      createdAt: new Date(now - 80_000),
    });
    await insertStripeWebhookEventRow({
      id: 'evt_reconciliation_pending',
      eventType: 'customer.subscription.updated',
      processingStatus: 'failed',
      organizationId: pendingOrganizationId,
      stripeCustomerId: 'cus_reconciliation_pending',
      stripeSubscriptionId: 'sub_reconciliation_pending',
      failureReason: 'trial_completion_pending',
      createdAt: new Date(now - 82_000),
    });

    await setOrganizationBillingState({
      organizationId: unavailableOrganizationId,
      planCode: 'premium',
      subscriptionStatus: 'active',
      billingInterval: 'month',
      currentPeriodStart,
      currentPeriodEnd: futurePeriodEnd,
      stripeCustomerId: 'cus_reconciliation_unavailable',
      stripeSubscriptionId: 'sub_reconciliation_unavailable',
      stripePriceId: 'price_reconciliation_unavailable',
    });
    await insertOrganizationBillingSignalRow({
      organizationId: unavailableOrganizationId,
      sequenceNumber: 1,
      signalKind: 'reconciliation',
      signalStatus: 'unavailable',
      sourceKind: 'webhook_subscription_lifecycle',
      reason: 'provider_subscription_unavailable',
      stripeEventId: 'evt_reconciliation_unavailable',
      stripeCustomerId: 'cus_reconciliation_unavailable',
      stripeSubscriptionId: 'sub_reconciliation_unavailable',
      appPlanState: 'premium_paid',
      appSubscriptionStatus: 'active',
      appPaymentMethodStatus: 'registered',
      appEntitlementState: 'premium_enabled',
      createdAt: new Date(now - 70_000),
    });
    await insertStripeWebhookEventRow({
      id: 'evt_reconciliation_unavailable',
      eventType: 'customer.subscription.updated',
      processingStatus: 'failed',
      organizationId: unavailableOrganizationId,
      stripeCustomerId: 'cus_reconciliation_unavailable',
      stripeSubscriptionId: 'sub_reconciliation_unavailable',
      failureReason: 'latest_subscription_lookup_failed',
      createdAt: new Date(now - 75_000),
    });
    await insertStripeWebhookFailureRow({
      eventId: 'evt_reconciliation_unavailable',
      eventType: 'customer.subscription.updated',
      failureStage: 'provider_reconciliation',
      failureReason: 'provider_lookup_failed',
      organizationId: unavailableOrganizationId,
      stripeCustomerId: 'cus_reconciliation_unavailable',
      stripeSubscriptionId: 'sub_reconciliation_unavailable',
      createdAt: new Date(now - 74_000),
    });

    await setOrganizationBillingState({
      organizationId: linkedWithoutSignalOrganizationId,
      planCode: 'premium',
      subscriptionStatus: 'active',
      billingInterval: 'year',
      currentPeriodStart,
      currentPeriodEnd: futurePeriodEnd,
      stripeCustomerId: 'cus_reconciliation_linked_no_signal',
      stripeSubscriptionId: 'sub_reconciliation_linked_no_signal',
      stripePriceId: 'price_reconciliation_linked_no_signal',
    });

    const [
      mismatchResponse,
      recoveredResponse,
      pendingResponse,
      unavailableResponse,
      linkedWithoutSignalResponse,
      freeResponse,
    ] = await Promise.all([
      internalOperator.request(
        `/api/v1/auth/internal/organizations/${encodeURIComponent(mismatchOrganizationId)}/billing-inspection`,
      ),
      internalOperator.request(
        `/api/v1/auth/internal/organizations/${encodeURIComponent(recoveredOrganizationId)}/billing-inspection`,
      ),
      internalOperator.request(
        `/api/v1/auth/internal/organizations/${encodeURIComponent(pendingOrganizationId)}/billing-inspection`,
      ),
      internalOperator.request(
        `/api/v1/auth/internal/organizations/${encodeURIComponent(unavailableOrganizationId)}/billing-inspection`,
      ),
      internalOperator.request(
        `/api/v1/auth/internal/organizations/${encodeURIComponent(linkedWithoutSignalOrganizationId)}/billing-inspection`,
      ),
      internalOperator.request(
        `/api/v1/auth/internal/organizations/${encodeURIComponent(freeOrganizationId)}/billing-inspection`,
      ),
    ]);

    expect(mismatchResponse.status).toBe(200);
    expect(recoveredResponse.status).toBe(200);
    expect(pendingResponse.status).toBe(200);
    expect(unavailableResponse.status).toBe(200);
    expect(linkedWithoutSignalResponse.status).toBe(200);
    expect(freeResponse.status).toBe(200);

    const mismatchPayload = (await toJson(mismatchResponse)) as Record<string, unknown>;
    expect(mismatchPayload).toMatchObject({
      organizationId: mismatchOrganizationId,
      reconciliation: {
        status: 'mismatch',
        comparable: true,
        latestSignalStatus: 'mismatch',
        latestSignalReason: 'plan_state_mismatch',
        currentComparison: {
          providerPlanState: 'free',
          providerSubscriptionStatus: 'canceled',
          appPlanState: 'premium_paid',
          appSubscriptionStatus: 'active',
          appPaymentMethodStatus: 'registered',
          appEntitlementState: 'premium_enabled',
        },
      },
    });
    expect(mismatchPayload).toHaveProperty(
      'reconciliation.recentSignals.0.reason',
      'plan_state_mismatch',
    );
    expect(mismatchPayload).toHaveProperty(
      'reconciliation.recentWebhookEvents.0.id',
      'evt_reconciliation_mismatch',
    );

    const recoveredPayload = (await toJson(recoveredResponse)) as Record<string, unknown>;
    expect(recoveredPayload).toMatchObject({
      organizationId: recoveredOrganizationId,
      provider: {
        stripeCustomerId: 'cus_reconciliation_recovered',
        stripeSubscriptionId: 'sub_reconciliation_recovered',
        stripePriceId: 'price_reconciliation_recovered',
        providerPlanState: 'premium_paid',
        providerSubscriptionStatus: 'active',
      },
      reconciliation: {
        status: 'aligned',
        comparable: true,
        latestSignalStatus: 'resolved',
        latestSignalReason: 'provider_and_app_state_aligned',
        currentComparison: {
          providerPlanState: 'premium_paid',
          providerSubscriptionStatus: 'active',
          appPlanState: 'premium_paid',
          appSubscriptionStatus: 'active',
          appPaymentMethodStatus: 'registered',
          appEntitlementState: 'premium_enabled',
        },
      },
    });
    expect(recoveredPayload).toHaveProperty(
      'reconciliation.recentSignals.0.signalStatus',
      'mismatch',
    );
    expect(recoveredPayload).toHaveProperty(
      'reconciliation.recentSignals.1.signalStatus',
      'resolved',
    );
    expect(recoveredPayload).toHaveProperty(
      'reconciliation.recentWebhookEvents.0.id',
      'evt_recovered_checkout',
    );
    expect(recoveredPayload).toHaveProperty(
      'reconciliation.recentWebhookEvents.1.id',
      'evt_recovered_subscription',
    );

    const pendingPayload = (await toJson(pendingResponse)) as Record<string, unknown>;
    expect(pendingPayload).toMatchObject({
      organizationId: pendingOrganizationId,
      reconciliation: {
        status: 'pending',
        comparable: true,
        latestSignalStatus: 'pending',
        latestSignalReason: 'trial_completion_pending',
        currentComparison: {
          providerPlanState: 'premium_trial',
          providerSubscriptionStatus: 'trialing',
          appPlanState: 'premium_trial',
          appSubscriptionStatus: 'trialing',
          appPaymentMethodStatus: 'pending',
          appEntitlementState: 'premium_enabled',
        },
      },
    });

    const unavailablePayload = (await toJson(unavailableResponse)) as Record<string, unknown>;
    expect(unavailablePayload).toMatchObject({
      organizationId: unavailableOrganizationId,
      reconciliation: {
        status: 'unavailable',
        comparable: false,
        latestSignalStatus: 'unavailable',
        latestSignalReason: 'provider_subscription_unavailable',
        currentComparison: {
          providerPlanState: null,
          providerSubscriptionStatus: null,
          appPlanState: 'premium_paid',
          appSubscriptionStatus: 'active',
          appPaymentMethodStatus: 'registered',
          appEntitlementState: 'premium_enabled',
        },
      },
    });
    expect(unavailablePayload).toHaveProperty(
      'reconciliation.recentWebhookFailures.0.failureStage',
      'provider_reconciliation',
    );
    expect(unavailablePayload).toHaveProperty(
      'reconciliation.recentWebhookFailures.0.failureReason',
      'provider_lookup_failed',
    );

    const linkedWithoutSignalPayload = (await toJson(linkedWithoutSignalResponse)) as Record<
      string,
      unknown
    >;
    expect(linkedWithoutSignalPayload).toMatchObject({
      organizationId: linkedWithoutSignalOrganizationId,
      reconciliation: {
        status: 'incomplete',
        comparable: false,
        latestSignalStatus: null,
        latestSignalReason: null,
        currentComparison: {
          providerPlanState: null,
          providerSubscriptionStatus: null,
          appPlanState: 'premium_paid',
          appSubscriptionStatus: 'active',
          appPaymentMethodStatus: 'registered',
          appEntitlementState: 'premium_enabled',
        },
      },
    });
    expect(linkedWithoutSignalPayload).toHaveProperty('reconciliation.recentSignals', []);

    const freePayload = (await toJson(freeResponse)) as Record<string, unknown>;
    expect(freePayload).toMatchObject({
      organizationId: freeOrganizationId,
      reconciliation: {
        status: 'not_applicable',
        comparable: false,
        latestSignalStatus: null,
        latestSignalReason: null,
        currentComparison: {
          providerPlanState: null,
          providerSubscriptionStatus: null,
          appPlanState: 'free',
          appSubscriptionStatus: 'free',
          appPaymentMethodStatus: 'not_started',
          appEntitlementState: 'free_only',
        },
      },
    });
    expect(freePayload).toHaveProperty('reconciliation.recentWebhookEvents', []);
  });

  it('課金・リマインド・照合・Webhook 文脈を関連付けた内部課金調査タイムラインを返す', async () => {
    const authRuntimeWithInternalInspection = createAuthRuntime({
      database: drizzle(d1),
      env: {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        INTERNAL_OPERATOR_EMAILS: 'internal-ops-timeline@example.com',
      },
    });
    const appWithInternalInspection = createApp(authRuntimeWithInternalInspection);

    const internalOperator = createAuthAgent(appWithInternalInspection);
    await signUpUser({
      agent: internalOperator,
      name: 'Internal Timeline Operator',
      email: 'internal-ops-timeline@example.com',
    });
    await setUserEmailVerified({ email: 'internal-ops-timeline@example.com' });

    const owner = createAuthAgent(appWithInternalInspection);
    await signUpUser({
      agent: owner,
      name: 'Timeline Fixture Owner',
      email: 'timeline-fixture-owner@example.com',
    });

    const timelineOrganizationId = await createOrganization({
      agent: owner,
      name: 'Timeline Investigation Org',
      slug: `timeline-investigation-${crypto.randomUUID().slice(0, 8)}`,
    });

    const now = Date.now();
    const currentPeriodStart = new Date(now - 3 * 24 * 60 * 60 * 1000);
    const futurePeriodEnd = new Date(now + 28 * 24 * 60 * 60 * 1000);
    const reminderTrialEnd = new Date(now + 2 * 24 * 60 * 60 * 1000);

    await setOrganizationBillingState({
      organizationId: timelineOrganizationId,
      planCode: 'premium',
      subscriptionStatus: 'active',
      billingInterval: 'month',
      currentPeriodStart,
      currentPeriodEnd: futurePeriodEnd,
      stripeCustomerId: 'cus_timeline_inspection',
      stripeSubscriptionId: 'sub_timeline_inspection',
      stripePriceId: 'price_timeline_inspection',
    });
    await insertOrganizationBillingAuditEventRow({
      organizationId: timelineOrganizationId,
      sequenceNumber: 1,
      sourceKind: 'trial_start',
      previousPlanCode: 'free',
      nextPlanCode: 'premium',
      previousPlanState: 'free',
      nextPlanState: 'premium_trial',
      previousSubscriptionStatus: 'free',
      nextSubscriptionStatus: 'trialing',
      previousPaymentMethodStatus: 'not_started',
      nextPaymentMethodStatus: 'pending',
      previousEntitlementState: 'free_only',
      nextEntitlementState: 'premium_enabled',
      sourceContext: 'owner_started_premium_trial',
      stripeCustomerId: 'cus_timeline_inspection',
      createdAt: new Date(now - 320_000),
    });
    await insertStripeWebhookEventRow({
      id: 'evt_timeline_trial_will_end',
      eventType: 'customer.subscription.trial_will_end',
      processingStatus: 'processed',
      organizationId: timelineOrganizationId,
      stripeCustomerId: 'cus_timeline_inspection',
      stripeSubscriptionId: 'sub_timeline_inspection',
      createdAt: new Date(now - 250_000),
    });
    await insertReserveAppBillingNotificationRow({
      organizationId: timelineOrganizationId,
      sequenceNumber: 1,
      deliveryState: 'requested',
      attemptNumber: 1,
      stripeEventId: 'evt_timeline_trial_will_end',
      recipientEmail: 'timeline-fixture-owner@example.com',
      stripeCustomerId: 'cus_timeline_inspection',
      stripeSubscriptionId: 'sub_timeline_inspection',
      trialEndsAt: reminderTrialEnd,
      createdAt: new Date(now - 240_000),
    });
    await insertReserveAppBillingNotificationRow({
      organizationId: timelineOrganizationId,
      sequenceNumber: 2,
      deliveryState: 'sent',
      attemptNumber: 1,
      stripeEventId: 'evt_timeline_trial_will_end',
      recipientEmail: 'timeline-fixture-owner@example.com',
      stripeCustomerId: 'cus_timeline_inspection',
      stripeSubscriptionId: 'sub_timeline_inspection',
      trialEndsAt: reminderTrialEnd,
      createdAt: new Date(now - 230_000),
    });
    await insertReserveAppBillingNotificationRow({
      organizationId: timelineOrganizationId,
      sequenceNumber: 3,
      notificationKind: 'trial_will_end',
      channel: 'in_app',
      deliveryState: 'sent',
      attemptNumber: 1,
      stripeEventId: 'evt_timeline_trial_will_end',
      recipientEmail: null,
      stripeCustomerId: 'cus_timeline_inspection',
      stripeSubscriptionId: 'sub_timeline_inspection',
      trialEndsAt: reminderTrialEnd,
      createdAt: new Date(now - 220_000),
    });
    await insertStripeWebhookEventRow({
      id: 'evt_timeline_subscription_updated',
      eventType: 'customer.subscription.updated',
      processingStatus: 'failed',
      organizationId: timelineOrganizationId,
      stripeCustomerId: 'cus_timeline_inspection',
      stripeSubscriptionId: 'sub_timeline_inspection',
      failureReason: 'latest_subscription_lookup_failed',
      createdAt: new Date(now - 140_000),
    });
    await insertOrganizationBillingSignalRow({
      organizationId: timelineOrganizationId,
      sequenceNumber: 1,
      signalKind: 'reconciliation',
      signalStatus: 'unavailable',
      sourceKind: 'webhook_subscription_lifecycle',
      reason: 'provider_subscription_unavailable',
      stripeEventId: 'evt_timeline_subscription_updated',
      stripeCustomerId: 'cus_timeline_inspection',
      stripeSubscriptionId: 'sub_timeline_inspection',
      appPlanState: 'premium_trial',
      appSubscriptionStatus: 'trialing',
      appPaymentMethodStatus: 'registered',
      appEntitlementState: 'premium_enabled',
      createdAt: new Date(now - 130_000),
    });
    await insertStripeWebhookFailureRow({
      eventId: 'evt_timeline_subscription_updated',
      eventType: 'customer.subscription.updated',
      failureStage: 'provider_reconciliation',
      failureReason: 'provider_lookup_failed',
      organizationId: timelineOrganizationId,
      stripeCustomerId: 'cus_timeline_inspection',
      stripeSubscriptionId: 'sub_timeline_inspection',
      createdAt: new Date(now - 120_000),
    });
    await insertOrganizationBillingAuditEventRow({
      organizationId: timelineOrganizationId,
      sequenceNumber: 2,
      sourceKind: 'webhook_subscription_lifecycle',
      previousPlanCode: 'premium',
      nextPlanCode: 'premium',
      previousPlanState: 'premium_trial',
      nextPlanState: 'premium_paid',
      previousSubscriptionStatus: 'trialing',
      nextSubscriptionStatus: 'active',
      previousPaymentMethodStatus: 'registered',
      nextPaymentMethodStatus: 'registered',
      previousEntitlementState: 'premium_enabled',
      nextEntitlementState: 'premium_enabled',
      previousBillingInterval: null,
      nextBillingInterval: 'month',
      stripeEventId: 'evt_timeline_subscription_updated',
      stripeCustomerId: 'cus_timeline_inspection',
      stripeSubscriptionId: 'sub_timeline_inspection',
      sourceContext: 'stripe_subscription_activated',
      createdAt: new Date(now - 100_000),
    });
    await insertOrganizationBillingSignalRow({
      organizationId: timelineOrganizationId,
      sequenceNumber: 2,
      signalKind: 'reconciliation',
      signalStatus: 'resolved',
      sourceKind: 'webhook_subscription_lifecycle',
      reason: 'provider_and_app_state_aligned',
      stripeEventId: 'evt_timeline_subscription_updated',
      stripeCustomerId: 'cus_timeline_inspection',
      stripeSubscriptionId: 'sub_timeline_inspection',
      providerPlanState: 'premium_paid',
      providerSubscriptionStatus: 'active',
      appPlanState: 'premium_paid',
      appSubscriptionStatus: 'active',
      appPaymentMethodStatus: 'registered',
      appEntitlementState: 'premium_enabled',
      createdAt: new Date(now - 90_000),
    });

    const response = await internalOperator.request(
      `/api/v1/auth/internal/organizations/${encodeURIComponent(timelineOrganizationId)}/billing-inspection`,
    );
    expect(response.status).toBe(200);

    const payload = (await toJson(response)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      organizationId: timelineOrganizationId,
      timeline: {
        entries: expect.any(Array),
      },
    });

    const timelineEntries = (payload.timeline as Record<string, unknown>).entries as Array<
      Record<string, unknown>
    >;
    expect(timelineEntries.length).toBeGreaterThanOrEqual(10);
    expect(timelineEntries.map((entry) => entry.lane)).toEqual(
      expect.arrayContaining([
        'billing_state',
        'notification',
        'reconciliation',
        'provider_webhook',
      ]),
    );
    expect(timelineEntries.map((entry) => entry.entryType)).toEqual([
      'audit_event',
      'webhook_event',
      'notification',
      'notification',
      'notification',
      'webhook_event',
      'signal',
      'webhook_failure',
      'audit_event',
      'signal',
    ]);
    expect(timelineEntries.map((entry) => Date.parse(String(entry.occurredAt)))).toEqual(
      [...timelineEntries.map((entry) => Date.parse(String(entry.occurredAt)))].sort(
        (left, right) => left - right,
      ),
    );
    expect(timelineEntries[0]).toMatchObject({
      lane: 'billing_state',
      entryType: 'audit_event',
      headline: 'Billing state changed',
      sequenceNumber: 1,
      sourceKind: 'trial_start',
    });
    expect(timelineEntries[2]).toMatchObject({
      lane: 'notification',
      entryType: 'notification',
      stripeEventId: 'evt_timeline_trial_will_end',
      deliveryState: 'requested',
      notificationChannel: 'email',
    });
    expect(timelineEntries[4]).toMatchObject({
      lane: 'notification',
      entryType: 'notification',
      stripeEventId: 'evt_timeline_trial_will_end',
      deliveryState: 'sent',
      notificationChannel: 'in_app',
    });
    expect(timelineEntries[6]).toMatchObject({
      lane: 'reconciliation',
      entryType: 'signal',
      stripeEventId: 'evt_timeline_subscription_updated',
      signalKind: 'reconciliation',
      signalStatus: 'unavailable',
      summary: 'provider_subscription_unavailable',
    });
    expect(timelineEntries[7]).toMatchObject({
      lane: 'provider_webhook',
      entryType: 'webhook_failure',
      stripeEventId: 'evt_timeline_subscription_updated',
      webhookFailureStage: 'provider_reconciliation',
    });
    expect(timelineEntries[9]).toMatchObject({
      lane: 'reconciliation',
      entryType: 'signal',
      signalStatus: 'resolved',
      summary: 'provider_and_app_state_aligned',
    });
    expect(payload).not.toHaveProperty('actions');
    expect(payload).not.toHaveProperty('rawProviderPayload');
  });

  it('API ルートに CORS ヘッダーを設定する', async () => {
    const origin = 'http://localhost:5173';
    const response = await app.request('/api/health', {
      headers: {
        Origin: origin,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('認証 CORS プリフライトリクエストに応答する', async () => {
    const origin = 'http://localhost:5173';
    const response = await app.request('/api/auth/sign-in', {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
      },
    });

    expect([200, 204]).toContain(response.status);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('OpenAPI スキーマを提供する', async () => {
    const response = await app.request('/api/openapi.json');

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.openapi).toBe('3.0.0');
    expect(body.paths['/api/v1/auth/sign-in']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations']).toBeDefined();
    expect(body.paths['/api/v1/auth/orgs/{orgSlug}/invitations']).toBeDefined();
    expect(body.paths['/api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/invitations']).toBeDefined();
    expect(body.paths['/api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/public-site']).toBeDefined();
    expect(body.paths['/api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms']).toBeDefined();
    expect(
      body.paths['/api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}'],
    ).toBeDefined();
    expect(
      body.paths['/api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/publish'],
    ).toBeDefined();
    expect(
      body.paths['/api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/required'],
    ).toBeDefined();
    expect(
      body.paths['/api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/forms/{formId}/assignments'],
    ).toBeDefined();
    expect(
      body.paths['/api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/form-submissions/{submissionId}'],
    ).toBeDefined();
    expect(
      body.paths['/api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/intake-fields'],
    ).toBeUndefined();
    expect(
      body.paths['/api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/notification-settings'],
    ).toBeDefined();
    expect(
      body.paths['/api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}/reminder-settings'],
    ).toBeDefined();
    expect(body.paths['/api/v1/auth/invitations/user']).toBeDefined();
    expect(body.paths['/api/v1/auth/invitations/{invitationId}']).toBeDefined();
    expect(body.paths['/api/v1/auth/invitations/{invitationId}/accept']).toBeDefined();
    expect(body.paths['/api/v1/auth/invitations/{invitationId}/reject']).toBeDefined();
    expect(body.paths['/api/v1/auth/invitations/{invitationId}/cancel']).toBeDefined();
    const scopedAuthPrefix = '/api/v1/auth/orgs/{orgSlug}/stores/{storeSlug}';
    for (const suffix of [
      '/participants',
      '/participants/self-enroll',
      '/services',
      '/services/images/upload-url',
      '/services/update',
      '/services/archive',
      '/slots',
      '/slots/update',
      '/slots/public-status',
      '/slots/available',
      '/slots/cancel',
      '/recurring-schedules',
      '/recurring-schedules/update',
      '/recurring-schedules/exceptions',
      '/recurring-schedules/generate',
      '/bookings',
      '/bookings/mine',
      '/bookings/cancel',
      '/bookings/cancel-by-staff',
      '/bookings/approve',
      '/bookings/reject',
      '/bookings/reschedule',
      '/bookings/no-show',
      '/bookings/check-in',
      '/bookings/staff-create',
      '/ticket-types',
      '/ticket-types/update',
      '/ticket-types/purchasable',
      '/ticket-packs',
      '/ticket-packs/grant',
      '/ticket-packs/adjust',
      '/ticket-packs/mine',
      '/ticket-purchases',
      '/ticket-purchases/mine',
      '/ticket-purchases/approve',
      '/ticket-purchases/reject',
      '/ticket-purchases/cancel',
    ]) {
      expect(body.paths[`${scopedAuthPrefix}${suffix}`]).toBeDefined();
    }
    expect(body.paths['/api/v1/auth/services/images/upload/{token}']).toBeDefined();
    expect(body.paths['/api/v1/auth/services/images/{key}']).toBeDefined();
    expect(body.paths['/api/v1/auth/organizations/services']).toBeUndefined();
    expect(body.paths['/api/v1/auth/organizations/slots']).toBeUndefined();
    expect(body.paths['/api/v1/auth/organizations/bookings']).toBeUndefined();
    expect(body.paths['/api/v1/auth/organizations/participants/self-enroll']).toBeUndefined();
    expect(body.paths['/api/v1/auth/organizations/ticket-types']).toBeUndefined();
    expect(body.paths['/api/v1/auth/organizations/recurring-schedules']).toBeUndefined();
    expect(body.paths['/api/v1/auth/organizations/billing']).toBeDefined();
    expect(
      body.paths['/api/v1/auth/internal/organizations/{organizationId}/billing-inspection'],
    ).toBeDefined();
    expect(JSON.stringify(body)).toContain('plan_transition');
    expect(JSON.stringify(body)).toContain('reconciliation');
    expect(JSON.stringify(body)).toContain('history');
    expect(JSON.stringify(body)).toContain('reminderDelivery');
    expect(JSON.stringify(body)).toContain('reconciliation');
    expect(JSON.stringify(body)).toContain('timeline');
    expect(body.paths['/api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/site']).toBeDefined();
    expect(body.paths['/api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/events']).toBeDefined();
    expect(
      body.paths['/api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/events/{slotId}'],
    ).toBeDefined();
    expect(
      body.paths['/api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/forms/required'],
    ).toBeDefined();
    expect(
      body.paths['/api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/ticket-types/{ticketTypeId}'],
    ).toBeDefined();
    expect(body.paths['/api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/bookings']).toBeDefined();
    expect(
      body.paths[
        '/api/v1/public/orgs/{orgSlug}/stores/{storeSlug}/bookings/{bookingPublicId}/cancel'
      ],
    ).toBeDefined();
  });
});
