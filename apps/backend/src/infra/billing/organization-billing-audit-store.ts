import type { AuthRuntimeDatabase, AuthRuntimeEnv } from '../../auth-runtime.js';
import {
  appendOrganizationBillingAuditEvent,
  appendOrganizationBillingSignal,
  appendResolvedBillingSignalIfNeeded,
  readOrganizationBillingObservationSnapshot,
} from '../../domain/billing/organization-billing-observability.js';

export const createOrganizationBillingAuditStore = ({
  database,
  env,
}: {
  database: AuthRuntimeDatabase;
  env: AuthRuntimeEnv;
}) => ({
  readSnapshot(organizationId: string) {
    return readOrganizationBillingObservationSnapshot({
      database,
      env,
      organizationId,
    });
  },

  appendAuditEvent(input: Omit<Parameters<typeof appendOrganizationBillingAuditEvent>[0], 'database'>) {
    return appendOrganizationBillingAuditEvent({
      database,
      ...input,
    });
  },

  appendSignal(input: Omit<Parameters<typeof appendOrganizationBillingSignal>[0], 'database'>) {
    return appendOrganizationBillingSignal({
      database,
      ...input,
    });
  },

  appendResolvedSignalIfNeeded(
    input: Omit<Parameters<typeof appendResolvedBillingSignalIfNeeded>[0], 'database'>,
  ) {
    return appendResolvedBillingSignalIfNeeded({
      database,
      ...input,
    });
  },
});
