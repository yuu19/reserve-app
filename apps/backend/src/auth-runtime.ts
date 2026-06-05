import { expo as expoPlugin } from '@better-auth/expo';
import { i18n, type TranslationDictionary } from '@better-auth/i18n';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins/organization';
import * as schema from './infra/db/schema.js';
import type { ResendEnv } from './infra/email/resend.js';

/**
 * Worker と route factory が共有する環境変数。
 *
 * Better Auth、公開ページ、Stripe、E2E、OAuth、メール送信の設定をまとめ、
 * Cloudflare binding 固有の型は `BackendWorkerEnv` 側で拡張する。
 */
export type AuthRuntimeEnv = {
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_TRUSTED_ORIGINS?: string;
  BETTER_AUTH_COOKIE_DOMAIN?: string;
  INTERNAL_OPERATOR_EMAILS?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PREMIUM_MONTHLY_PRICE_ID?: string;
  STRIPE_PREMIUM_YEARLY_PRICE_ID?: string;
  STRIPE_PREMIUM_TRIAL_SUBSCRIPTION_ENABLED?: string;
  E2E_TESTING_ENABLED?: string;
  E2E_TEST_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
} & ResendEnv;

type DrizzleDatabase = Parameters<typeof drizzleAdapter>[0];

/** Better Auth adapter と backend repositories が共有する Drizzle database 型。 */
export type AuthRuntimeDatabase = DrizzleDatabase;

const parseCsv = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const toAbsoluteUrl = (value: string | undefined): string | undefined => {
  const candidate = value?.trim();
  if (!candidate) {
    return undefined;
  }

  try {
    return new URL(candidate).toString();
  } catch {
    return undefined;
  }
};

const betterAuthJapaneseTranslations = {
  USER_NOT_FOUND: 'ユーザーが見つかりません。',
  FAILED_TO_CREATE_USER: 'ユーザーを作成できませんでした。',
  FAILED_TO_CREATE_SESSION: 'セッションを作成できませんでした。',
  FAILED_TO_UPDATE_USER: 'ユーザーを更新できませんでした。',
  FAILED_TO_GET_SESSION: 'セッションを取得できませんでした。',
  INVALID_PASSWORD: 'パスワードが正しくありません。',
  INVALID_EMAIL: 'メールアドレスが正しくありません。',
  INVALID_EMAIL_OR_PASSWORD: 'メールアドレスまたはパスワードが正しくありません。',
  INVALID_USER: 'ユーザーが正しくありません。',
  SOCIAL_ACCOUNT_ALREADY_LINKED: 'ソーシャルアカウントは既に連携されています。',
  PROVIDER_NOT_FOUND: '認証プロバイダーが見つかりません。',
  INVALID_TOKEN: 'トークンが正しくありません。',
  TOKEN_EXPIRED: 'トークンの有効期限が切れています。',
  ID_TOKEN_NOT_SUPPORTED: 'id_token はサポートされていません。',
  FAILED_TO_GET_USER_INFO: 'ユーザー情報を取得できませんでした。',
  USER_EMAIL_NOT_FOUND: 'ユーザーのメールアドレスが見つかりません。',
  EMAIL_NOT_VERIFIED: 'メールアドレスが確認されていません。',
  PASSWORD_TOO_SHORT: 'パスワードが短すぎます。',
  PASSWORD_TOO_LONG: 'パスワードが長すぎます。',
  USER_ALREADY_EXISTS: 'ユーザーは既に存在します。',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'このメールアドレスは既に使用されています。別のメールアドレスを使用してください。',
  EMAIL_CAN_NOT_BE_UPDATED: 'メールアドレスは更新できません。',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'メールアドレスとパスワードのアカウントが見つかりません。',
  SESSION_EXPIRED: 'セッションの有効期限が切れています。再度ログインしてください。',
  FAILED_TO_UNLINK_LAST_ACCOUNT: '最後のアカウント連携は解除できません。',
  ACCOUNT_NOT_FOUND: 'アカウントが見つかりません。',
  USER_ALREADY_HAS_PASSWORD:
    'ユーザーには既にパスワードが設定されています。アカウント削除にはそのパスワードを入力してください。',
  CROSS_SITE_NAVIGATION_LOGIN_BLOCKED:
    'クロスサイト遷移によるログインはブロックされました。このリクエストは CSRF 攻撃の可能性があります。',
  VERIFICATION_EMAIL_NOT_ENABLED: '確認メールは有効化されていません。',
  EMAIL_ALREADY_VERIFIED: 'メールアドレスは既に確認済みです。',
  EMAIL_MISMATCH: 'メールアドレスが一致しません。',
  SESSION_NOT_FRESH: 'セッションが新しくありません。',
  LINKED_ACCOUNT_ALREADY_EXISTS: '連携アカウントは既に存在します。',
  INVALID_ORIGIN: 'Origin が正しくありません。',
  INVALID_CALLBACK_URL: 'callbackURL が正しくありません。',
  INVALID_REDIRECT_URL: 'redirectURL が正しくありません。',
  INVALID_ERROR_CALLBACK_URL: 'errorCallbackURL が正しくありません。',
  INVALID_NEW_USER_CALLBACK_URL: 'newUserCallbackURL が正しくありません。',
  MISSING_OR_NULL_ORIGIN: 'Origin が指定されていないか空です。',
  CALLBACK_URL_REQUIRED: 'callbackURL は必須です。',
  FAILED_TO_CREATE_VERIFICATION: '確認情報を作成できませんでした。',
  FIELD_NOT_ALLOWED: 'この項目は設定できません。',
  ASYNC_VALIDATION_NOT_SUPPORTED: '非同期バリデーションはサポートされていません。',
  VALIDATION_ERROR: '入力内容が正しくありません。',
  MISSING_FIELD: '必須項目が入力されていません。',
  METHOD_NOT_ALLOWED_DEFER_SESSION_REQUIRED:
    'POST メソッドを使うには deferSessionRefresh を有効にする必要があります。',
  BODY_MUST_BE_AN_OBJECT: 'リクエスト body は object である必要があります。',
  PASSWORD_ALREADY_SET: 'ユーザーには既にパスワードが設定されています。',
  YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION: '新しい組織を作成する権限がありません。',
  YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS:
    '作成できる組織数の上限に達しました。',
  ORGANIZATION_ALREADY_EXISTS: '組織は既に存在します。',
  ORGANIZATION_SLUG_ALREADY_TAKEN: '組織 slug は既に使用されています。',
  ORGANIZATION_NOT_FOUND: '組織が見つかりません。',
  USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION:
    'ユーザーはこの組織のメンバーではありません。',
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION: 'この組織を更新する権限がありません。',
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION: 'この組織を削除する権限がありません。',
  NO_ACTIVE_ORGANIZATION: '有効な組織が選択されていません。',
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION:
    'ユーザーは既にこの組織のメンバーです。',
  MEMBER_NOT_FOUND: 'メンバーが見つかりません。',
  ROLE_NOT_FOUND: 'ロールが見つかりません。',
  YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_TEAM: '新しいチームを作成する権限がありません。',
  TEAM_ALREADY_EXISTS: 'チームは既に存在します。',
  TEAM_NOT_FOUND: 'チームが見つかりません。',
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER:
    '唯一のオーナーとして組織を離れることはできません。',
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER:
    'オーナーがいない状態で組織を離れることはできません。',
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER: 'このメンバーを削除する権限がありません。',
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION:
    'この組織へユーザーを招待する権限がありません。',
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION:
    'ユーザーは既にこの組織へ招待されています。',
  INVITATION_NOT_FOUND: '招待が見つかりません。',
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: 'この招待の宛先ユーザーではありません。',
  EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION:
    '招待を承認または辞退するには、先にメールアドレスの確認が必要です。',
  YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION: 'この招待をキャンセルする権限がありません。',
  INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION:
    '招待者はこの組織のメンバーではありません。',
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE:
    'このロールでユーザーを招待する権限がありません。',
  FAILED_TO_RETRIEVE_INVITATION: '招待を取得できませんでした。',
  YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_TEAMS: '作成できるチーム数の上限に達しました。',
  UNABLE_TO_REMOVE_LAST_TEAM: '最後のチームは削除できません。',
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER: 'このメンバーを更新する権限がありません。',
  ORGANIZATION_MEMBERSHIP_LIMIT_REACHED: '組織メンバー数の上限に達しました。',
  YOU_ARE_NOT_ALLOWED_TO_CREATE_TEAMS_IN_THIS_ORGANIZATION:
    'この組織でチームを作成する権限がありません。',
  YOU_ARE_NOT_ALLOWED_TO_DELETE_TEAMS_IN_THIS_ORGANIZATION:
    'この組織でチームを削除する権限がありません。',
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_TEAM: 'このチームを更新する権限がありません。',
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_TEAM: 'このチームを削除する権限がありません。',
  INVITATION_LIMIT_REACHED: '招待数の上限に達しました。',
  TEAM_MEMBER_LIMIT_REACHED: 'チームメンバー数の上限に達しました。',
  USER_IS_NOT_A_MEMBER_OF_THE_TEAM: 'ユーザーはこのチームのメンバーではありません。',
  YOU_CAN_NOT_ACCESS_THE_MEMBERS_OF_THIS_TEAM:
    'このチームのメンバー一覧を表示する権限がありません。',
  YOU_DO_NOT_HAVE_AN_ACTIVE_TEAM: '有効なチームが選択されていません。',
  YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_TEAM_MEMBER:
    '新しいメンバーを追加する権限がありません。',
  YOU_ARE_NOT_ALLOWED_TO_REMOVE_A_TEAM_MEMBER:
    'チームメンバーを削除する権限がありません。',
  YOU_ARE_NOT_ALLOWED_TO_ACCESS_THIS_ORGANIZATION:
    'オーナーとしてこの組織へアクセスする権限がありません。',
  YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION: 'この組織のメンバーではありません。',
  MISSING_AC_INSTANCE:
    'Dynamic Access Control を使用するには server auth plugin に事前定義済みの ac instance が必要です。詳細は server log を確認してください。',
  YOU_MUST_BE_IN_AN_ORGANIZATION_TO_CREATE_A_ROLE:
    'ロールを作成するには組織に参加している必要があります。',
  YOU_ARE_NOT_ALLOWED_TO_CREATE_A_ROLE: 'ロールを作成する権限がありません。',
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_A_ROLE: 'ロールを更新する権限がありません。',
  YOU_ARE_NOT_ALLOWED_TO_DELETE_A_ROLE: 'ロールを削除する権限がありません。',
  YOU_ARE_NOT_ALLOWED_TO_READ_A_ROLE: 'ロールを表示する権限がありません。',
  YOU_ARE_NOT_ALLOWED_TO_LIST_A_ROLE: 'ロール一覧を表示する権限がありません。',
  YOU_ARE_NOT_ALLOWED_TO_GET_A_ROLE: 'ロールを取得する権限がありません。',
  TOO_MANY_ROLES: 'この組織のロール数が多すぎます。',
  INVALID_RESOURCE: '指定された権限に不正なリソースが含まれています。',
  ROLE_NAME_IS_ALREADY_TAKEN: 'そのロール名は既に使用されています。',
  CANNOT_DELETE_A_PRE_DEFINED_ROLE: '事前定義されたロールは削除できません。',
  ROLE_IS_ASSIGNED_TO_MEMBERS:
    'メンバーに割り当てられているロールは削除できません。先にメンバーを別のロールへ割り当ててください。',
} satisfies TranslationDictionary;

/**
 * Hono route と Worker entrypoint が共有する Better Auth runtime を作成する。
 *
 * 返却する trusted origins は CORS にも使うため、mobile custom scheme、
 * localhost、本番 web origin をここで一元的に解決する。
 *
 * @param input - Better Auth runtime の依存。
 * @param input.database - Better Auth adapter と application route が共有する Drizzle database。
 * @param input.env - Better Auth、OAuth、Cookie、公開 page、Stripe、メールの環境変数。
 * @returns Better Auth instance、trusted origins、database、env をまとめた runtime。
 */
export const createAuthRuntime = ({
  database,
  env,
}: {
  database: DrizzleDatabase;
  env: AuthRuntimeEnv;
}) => {
  const baseURL = env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const useSecureCookies = (() => {
    try {
      return new URL(baseURL).protocol === 'https:';
    } catch {
      return false;
    }
  })();
  const secret =
    env.BETTER_AUTH_SECRET ?? 'change-this-development-secret-to-at-least-32-characters';

  const authTrustedOrigins = parseCsv(env.BETTER_AUTH_TRUSTED_ORIGINS);
  if (authTrustedOrigins.length === 0) {
    authTrustedOrigins.push(baseURL, 'http://localhost:5173', 'mobile://');
  }

  if (!authTrustedOrigins.includes('mobile://')) {
    authTrustedOrigins.push('mobile://');
  }

  const fallbackWebOrigin = authTrustedOrigins.find(
    (origin) => origin !== baseURL && !origin.startsWith('mobile://'),
  );
  const oauthErrorURL = toAbsoluteUrl(env.WEB_BASE_URL) ?? toAbsoluteUrl(fallbackWebOrigin);

  const cookieDomain = env.BETTER_AUTH_COOKIE_DOMAIN?.trim();
  const crossSubDomainCookiesEnabled = Boolean(
    cookieDomain && cookieDomain !== 'localhost' && !cookieDomain.startsWith('localhost:'),
  );

  const socialProviders =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            prompt: 'select_account' as const,
            accessType: 'offline' as const,
          },
        }
      : undefined;

  const auth = betterAuth({
    appName: 'better-auth-organization-demo',
    baseURL,
    secret,
    database: drizzleAdapter(database, {
      provider: 'sqlite',
      schema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    account: {
      storeStateStrategy: 'cookie',
    },
    advanced: {
      useSecureCookies,
      // workers.dev や custom domain などの cross-origin frontend からも本番では
      // auth cookie を送れるようにする。ローカル HTTP では Lax のままにする。
      defaultCookieAttributes: {
        sameSite: useSecureCookies ? 'none' : 'lax',
      },
      ...(crossSubDomainCookiesEnabled
        ? {
            crossSubDomainCookies: {
              enabled: true,
              domain: cookieDomain,
            },
          }
        : {}),
    },
    ...(oauthErrorURL
      ? {
          onAPIError: {
            errorURL: oauthErrorURL,
          },
        }
      : {}),
    trustedOrigins: authTrustedOrigins,
    socialProviders,
    plugins: [
      organization({
        invitationExpiresIn: 172800,
      }),
      i18n({
        defaultLocale: 'ja',
        detection: ['callback'],
        getLocale: () => 'ja',
        translations: {
          ja: betterAuthJapaneseTranslations,
        },
      }),
      expoPlugin(),
    ],
  });

  return {
    auth,
    authTrustedOrigins,
    database,
    env,
  };
};

/** Backend route が受け取る Better Auth instance の型。 */
export type AuthInstance = ReturnType<typeof createAuthRuntime>['auth'];
