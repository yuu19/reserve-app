export type RateLimitWindowKind = 'hour' | 'day';
export type RateLimitScopeKind = 'user' | 'organization';

export type AiUsageLimitResult =
  | {
      allowed: true;
      userRemainingThisHour: number;
      organizationRemainingToday: number;
    }
  | {
      allowed: false;
      scopeKind: RateLimitScopeKind;
      retryAfterSeconds: number;
      userRemainingThisHour: number;
      organizationRemainingToday: number;
    };

export type RateLimitConsumeInput = {
  actorUserId: string;
  subjectType: 'organization';
  subjectId: string;
  now?: Date;
};

export interface ChatRateLimiter {
  checkAndIncrement(input: RateLimitConsumeInput): Promise<AiUsageLimitResult>;
}
