# Backend ディレクトリ構成移行メモ

## この文書の扱い

この文書は現行仕様の正本ではなく、backend ディレクトリ再編の履歴・計画メモです。
現行構成を確認するときは、実際の `apps/backend/src` と [architecture.md](./architecture.md) を確認してください。

一気に進める前提なら、**Backend 全体を `app / features / domain / infra / shared` に整理する案**がよいです。`modules/` は廃止し、`booking` 直下の旧共通層も `domain/booking` に寄せます。

```txt
apps/backend/src/
  app/
    create-app.ts
    register-routes.ts
    openapi.ts
    middleware.ts

  routes/
    auth-routes.ts
    booking-routes.ts
    public-routes.ts

  features/
    booking/
      booking-route-context.ts
      booking.routes.ts
      booking.schemas.ts
      booking.usecases.ts
      booking.repository.ts
      booking.notifications.ts
      booking.usecases.test.ts

    services/
      service.routes.ts
      service.schemas.ts
      service.usecases.ts
      service.repository.ts
      service-image.usecases.ts

    slots/
      slot.routes.ts
      slot.schemas.ts
      slot.usecases.ts
      slot.repository.ts

    recurring/
      recurring.routes.ts
      recurring.schemas.ts
      recurring.usecases.ts
      recurring.repository.ts

    tickets/
      ticket.routes.ts
      ticket.schemas.ts
      ticket.usecases.ts
      ticket.repository.ts
      ticket.state.ts
      legacy-ticket-checkout-webhook.usecase.ts

    organizations/
      organization.routes.ts
      organization.schemas.ts
      organization.usecases.ts
      organization.repository.ts

    participants/
      participant.routes.ts
      participant.schemas.ts
      participant.usecases.ts
      participant.repository.ts

    billing/
      billing.routes.ts
      billing.schemas.ts
      billing.usecases.ts
      billing.repository.ts

  domain/
    booking/
      constants.ts
      authorization.ts
      audit.ts
      recurring.ts
      policy.ts

    billing/
      organization-billing.ts
      reserve-app-billing-entitlement-policy.ts
      reserve-app-billing-history.ts
      reserve-app-billing-documents.ts
      reserve-app-billing-observability.ts
      organization-billing-operations.ts
      reserve-app-billing-invoice-events.ts
      internal-billing-inspection.ts
      internal-operator-access.ts

    organization/
      organization-policy.ts
      organization-access.ts

    participant/
      participant-policy.ts

  infra/
    db/
      schema.ts
      migrations/

    email/
      resend.ts

    payment/
      stripe.ts

    storage/
      service-image-upload-service.ts
      organization-logo-service.ts

    sentry/
      sentry.ts

  shared/
    route-result.ts
    serializers.ts
    date.ts
    store-policy.ts
    errors.ts
    env.ts
```

## 現在からの移動対応

```txt
apps/backend/src/modules/booking
→ apps/backend/src/features/booking

apps/backend/src/modules/services
→ apps/backend/src/features/services

apps/backend/src/modules/slots
→ apps/backend/src/features/slots

apps/backend/src/modules/recurring
→ apps/backend/src/features/recurring

apps/backend/src/modules/tickets
→ apps/backend/src/features/tickets

apps/backend/src/modules/shared/route-context.ts
→ apps/backend/src/features/booking/booking-route-context.ts

apps/backend/src/modules/shared の純粋 helper
→ apps/backend/src/shared
```

```txt
apps/backend/src/booking/constants.ts
→ apps/backend/src/domain/booking/constants.ts

apps/backend/src/booking/authorization.ts
→ apps/backend/src/domain/booking/authorization.ts

apps/backend/src/booking/audit.ts
→ apps/backend/src/domain/booking/audit.ts

apps/backend/src/booking/recurring.ts
→ apps/backend/src/domain/booking/recurring.ts
```

```txt
apps/backend/src/db/schema.ts
→ apps/backend/src/infra/db/schema.ts

apps/backend/src/email/resend.ts
→ apps/backend/src/infra/email/resend.ts

apps/backend/src/payment/stripe.ts
→ apps/backend/src/infra/payment/stripe.ts

apps/backend/src/service-image-upload-service.ts
→ apps/backend/src/infra/storage/service-image-upload-service.ts

apps/backend/src/organization-logo-service.ts
→ apps/backend/src/infra/storage/organization-logo-service.ts
```

## 依存ルール

このルールに寄せると破綻しにくいです。

```txt
app      -> routes, features, infra, shared
routes   -> features, shared
features -> domain, infra, shared
domain   -> shared のみ
infra    -> domain, shared は可
shared   -> どこにも依存しない
```

予約系の route context は例外的に `features/booking` を境界として共有します。
`services`、`slots`、`recurring`、`tickets` は予約運用の同一境界として `features/booking/booking-route-context.ts` の型だけを参照できます。

避けるべき依存です。

```txt
domain -> features
domain -> routes
domain -> infra
shared -> features
shared -> domain
shared -> infra
infra  -> features
```

## `booking-routes.ts` の移行後イメージ

現在の `booking-routes.ts` はすでに route 登録だけの薄い wrapper になっているので、`modules` を `features` に変えるだけで自然に移行できます。

```ts
import { registerBookingLifecycleRoutes } from '../features/booking/booking.routes.js';
import { registerRecurringRoutes } from '../features/recurring/recurring.routes.js';
import { registerServiceRoutes } from '../features/services/service.routes.js';
import { registerSlotRoutes } from '../features/slots/slot.routes.js';
import { registerTicketRoutes } from '../features/tickets/ticket.routes.js';
import {
  createBookingRouteContext,
  type BookingRouteDeps,
} from '../features/booking/booking-route-context.js';

export const registerBookingRoutes = (deps: BookingRouteDeps) => {
  const ctx = createBookingRouteContext(deps);

  registerServiceRoutes(ctx);
  registerSlotRoutes(ctx);
  registerRecurringRoutes(ctx);
  registerBookingLifecycleRoutes(ctx);
  registerTicketRoutes(ctx);
};
```

## `domain/booking` に寄せる理由

`src/booking/constants.ts` は `BOOKING_STATUS`, `SLOT_STATUS`, `TICKET_*` などのドメイン定数を持っています。これは feature 実装より domain shared に近いです。

`src/booking/authorization.ts` は session identity、organization/store access、premium gate など横断的な権限ロジックを持っています。
現状では DB と認証 runtime に依存するため、純粋な domain というより横断的な application service に近いです。
この移動は暫定配置とし、後続で `features/access-control` などへ分離する余地があります。

## `shared` に残すもの

`shared` は、どの feature からも使える純粋 helper だけを置きます。
DB、認証、外部 storage、route 登録に依存するものは置きません。

予約系 route の認証・認可・premium 判定を束ねる context は、予約機能の application 境界として `features/booking/booking-route-context.ts` に置きます。

## `create-app.ts` から切り出すもの

`create-app.ts` は middleware、health check、OpenAPI、webhook endpoint、route 登録、依存注入に寄せます。
旧 Stripe ticket checkout の復旧処理は、ticket 購入の業務処理なので `features/tickets/legacy-ticket-checkout-webhook.usecase.ts` に置きます。

## 一気にやる場合の作業順

```txt
1. src/modules を src/features に rename
2. import '../modules/...' を '../features/...' に一括置換
3. src/modules/shared/route-context.ts を src/features/booking/booking-route-context.ts に移動
4. src/modules/shared の純粋 helper を src/shared に移動
5. import '../shared/...' / '../../shared/...' を調整
6. src/booking を src/domain/booking に移動
7. import '../../booking/...' を '../../domain/booking/...' に置換
8. src/db を src/infra/db に移動
9. src/email を src/infra/email に移動
10. src/payment を src/infra/payment に移動
11. storage 系 service を src/infra/storage に移動
12. billing 系 domain logic を src/domain/billing に移動
13. 旧 ticket checkout webhook 復旧処理を features/tickets に切り出す
14. typecheck / test / lint
```

## 一気にやる場合の注意点

特に影響が大きいのは `db/schema.ts` の移動です。Drizzle schema は import されている箇所が多いはずなので、`infra/db/schema.ts` に移すと import 差分がかなり大きくなります。

そのため、一気に進めるなら最初に `barrel` を一時的に置くと安全です。

```ts
// apps/backend/src/db/schema.ts
export * from '../infra/db/schema.js';
```

同様に、移行期間だけ compatibility export を置けます。

```ts
// apps/backend/src/booking/constants.ts
export * from '../domain/booking/constants.js';
```

最終的に import がすべて新パスへ置換できたら、旧ファイルを削除します。

## 最終的な推奨形

一気に整理するなら、この形を目標にするのがよいです。

```txt
apps/backend/src/
  app/
  routes/
  features/
  domain/
  infra/
  shared/
```

この構成なら、`features/booking` と `domain/booking` の違いが明確になります。

```txt
features/booking = 予約機能の API / usecase / DB query / route context
domain/booking   = 予約ドメインの共通ルール / 定数 / 監査
```

この方針であれば、`modules/` は不要です。
