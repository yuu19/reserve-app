import { z } from '@hono/zod-openapi';

export const scopedStoreRouteParamsSchema = z.object({
  orgSlug: z.string().min(1),
  storeSlug: z.string().min(1),
});

export type ScopedStoreRouteParams = z.infer<typeof scopedStoreRouteParamsSchema>;

export const scopedStoreAuthPath = (suffix: `/${string}`) =>
  `/orgs/{orgSlug}/stores/{storeSlug}${suffix}`;
