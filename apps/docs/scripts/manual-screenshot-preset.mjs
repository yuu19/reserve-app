export const manualScreenshotContextOptions = Object.freeze({
	locale: 'ja-JP',
	timezoneId: 'Asia/Tokyo',
	viewport: { width: 1440, height: 960 },
	deviceScaleFactor: 2,
	colorScheme: 'light',
	reducedMotion: 'reduce'
});

export const manualScreenshotOptions = Object.freeze({
	fullPage: false,
	scale: 'device',
	animations: 'disabled'
});

export const manualFullPageScreenshotOptions = Object.freeze({
	...manualScreenshotOptions,
	fullPage: true
});

export const manualScreenshotReadyDefaults = Object.freeze({
	settleMs: 300,
	waitUntil: 'domcontentloaded'
});

export const createManualScreenshotPage = async (browser, options = {}) => {
	const context = await browser.newContext({
		...manualScreenshotContextOptions,
		...(options.contextOptions ?? {})
	});
	const page = await context.newPage();
	await page.emulateMedia({
		colorScheme: 'light',
		reducedMotion: 'reduce',
		...(options.mediaOptions ?? {})
	});

	return { context, page };
};

export const waitForManualScreenshotReady = async (page, options = {}) => {
	const {
		locator,
		settleMs = manualScreenshotReadyDefaults.settleMs,
		waitUntil = manualScreenshotReadyDefaults.waitUntil
	} = options;

	await page.waitForLoadState(waitUntil);
	await page.evaluate(() => document.fonts.ready);
	if (locator) {
		await locator.waitFor({ state: 'visible' });
	}
	if (settleMs > 0) {
		await page.waitForTimeout(settleMs);
	}
};
