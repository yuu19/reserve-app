import { expect, type Page } from '@playwright/test';
import type { TestOrganization, TestService, TestSlot, TestTicketType } from '../helpers/test-data';
import { BasePage } from './BasePage';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Store public site と public ticket detail の表示を検証する page object。
 */
export class PublicSitePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Store public site root へ移動し、予約ページ一覧が表示されることを検証する。
   *
   * @param organization - public site の organization / store scope。
   */
  async gotoSite(organization: TestOrganization) {
    await this.goto(`/${organization.slug}/${organization.storeSlug}`);
    await expect(this.page.getByRole('heading', { name: '予約ページ一覧' })).toBeVisible();
  }

  /**
   * Public home に service detail link と ticket detail link が表示されることを検証する。
   *
   * @param input - Public home に表示される fixture。
   * @param input.organization - public site の scope。
   * @param input.service - 予約ページ link として期待する service。
   * @param input.slot - service link の遷移先になる slot。
   * @param input.ticketType - ticket detail link として期待する ticket type。
   */
  async expectPublicHome({
    organization,
    service,
    slot,
    ticketType,
  }: {
    organization: TestOrganization;
    service: TestService;
    slot: TestSlot;
    ticketType: TestTicketType;
  }) {
    await this.gotoSite(organization);
    await expect(this.page.getByText(organization.name).first()).toBeVisible();
    const bookingPageLink = this.page.locator('a').filter({ hasText: service.name }).first();
    await expect(bookingPageLink).toHaveAttribute(
      'href',
      `/${organization.slug}/${organization.storeSlug}/events/${slot.id}`,
    );
    const ticketLink = this.page.locator('a').filter({ hasText: ticketType.name }).first();
    await expect(ticketLink).toHaveAttribute(
      'href',
      `/${organization.slug}/${organization.storeSlug}/tickets/${ticketType.id}`,
    );
  }

  /**
   * Public home から ticket detail を開き、対象 ticket type の detail URL へ遷移したことを検証する。
   *
   * @param input - 遷移対象の ticket detail。
   * @param input.organization - public site の scope。
   * @param input.ticketType - 開く ticket type。
   */
  async openTicketDetail({
    organization,
    ticketType,
  }: {
    organization: TestOrganization;
    ticketType: TestTicketType;
  }) {
    await this.page.locator('a').filter({ hasText: ticketType.name }).first().click();
    await expect(this.page).toHaveURL(
      new RegExp(
        `/${escapeRegex(organization.slug)}/${escapeRegex(
          organization.storeSlug,
        )}/tickets/${escapeRegex(ticketType.id)}$`,
      ),
    );
    await expect(this.page.getByText(ticketType.name)).toBeVisible();
  }

  /** 未ログイン時の購入 CTA が participant login へ向くことを検証する。 */
  async expectLoggedOutCta() {
    const cta = this.page.getByRole('link', { name: 'ログインして購入申請' });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', /\/participant\/login/);
  }

  /**
   * ログイン済み参加者向けの購入 CTA が scoped participant booking page へ向くことを検証する。
   *
   * @param input - CTA の scope と ticket type。
   * @param input.organization - participant booking page の scope。
   * @param input.ticketType - query parameter に含める ticket type。
   */
  async expectLoggedInCta({
    organization,
    ticketType,
  }: {
    organization: TestOrganization;
    ticketType: TestTicketType;
  }) {
    const cta = this.page.getByRole('link', { name: '購入申請へ進む' });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute(
      'href',
      `/${organization.slug}/${organization.storeSlug}/participant/bookings?ticketTypeId=${ticketType.id}`,
    );
  }
}
