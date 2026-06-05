import { expect, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Public events listing と public event detail 予約 flow を操作する page object。
 */
export class PublicEventsPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * 公開イベント一覧へ移動し、heading が表示されることを検証する。
   *
   * @param input - 公開イベント一覧の scope。
   * @param input.orgSlug - organization slug。
   * @param input.storeSlug - store slug。
   */
  async gotoEvents({ orgSlug, storeSlug }: { orgSlug: string; storeSlug: string }) {
    await this.goto(`/${encodeURIComponent(orgSlug)}/${encodeURIComponent(storeSlug)}/events`);
    await expect(this.page.getByRole('heading', { name: '公開イベント' })).toBeVisible();
  }

  /**
   * 公開イベント一覧から対象 event detail link を開く。
   *
   * @param input - 一覧上の link 特定と遷移先検証に使う値。
   * @param input.serviceName - event card に表示される service name。
   * @param input.orgSlug - 遷移先 URL の organization slug。
   * @param input.storeSlug - 遷移先 URL の store slug。
   * @param input.slotId - 遷移先 URL の slot id。
   */
  async openEventDetails({
    serviceName,
    orgSlug,
    storeSlug,
    slotId,
  }: {
    serviceName: string;
    orgSlug: string;
    storeSlug: string;
    slotId: string;
  }) {
    const eventLink = this.page.getByRole('link', {
      name: new RegExp(`${escapeRegex(serviceName)}[\\s\\S]*イベント詳細へ`),
    });
    await expect(eventLink).toBeVisible({ timeout: 15_000 });
    await eventLink.click();
    await expect(this.page).toHaveURL(new RegExp(`/${orgSlug}/${storeSlug}/events/${slotId}`));
  }

  /**
   * Public event detail で guest 予約 form を送信する。
   *
   * @param input - Guest 予約者情報。
   * @param input.name - 予約者氏名。
   * @param input.email - 予約者 email address。
   */
  async reserveAsGuest({ name, email }: { name: string; email: string }) {
    await this.page.getByRole('textbox', { name: '氏名' }).fill(name);
    await this.page.getByRole('textbox', { name: 'メールアドレス' }).fill(email);
    await this.page.getByRole('button', { name: '予約する' }).click();
  }

  /** 参加者 login page へ遷移したことを検証する。 */
  async expectParticipantLogin() {
    await expect(this.page).toHaveURL(/\/participant\/login/);
  }

  /** Public event 予約完了 message が表示されることを検証する。 */
  async expectReservationComplete() {
    await expect(this.page.getByRole('main').getByText('予約を受け付けました。')).toBeVisible();
  }
}

/**
 * Public flow で作成した service / slot が scoped admin pages に反映されたことを検証する page object。
 */
export class ScopedAdminPages extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Scoped service 一覧で対象 service row が表示されることを検証する。
   *
   * @param input - 検証対象の scope と service。
   * @param input.orgSlug - organization slug。
   * @param input.storeSlug - store slug。
   * @param input.serviceName - 表示を期待する service name。
   */
  async expectServiceVisible({
    orgSlug,
    storeSlug,
    serviceName,
  }: {
    orgSlug: string;
    storeSlug: string;
    serviceName: string;
  }) {
    await this.goto(`/${orgSlug}/${storeSlug}/admin/services`);
    await expect(this.page.getByRole('heading', { name: 'サービス一覧' })).toBeVisible();
    await expect(
      this.page.getByRole('row', { name: new RegExp(escapeRegex(serviceName)) }),
    ).toBeVisible({ timeout: 15_000 });
  }

  /**
   * Scoped 単発予約枠一覧で対象 slot row と location label が表示されることを検証する。
   *
   * @param input - 検証対象の scope と slot 表示情報。
   * @param input.orgSlug - organization slug。
   * @param input.storeSlug - store slug。
   * @param input.serviceName - slot row を特定する service name。
   * @param input.locationLabel - row 内に表示される location label。
   */
  async expectSlotVisible({
    orgSlug,
    storeSlug,
    serviceName,
    locationLabel,
  }: {
    orgSlug: string;
    storeSlug: string;
    serviceName: string;
    locationLabel: string;
  }) {
    await this.goto(`/${orgSlug}/${storeSlug}/admin/schedules/slots`);
    await expect(this.page.getByRole('heading', { name: '単発予約枠一覧' })).toBeVisible();
    const slotRow = this.page.getByRole('row', { name: new RegExp(escapeRegex(serviceName)) });
    await expect(slotRow).toBeVisible({ timeout: 15_000 });
    await expect(slotRow).toContainText(locationLabel);
  }
}
