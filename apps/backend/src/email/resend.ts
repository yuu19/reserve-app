import { render, toPlainText } from '@react-email/render';
import { createElement } from 'react';
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
