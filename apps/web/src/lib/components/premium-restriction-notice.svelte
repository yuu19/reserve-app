<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import type { OrganizationBillingPayload } from '$lib/rpc-client';
	import {
		buildPremiumRestrictionNoticeModel,
		type OrganizationPremiumRestrictionPayload
	} from '$lib/features/premium-restrictions';
	import { preserveScopedRouteContext } from '$lib/features/scoped-routing';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';

	let {
		featureLabel,
		restriction,
		billing,
		contractsPath = '/admin/contracts'
	}: {
		featureLabel: string;
		restriction: OrganizationPremiumRestrictionPayload;
		billing: OrganizationBillingPayload | null;
		contractsPath?: '/contracts' | '/admin/contracts';
	} = $props();

	const model = $derived(
		buildPremiumRestrictionNoticeModel({
			featureLabel,
			billing,
			restriction
		})
	);

	const openContracts = async () => {
		await goto(resolve(preserveScopedRouteContext(contractsPath, page.url.pathname) as Pathname));
	};
</script>

<Card
	class="surface-panel border-warning/45 bg-warning/15 shadow-md"
	role="status"
	aria-live="polite"
	data-testid="premium-restriction-notice"
>
	<CardHeader class="space-y-2">
		<h2 class="text-lg font-semibold text-warning-foreground">{model.title}</h2>
		<CardDescription class="text-sm text-warning-foreground">{model.description}</CardDescription>
	</CardHeader>
	<CardContent class="space-y-3 text-sm text-warning-foreground">
		<p>{model.currentBillingContext}</p>
		<p class="sr-only">{model.assistiveSummary}</p>
		{#if model.showContractsAction}
			<p>{model.ownerGuidance}</p>
			<Button
				type="button"
				variant="outline"
				class="border-warning/45 bg-card"
				onclick={openContracts}>{model.contractsActionLabel}</Button
			>
		{:else}
			<p>{model.readOnlyGuidance}</p>
		{/if}
	</CardContent>
</Card>
