<script lang="ts">
	import { Building2 } from '@lucide/svelte';
	import { cn } from '$lib/utils';

	type OrganizationLogoProps = {
		name: string;
		logo?: string | null;
		size?: 'sm' | 'md' | 'lg';
		class?: string;
	};

	let { name, logo = null, size = 'md', class: className }: OrganizationLogoProps = $props();

	let failedLogoSrc = $state<string | null>(null);

	const sizeClassMap: Record<'sm' | 'md' | 'lg', string> = {
		sm: 'size-7',
		md: 'size-10',
		lg: 'size-12'
	};

	const iconClassMap: Record<'sm' | 'md' | 'lg', string> = {
		sm: 'size-3.5',
		md: 'size-5',
		lg: 'size-6'
	};

	const logoSrc = $derived(typeof logo === 'string' ? logo.trim() : '');
	const showImage = $derived(logoSrc.length > 0 && failedLogoSrc !== logoSrc);
</script>

<span
	data-slot="organization-logo"
	class={cn(
		'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/80 bg-secondary',
		sizeClassMap[size],
		className
	)}
>
	{#if showImage}
		<img
			data-slot="organization-logo-image"
			src={logoSrc}
			alt={`${name} のロゴ`}
			class="size-full object-cover"
			loading="lazy"
			onerror={() => {
				failedLogoSrc = logoSrc;
			}}
		/>
	{:else}
		<Building2
			data-slot="organization-logo-fallback"
			aria-hidden="true"
			class={cn('text-muted-foreground', iconClassMap[size])}
		/>
	{/if}
</span>
