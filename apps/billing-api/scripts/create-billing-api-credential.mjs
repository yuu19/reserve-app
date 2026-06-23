import { createHash, randomBytes } from 'node:crypto';

const timestampSql = "cast(unixepoch('subsecond') * 1000 as integer)";

const toSqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;

const toSqlJson = (value) => toSqlString(JSON.stringify(value));

const statement = (sql) => `${sql};`;

const idPart = (value) =>
  String(value)
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const buildId = (...parts) => parts.map(idPart).filter(Boolean).join('_').toLowerCase();

const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

export const createBillingApiRawKey = ({ prefix = 'rbk_live' } = {}) =>
  `${prefix}_${randomBytes(32).toString('base64url')}`;

export const generateBillingApiCredentialSql = ({
  appId,
  keyPrefix = 'rbk_live',
  rawKey,
  credentialId,
  scopes = ['subject:write', 'billing:read', 'billing:write'],
}) => {
  if (!appId?.trim()) {
    throw new Error('appId is required.');
  }
  if (!keyPrefix?.trim()) {
    throw new Error('keyPrefix is required.');
  }
  if (!rawKey?.trim()) {
    throw new Error('rawKey is required.');
  }

  const normalizedAppId = appId.trim();
  const normalizedKeyPrefix = keyPrefix.trim();
  const normalizedCredentialId =
    credentialId?.trim() ??
    buildId('cred', normalizedAppId, normalizedKeyPrefix, Date.now().toString(36));
  const keyHash = sha256Hex(rawKey);

  return statement(`INSERT INTO billing_app_credential (
  id,
  app_id,
  key_prefix,
  key_hash,
  scopes_json
)
VALUES (
  ${toSqlString(normalizedCredentialId)},
  ${toSqlString(normalizedAppId)},
  ${toSqlString(normalizedKeyPrefix)},
  ${toSqlString(keyHash)},
  ${toSqlJson(scopes)}
)
ON CONFLICT(key_hash) DO UPDATE SET
  app_id = excluded.app_id,
  key_prefix = excluded.key_prefix,
  scopes_json = excluded.scopes_json,
  revoked_at = NULL,
  updated_at = ${timestampSql}`);
};

const readArgValue = (args, name) => {
  const index = args.findIndex((arg) => arg === name);
  return index >= 0 ? args[index + 1] || null : null;
};

const readScopes = (args) => {
  const value = readArgValue(args, '--scopes');
  return value
    ? value
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean)
    : undefined;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const appId = readArgValue(args, '--app');
  const keyPrefix = readArgValue(args, '--prefix') ?? 'rbk_live';
  const rawKey = readArgValue(args, '--raw-key') ?? createBillingApiRawKey({ prefix: keyPrefix });
  const credentialId = readArgValue(args, '--credential-id');
  const scopes = readScopes(args);

  process.stdout.write(
    `${generateBillingApiCredentialSql({
      appId,
      keyPrefix,
      rawKey,
      credentialId,
      scopes,
    })}\n`,
  );
  process.stderr.write(
    [
      'Generated Billing API raw key. Store it as reserve-app backend secret BILLING_API_KEY.',
      `BILLING_API_KEY=${rawKey}`,
      'The SQL written to stdout stores only the SHA-256 hash.',
      '',
    ].join('\n'),
  );
}
