import { render, toPlainText } from '@react-email/render';
import { createElement } from 'react';
import { BookingNotificationEmail } from './templates/booking-notification-email.js';
import { OrganizationInvitationEmail } from './templates/organization-invitation-email.js';
import { ParticipantInvitationEmail } from './templates/participant-invitation-email.js';

export type ResendEnv = {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  INVITATION_ACCEPT_URL_BASE?: string;
  PARTICIPANT_INVITATION_ACCEPT_URL_BASE?: string;
  WEB_BASE_URL?: string;
};

type SendInvitationInput = {
  env: ResendEnv;
  invitationId: string;
  inviteeEmail: string;
  inviterName?: string | null;
  inviterEmail?: string | null;
  organizationName: string;
  role: string;
};

type SendParticipantInvitationInput = {
  env: ResendEnv;
  invitationId: string;
  inviteeEmail: string;
  participantName: string;
  inviterName?: string | null;
  inviterEmail?: string | null;
  organizationName: string;
};

export type BookingNotificationEvent =
  | 'booking_confirmed'
  | 'booking_application_received'
  | 'booking_approved'
  | 'booking_rejected'
  | 'booking_cancelled_by_participant'
  | 'booking_cancelled_by_staff'
  | 'booking_no_show';

export type SendBookingNotificationInput = {
  env: ResendEnv;
  inviteeEmail: string;
  organizationName: string;
  participantName: string;
  serviceName: string;
  participantsCount: number;
  slotStartLabel: string;
  slotEndLabel: string;
  event: BookingNotificationEvent;
  reason?: string | null;
  bookingId: string;
};

const createOrganizationInvitationAcceptUrl = ({
  env,
  invitationId,
}: {
  env: ResendEnv;
  invitationId: string;
}) => {
  const base = env.INVITATION_ACCEPT_URL_BASE
    ? env.INVITATION_ACCEPT_URL_BASE
    : env.WEB_BASE_URL
      ? new URL('/invitations/accept', env.WEB_BASE_URL).toString()
      : 'http://localhost:5173/invitations/accept';

  const url = new URL(base);
  url.searchParams.set('invitationId', invitationId);
  return url.toString();
};

const createParticipantInvitationAcceptUrl = ({
  env,
  invitationId,
}: {
  env: ResendEnv;
  invitationId: string;
}) => {
  const base = env.PARTICIPANT_INVITATION_ACCEPT_URL_BASE
    ? env.PARTICIPANT_INVITATION_ACCEPT_URL_BASE
    : env.WEB_BASE_URL
      ? new URL('/participants/invitations/accept', env.WEB_BASE_URL).toString()
      : 'http://localhost:5173/participants/invitations/accept';

  const url = new URL(base);
  url.searchParams.set('invitationId', invitationId);
  return url.toString();
};

const createBookingsUrl = ({ env }: { env: ResendEnv }) => {
  if (env.WEB_BASE_URL) {
    return new URL('/bookings', env.WEB_BASE_URL).toString();
  }
  return 'http://localhost:5173/bookings';
};

const isValidFromField = (value: string) => {
  // Resend accepts either:
  // - email@example.com
  // - Name <email@example.com>
  const plainEmailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
  const namedEmailPattern = /^[^<>]+<\s*[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+\s*>$/;
  return plainEmailPattern.test(value) || namedEmailPattern.test(value);
};

const requireResendConfig = (env: ResendEnv) => {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    console.warn(
      '[invite-email] RESEND_API_KEY or RESEND_FROM_EMAIL is missing. Skipping invite email.',
    );
    return null;
  }

  const fromEmail = env.RESEND_FROM_EMAIL.trim();
  if (!isValidFromField(fromEmail)) {
    console.warn(
      '[invite-email] RESEND_FROM_EMAIL format is invalid. Use `email@example.com` or `Name <email@example.com>`. Skipping invite email.',
    );
    return null;
  }

  return {
    apiKey: env.RESEND_API_KEY,
    fromEmail,
  };
};

export const sendOrganizationInvitationEmail = async ({
  env,
  invitationId,
  inviteeEmail,
  inviterName,
  inviterEmail,
  organizationName,
  role,
}: SendInvitationInput) => {
  const config = requireResendConfig(env);
  if (!config) {
    return;
  }

  const invitationUrl = createOrganizationInvitationAcceptUrl({ env, invitationId });
  const inviterDisplay =
    inviterName && inviterName.length > 0
      ? inviterEmail
        ? `${inviterName} (${inviterEmail})`
        : inviterName
      : inviterEmail ?? 'organization owner';

  const subject = `${organizationName} に招待されました`;
  const html = await render(
    createElement(OrganizationInvitationEmail, {
      invitationId,
      organizationName,
      role,
      inviterDisplay,
      invitationUrl,
    }),
  );
  const text = toPlainText(html);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.fromEmail,
      to: [inviteeEmail],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const details = await response.text();

    if (
      response.status === 403 &&
      details.includes('You can only send testing emails to your own email address')
    ) {
      console.warn(
        '[invite-email] Resend test-mode restriction: only your own verified recipient is allowed. Verify a domain in Resend and set RESEND_FROM_EMAIL to that domain to send to other recipients.',
      );
      return;
    }

    throw new Error(`Failed to send invitation email via Resend: ${details}`);
  }
};

export const sendParticipantInvitationEmail = async ({
  env,
  invitationId,
  inviteeEmail,
  participantName,
  inviterName,
  inviterEmail,
  organizationName,
}: SendParticipantInvitationInput) => {
  const config = requireResendConfig(env);
  if (!config) {
    return;
  }

  const invitationUrl = createParticipantInvitationAcceptUrl({ env, invitationId });
  const inviterDisplay =
    inviterName && inviterName.length > 0
      ? inviterEmail
        ? `${inviterName} (${inviterEmail})`
        : inviterName
      : inviterEmail ?? 'organization admin';

  const subject = `${organizationName} の参加者招待が届いています`;
  const html = await render(
    createElement(ParticipantInvitationEmail, {
      invitationId,
      organizationName,
      participantName,
      inviterDisplay,
      invitationUrl,
    }),
  );
  const text = toPlainText(html);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.fromEmail,
      to: [inviteeEmail],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const details = await response.text();

    if (
      response.status === 403 &&
      details.includes('You can only send testing emails to your own email address')
    ) {
      console.warn(
        '[invite-email] Resend test-mode restriction: only your own verified recipient is allowed. Verify a domain in Resend and set RESEND_FROM_EMAIL to that domain to send to other recipients.',
      );
      return;
    }

    throw new Error(`Failed to send participant invitation email via Resend: ${details}`);
  }
};

const bookingNotificationSubjectMap: Record<BookingNotificationEvent, string> = {
  booking_confirmed: '【予約通知】予約が確定しました',
  booking_application_received: '【予約通知】予約申請を受け付けました',
  booking_approved: '【予約通知】予約が承認されました',
  booking_rejected: '【予約通知】予約が却下されました',
  booking_cancelled_by_participant: '【予約通知】予約をキャンセルしました',
  booking_cancelled_by_staff: '【予約通知】運営により予約がキャンセルされました',
  booking_no_show: '【予約通知】予約がNo-showとして記録されました',
};

const bookingNotificationEventLabelMap: Record<BookingNotificationEvent, string> = {
  booking_confirmed: '予約が確定しました',
  booking_application_received: '予約申請を受け付けました',
  booking_approved: '予約が承認されました',
  booking_rejected: '予約が却下されました',
  booking_cancelled_by_participant: '予約をキャンセルしました',
  booking_cancelled_by_staff: '運営により予約がキャンセルされました',
  booking_no_show: '予約がNo-showとして記録されました',
};

export const sendBookingNotificationEmail = async ({
  env,
  inviteeEmail,
  organizationName,
  participantName,
  serviceName,
  participantsCount,
  slotStartLabel,
  slotEndLabel,
  event,
  reason,
  bookingId,
}: SendBookingNotificationInput) => {
  const config = requireResendConfig(env);
  if (!config) {
    return;
  }

  const subject = bookingNotificationSubjectMap[event];
  const eventLabel = bookingNotificationEventLabelMap[event];
  const bookingsUrl = createBookingsUrl({ env });
  const html = await render(
    createElement(BookingNotificationEmail, {
      organizationName,
      participantName,
      serviceName,
      participantsCount,
      slotStartLabel,
      slotEndLabel,
      eventLabel,
      reason,
      bookingId,
      bookingsUrl,
    }),
  );
  const text = toPlainText(html);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.fromEmail,
      to: [inviteeEmail],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const details = await response.text();

    if (
      response.status === 403 &&
      details.includes('You can only send testing emails to your own email address')
    ) {
      console.warn(
        '[booking-email] Resend test-mode restriction: only your own verified recipient is allowed. Verify a domain in Resend and set RESEND_FROM_EMAIL to that domain to send to other recipients.',
      );
      return;
    }

    throw new Error(`Failed to send booking notification email via Resend: ${details}`);
  }
};
