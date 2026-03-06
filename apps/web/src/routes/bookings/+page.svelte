<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { readLastAuthPortal } from '$lib/features/auth-portal-preference';
	import {
		getCurrentPathWithSearch,
		loadPortalAccess,
		loadSession,
		resolvePortalHomePath,
		redirectToLoginWithNext
	} from '$lib/features/auth-session.svelte';

	onMount(() => {
		void (async () => {
			const { session } = await loadSession();
			if (!session) {
				redirectToLoginWithNext(getCurrentPathWithSearch());
				return;
			}
			const portalAccess = await loadPortalAccess();
			const lastAuthPortal = readLastAuthPortal();
			const homePath = resolvePortalHomePath(portalAccess);
			const defaultBookingPath =
				homePath === '/admin/dashboard' ? '/admin/bookings' : '/participant/bookings';
			const bookingPath =
				lastAuthPortal === 'admin' && portalAccess.hasOrganizationAdminAccess
					? '/admin/bookings'
					: lastAuthPortal === 'participant' && portalAccess.hasParticipantAccess
						? '/participant/bookings'
						: defaultBookingPath;
			await goto(resolve(bookingPath));
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 md:px-6">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-slate-900">予約ポータルへ移動中</h1>
		<p class="text-sm text-slate-600">権限に応じた予約画面へリダイレクトします。</p>
	</header>
	<Card class="surface-panel border-slate-200/80 shadow-md">
		<CardContent class="py-6">
			<p class="text-sm text-muted-foreground">遷移先を判定しています…</p>
		</CardContent>
	</Card>
</main>
