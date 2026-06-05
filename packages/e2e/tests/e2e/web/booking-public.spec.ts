import { test } from '@playwright/test';
import {
  createAccount,
  createOwnerOrganization,
  createService,
  createSlot,
  expectPublicEventCapacity,
  futureSlotRange,
  syncRequestCookiesToBrowser,
  updatePublicSiteSetting,
  uniqueToken,
} from '../helpers/test-data';
import { PublicEventsPage, ScopedAdminPages } from '../pages';

test.describe('予約と公開イベントフロー', () => {
  test.setTimeout(120_000);

  test('seed済みサービスと予約枠をスコープ付き管理画面に表示する', async ({
    page,
    request,
    context,
  }, testInfo) => {
    const token = uniqueToken(testInfo, 'admin-booking');
    const { organization } = await createOwnerOrganization({ request, context, token });
    const service = await createService({
      request,
      organization,
      name: `Service ${token}`,
    });
    const slotRange = futureSlotRange(1);
    await createSlot({
      request,
      organization,
      service,
      startAt: slotRange.startAt,
      endAt: slotRange.endAt,
    });
    await syncRequestCookiesToBrowser(request, context);
    const scopedAdminPages = new ScopedAdminPages(page);

    await scopedAdminPages.expectServiceVisible({
      orgSlug: organization.slug,
      storeSlug: organization.storeSlug,
      serviceName: service.name,
    });
    await scopedAdminPages.expectSlotVisible({
      orgSlug: organization.slug,
      storeSlug: organization.storeSlug,
      serviceName: service.name,
      locationLabel: 'E2E Room',
    });
  });

  test('ゲストが公開イベントを予約できる', async ({ page, request }, testInfo) => {
    const token = uniqueToken(testInfo, 'public-booking');
    const participant = createAccount(token, 'participant');
    const { organization } = await createOwnerOrganization({
      request,
      token,
    });
    await updatePublicSiteSetting({ request, organization });
    const service = await createService({
      request,
      organization,
      name: `Public Event ${token}`,
    });
    const slotRange = futureSlotRange(1);
    const slot = await createSlot({
      request,
      organization,
      service,
      startAt: slotRange.startAt,
      endAt: slotRange.endAt,
    });
    const publicEventsPage = new PublicEventsPage(page);

    await publicEventsPage.gotoEvents({
      orgSlug: organization.slug,
      storeSlug: organization.storeSlug,
    });
    await publicEventsPage.openEventDetails({
      serviceName: service.name,
      orgSlug: organization.slug,
      storeSlug: organization.storeSlug,
      slotId: slot.id,
    });

    await publicEventsPage.reserveAsGuest({
      name: participant.name,
      email: participant.email,
    });

    await publicEventsPage.expectReservationComplete();
    await expectPublicEventCapacity({
      request,
      orgSlug: organization.slug,
      storeSlug: organization.storeSlug,
      slotId: slot.id,
      remainingCount: 2,
      capacity: 3,
    });
  });
});
