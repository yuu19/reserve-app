<script lang="ts">
	import {
		extractPlainText,
		sanitizeLimitedHtml,
		type PublicSiteDescriptionFormat
	} from '@repo/rich-text';
	import { cn } from '$lib/utils';

	type Props = {
		description?: string | null;
		descriptionFormat?: PublicSiteDescriptionFormat;
		emptyLabel?: string | null;
		class?: string;
	};

	let {
		description = null,
		descriptionFormat = 'plain_text',
		emptyLabel = null,
		class: className
	}: Props = $props();

	const resolvedFormat = $derived(descriptionFormat === 'limited_html' ? 'limited_html' : 'plain_text');
	const sanitizedHtml = $derived(
		resolvedFormat === 'limited_html' && description ? sanitizeLimitedHtml(description) : ''
	);
	const hasLimitedHtml = $derived(
		resolvedFormat === 'limited_html' && extractPlainText(sanitizedHtml).length > 0
	);
	const plainText = $derived(resolvedFormat === 'plain_text' ? (description?.trim() ?? '') : '');
</script>

{#if hasLimitedHtml}
	<div
		class={cn(
			'max-w-none text-sm leading-relaxed text-foreground [&_a]:text-link [&_a]:underline [&_a]:underline-offset-2 [&_br]:block [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
			className
		)}
	>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by @repo/rich-text before rendering -->
		{@html sanitizedHtml}
	</div>
{:else if plainText}
	<p class={cn('whitespace-pre-line text-sm leading-relaxed text-foreground', className)}>
		{plainText}
	</p>
{:else if emptyLabel}
	<p class={cn('text-sm text-muted-foreground', className)}>{emptyLabel}</p>
{/if}
