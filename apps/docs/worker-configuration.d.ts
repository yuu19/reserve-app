/* eslint-disable */
// Minimal Cloudflare Worker env types for apps/docs.
declare namespace Cloudflare {
	interface Env {
		ASSETS: Fetcher;
	}
}

interface Env extends Cloudflare.Env {}
