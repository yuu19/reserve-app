import {
  createActiveEntitlementInput,
  type BillingEntitlementInput,
} from '@repo/saas-billing-core';
import type { ReserveAppBillingPaymentIssueState } from './reserve-app-payment-policy.js';

export const RESERVE_APP_ENTITLEMENTS = {
  ORGANIZATION_PREMIUM: 'organization.premium',
  STORE_MULTIPLE: 'store.multiple',
  STAFF_INVITE: 'staff.invite',
  BOOKING_APPROVAL: 'booking.approval',
  TICKET_ENABLED: 'ticket.enabled',
  ADVANCED_BILLING_COMMUNICATIONS: 'billing.advanced_communications',
} as const;

export type ReserveAppEntitlementKey =
  (typeof RESERVE_APP_ENTITLEMENTS)[keyof typeof RESERVE_APP_ENTITLEMENTS];

export const reserveAppBillingSubject = (organizationId: string) => ({
  subjectType: 'organization' as const,
  subjectId: organizationId,
});

export type ReserveAppBillingProjectionInput = {
  planCode: 'free' | 'premium';
  subscriptionStatus:
    | 'free'
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'incomplete';
  trialEnd?: Date | null;
  currentPeriodEnd?: Date | null;
  paymentIssue?: {
    state: ReserveAppBillingPaymentIssueState;
    pastDueGraceEndsAt?: Date | null;
  } | null;
  unknownPrice?: boolean;
  now?: Date;
};

const premiumEntitlementKeys = [
  RESERVE_APP_ENTITLEMENTS.ORGANIZATION_PREMIUM,
  RESERVE_APP_ENTITLEMENTS.STORE_MULTIPLE,
  RESERVE_APP_ENTITLEMENTS.STAFF_INVITE,
  RESERVE_APP_ENTITLEMENTS.BOOKING_APPROVAL,
  RESERVE_APP_ENTITLEMENTS.TICKET_ENABLED,
] satisfies ReserveAppEntitlementKey[];

const isFuture = (value: Date | null | undefined, now: Date) =>
  value instanceof Date && value.getTime() > now.getTime();

const buildPremiumEntitlements = ({
  source,
  reason,
  validUntil,
}: {
  source: 'trial' | 'paid';
  reason: string;
  validUntil?: Date | null;
}): BillingEntitlementInput[] =>
  premiumEntitlementKeys.map((key) =>
    createActiveEntitlementInput({
      key,
      source,
      reason,
      validUntil,
    }),
  );

export const projectReserveAppEntitlements = ({
  planCode,
  subscriptionStatus,
  trialEnd = null,
  currentPeriodEnd = null,
  paymentIssue = null,
  unknownPrice = false,
  now = new Date(),
}: ReserveAppBillingProjectionInput): BillingEntitlementInput[] => {
  if (planCode !== 'premium' || unknownPrice) {
    return [];
  }

  if (subscriptionStatus === 'trialing' && isFuture(trialEnd ?? currentPeriodEnd, now)) {
    return buildPremiumEntitlements({
      source: 'trial',
      reason: 'premium_trial_active',
      validUntil: trialEnd ?? currentPeriodEnd,
    });
  }

  if (subscriptionStatus === 'active') {
    return buildPremiumEntitlements({
      source: 'paid',
      reason: 'premium_paid_active',
      validUntil: currentPeriodEnd,
    });
  }

  if (
    subscriptionStatus === 'past_due' &&
    paymentIssue?.state === 'past_due_grace_active' &&
    isFuture(paymentIssue.pastDueGraceEndsAt, now)
  ) {
    return buildPremiumEntitlements({
      source: 'paid',
      reason: 'premium_paid_past_due_grace_active',
      validUntil: paymentIssue.pastDueGraceEndsAt,
    });
  }

  return [];
};
