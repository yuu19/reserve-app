import type { AuthRuntimeEnv } from '../auth-runtime.js';

export const INTERNAL_BILLING_INSPECTION_DENIED_MESSAGE =
  'Internal billing inspection access denied.';

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

export const readInternalOperatorEmailAllowlist = (env: AuthRuntimeEnv): Set<string> => {
  return new Set(
    (env.INTERNAL_OPERATOR_EMAILS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map(normalizeEmail),
  );
};

export const canAccessInternalBillingInspection = ({
  env,
  email,
  emailVerified,
}: {
  env: AuthRuntimeEnv;
  email: string | null;
  emailVerified: boolean;
}): boolean => {
  if (!email || !emailVerified) {
    return false;
  }

  return readInternalOperatorEmailAllowlist(env).has(normalizeEmail(email));
};
