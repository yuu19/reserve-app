import type { Page } from '@playwright/test';

/**
 * E2E page object が共有する最小 base class。
 */
export class BasePage {
  protected readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * App 内の path へ移動する。
   *
   * @param path - Playwright baseURL からの相対 path。
   */
  async goto(path: string) {
    await this.page.goto(path);
  }
}
