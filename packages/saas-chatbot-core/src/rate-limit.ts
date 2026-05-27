/** AI 利用量を集計する時間窓。 */
export type RateLimitWindowKind = 'hour' | 'day';
/** AI 利用量制限を適用する scope。 */
export type RateLimitScopeKind = 'user' | 'organization';

/** chat 送信前に返す rate limit 判定結果。 */
export type AiUsageLimitResult =
  | {
      /** 送信を許可できる場合は `true`。 */
      allowed: true;
      /** user の時間あたり残り送信数。 */
      userRemainingThisHour: number;
      /** organization の日次残り送信数。 */
      organizationRemainingToday: number;
    }
  | {
      /** 送信を拒否する場合は `false`。 */
      allowed: false;
      /** 制限に達した scope。 */
      scopeKind: RateLimitScopeKind;
      /** 再試行可能になるまでの秒数。 */
      retryAfterSeconds: number;
      /** user の時間あたり残り送信数。 */
      userRemainingThisHour: number;
      /** organization の日次残り送信数。 */
      organizationRemainingToday: number;
    };

/** chat 送信時に rate limit counter を確認・加算する入力。 */
export type RateLimitConsumeInput = {
  /** 送信した user ID。 */
  actorUserId: string;
  /** 現在は organization 単位の subject を対象にする。 */
  subjectType: 'organization';
  /** rate limit を共有する organization ID。 */
  subjectId: string;
  /** window 判定に使う基準時刻。未指定時は実装側の現在時刻を使う。 */
  now?: Date;
};

/** chat 送信の rate limit を永続化しながら判定する境界。 */
export interface ChatRateLimiter {
  /** 現在の利用量を確認し、許可時は counter を加算する。 */
  checkAndIncrement(input: RateLimitConsumeInput): Promise<AiUsageLimitResult>;
}
