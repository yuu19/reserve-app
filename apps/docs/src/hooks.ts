import type { Reroute } from '@sveltejs/kit';
import { deLocalizeUrl } from '$lib/paraglide/runtime';

/** localized URL を docs app 内部の route path に戻し、manual link の正本を locale 非依存に保つ。 */
export const reroute: Reroute = (request) => deLocalizeUrl(request.url).pathname;
