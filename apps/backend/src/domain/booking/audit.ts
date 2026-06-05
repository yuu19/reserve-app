import type { AuthRuntimeDatabase } from '../../auth-runtime.js';
import * as dbSchema from '../../infra/db/schema.js';
import type { BookingAuditAction } from './constants.js';

export const getIpAddress = (headers: Headers): string | null => {
  const cfConnectingIp = headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const forwarded = headers.get('x-forwarded-for');
  if (!forwarded) {
    return null;
  }

  const [first] = forwarded.split(',');
  return first?.trim() ?? null;
};

export const writeBookingAuditLog = async ({
  database,
  bookingId,
  organizationId,
  storeId,
  actorUserId,
  action,
  metadata,
  headers,
}: {
  database: AuthRuntimeDatabase;
  bookingId: string;
  organizationId: string;
  storeId?: string;
  actorUserId?: string | null;
  action: BookingAuditAction;
  metadata?: Record<string, unknown>;
  headers: Headers;
}) => {
  await database.insert(dbSchema.bookingAuditLog).values({
    id: crypto.randomUUID(),
    bookingId,
    organizationId,
    storeId: storeId ?? organizationId,
    actorUserId: actorUserId ?? null,
    action,
    metadata: metadata ? JSON.stringify(metadata) : null,
    ipAddress: getIpAddress(headers),
    userAgent: headers.get('user-agent'),
  });
};
