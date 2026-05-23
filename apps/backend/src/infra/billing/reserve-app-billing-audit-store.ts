import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import {
  appendReserveAppBillingAuditEvent,
  appendReserveAppBillingSignal,
  appendResolvedReserveAppBillingSignalIfNeeded,
  readReserveAppBillingObservationSnapshot,
} from '../../domain/billing/reserve-app-billing-observability.js';

export const createReserveAppBillingAuditStore = ({
  database,
  env,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
}) => ({
  readSnapshot(organizationId: string) {
    return readReserveAppBillingObservationSnapshot({
      database,
      env,
      organizationId,
    });
  },

  appendAuditEvent(
    input: Omit<Parameters<typeof appendReserveAppBillingAuditEvent>[0], 'database'>,
  ) {
    return appendReserveAppBillingAuditEvent({
      database,
      ...input,
    });
  },

  appendSignal(input: Omit<Parameters<typeof appendReserveAppBillingSignal>[0], 'database'>) {
    return appendReserveAppBillingSignal({
      database,
      ...input,
    });
  },

  appendResolvedSignalIfNeeded(
    input: Omit<Parameters<typeof appendResolvedReserveAppBillingSignalIfNeeded>[0], 'database'>,
  ) {
    return appendResolvedReserveAppBillingSignalIfNeeded({
      database,
      ...input,
    });
  },
});
