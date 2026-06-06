<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Bold as BoldIcon, Italic, Link, List, ListOrdered, Unlink } from '@lucide/svelte';
	import { Editor } from '@tiptap/core';
	import Bold from '@tiptap/extension-bold';
	import BulletList from '@tiptap/extension-bullet-list';
	import Document from '@tiptap/extension-document';
	import HardBreak from '@tiptap/extension-hard-break';
	import ItalicExtension from '@tiptap/extension-italic';
	import LinkExtension from '@tiptap/extension-link';
	import ListItem from '@tiptap/extension-list-item';
	import OrderedList from '@tiptap/extension-ordered-list';
	import Paragraph from '@tiptap/extension-paragraph';
	import Text from '@tiptap/extension-text';
	import { HTTPS_LINK_REL, extractPlainText, sanitizeLimitedHtml } from '@repo/rich-text';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Popover from '$lib/components/ui/popover';
	import { cn } from '$lib/utils';

	type Props = {
		value?: string;
		disabled?: boolean;
		editorId?: string;
		labelId?: string;
	};

	let {
		value = $bindable(''),
		disabled = false,
		editorId = 'public-site-description-editor',
		labelId = 'public-site-description-label'
	}: Props = $props();

	let editorElement = $state<HTMLDivElement | null>(null);
	let editor = $state<Editor | null>(null);
	let lastEditorValue = $state('');
	let linkPopoverOpen = $state(false);
	let linkUrl = $state('');
	let linkError = $state<string | null>(null);

	const extensions = [
		Document,
		Paragraph,
		Text,
		HardBreak,
		Bold,
		ItalicExtension,
		BulletList,
		OrderedList,
		ListItem,
		LinkExtension.configure({
			openOnClick: false,
			linkOnPaste: false,
			autolink: false,
			HTMLAttributes: {
				target: '_blank',
				rel: HTTPS_LINK_REL
			}
		})
	];

	const normalizeEditorLinkUrl = (input: string): string | null => {
		const trimmed = input.trim();
		if (!trimmed) {
			return null;
		}
		try {
			const url = new URL(trimmed);
			if (url.protocol === 'https:' || url.protocol === 'mailto:') {
				return url.toString();
			}
		} catch {
			return null;
		}
		return null;
	};

	const normalizeEditorHtml = (html: string): string => {
		const sanitized = sanitizeLimitedHtml(html);
		return extractPlainText(sanitized).length > 0 ? sanitized : '';
	};

	const isActive = (name: string): boolean => editor?.isActive(name) ?? false;

	const updateValueFromEditor = (nextEditor: Editor) => {
		const sanitized = normalizeEditorHtml(nextEditor.getHTML());
		if (sanitized === lastEditorValue && sanitized === value) {
			return;
		}
		lastEditorValue = sanitized;
		value = sanitized;
	};

	const runEditorCommand = (command: (nextEditor: Editor) => void) => {
		if (!editor || disabled) {
			return;
		}
		command(editor);
	};

	const openLinkEditor = () => {
		if (!editor || disabled) {
			return;
		}
		const attrs = editor.getAttributes('link') as { href?: string };
		linkUrl = attrs.href ?? '';
		linkError = null;
		linkPopoverOpen = true;
	};

	const applyLink = () => {
		if (!editor || disabled) {
			return;
		}
		const href = normalizeEditorLinkUrl(linkUrl);
		if (!href) {
			linkError = 'https: または mailto: の URL を入力してください。';
			return;
		}
		editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
		linkPopoverOpen = false;
		linkError = null;
		updateValueFromEditor(editor);
	};

	const removeLink = () => {
		runEditorCommand((nextEditor) => {
			nextEditor.chain().focus().extendMarkRange('link').unsetLink().run();
			linkPopoverOpen = false;
			linkError = null;
			updateValueFromEditor(nextEditor);
		});
	};

	const updateLinkUrl = (event: Event) => {
		linkUrl = (event.currentTarget as HTMLInputElement).value;
		linkError = null;
	};

	onMount(() => {
		if (!editorElement) {
			return;
		}

		const nextEditor = new Editor({
			element: editorElement,
			extensions,
			content: value || '',
			editable: !disabled,
			editorProps: {
				attributes: {
					id: editorId,
					role: 'textbox',
					'aria-labelledby': labelId,
					'aria-multiline': 'true',
					class:
						'min-h-40 w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_a]:text-link [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5'
				}
			},
			onUpdate: ({ editor: updatedEditor }) => updateValueFromEditor(updatedEditor)
		});

		editor = nextEditor;
		lastEditorValue = normalizeEditorHtml(nextEditor.getHTML());
		if (value !== lastEditorValue) {
			value = lastEditorValue;
		}
	});

	onDestroy(() => {
		editor?.destroy();
		editor = null;
	});

	$effect(() => {
		editor?.setEditable(!disabled);
	});

	$effect(() => {
		if (!editor) {
			return;
		}
		const incomingValue = normalizeEditorHtml(value || '');
		const currentValue = normalizeEditorHtml(editor.getHTML());
		if (incomingValue === lastEditorValue || incomingValue === currentValue) {
			return;
		}
		editor.commands.setContent(incomingValue, { emitUpdate: false });
		lastEditorValue = normalizeEditorHtml(editor.getHTML());
	});
</script>

<div class="space-y-2">
	<div class="flex flex-wrap gap-1 rounded-md border border-border/80 bg-secondary/40 p-1">
		<Button
			type="button"
			size="icon-sm"
			variant={isActive('bold') ? 'secondary' : 'ghost'}
			aria-label="太字"
			title="太字"
			disabled={!editor || disabled}
			onclick={() => runEditorCommand((nextEditor) => nextEditor.chain().focus().toggleBold().run())}
		>
			<BoldIcon class="size-4" />
		</Button>
		<Button
			type="button"
			size="icon-sm"
			variant={isActive('italic') ? 'secondary' : 'ghost'}
			aria-label="斜体"
			title="斜体"
			disabled={!editor || disabled}
			onclick={() => runEditorCommand((nextEditor) => nextEditor.chain().focus().toggleItalic().run())}
		>
			<Italic class="size-4" />
		</Button>
		<Button
			type="button"
			size="icon-sm"
			variant={isActive('bulletList') ? 'secondary' : 'ghost'}
			aria-label="箇条書き"
			title="箇条書き"
			disabled={!editor || disabled}
			onclick={() =>
				runEditorCommand((nextEditor) => nextEditor.chain().focus().toggleBulletList().run())}
		>
			<List class="size-4" />
		</Button>
		<Button
			type="button"
			size="icon-sm"
			variant={isActive('orderedList') ? 'secondary' : 'ghost'}
			aria-label="番号付きリスト"
			title="番号付きリスト"
			disabled={!editor || disabled}
			onclick={() =>
				runEditorCommand((nextEditor) => nextEditor.chain().focus().toggleOrderedList().run())}
		>
			<ListOrdered class="size-4" />
		</Button>
		<Popover.Root bind:open={linkPopoverOpen}>
			<Popover.Trigger
				type="button"
				class={cn(buttonVariants({ size: 'icon-sm', variant: isActive('link') ? 'secondary' : 'ghost' }))}
				aria-label="リンク"
				title="リンク"
				disabled={!editor || disabled}
				onclick={openLinkEditor}
			>
				<Link class="size-4" />
			</Popover.Trigger>
			<Popover.Content class="w-80 space-y-2" align="start">
				<div class="space-y-1">
					<label for="public-site-description-link" class="text-xs text-muted-foreground">
						リンク URL
					</label>
					<Input
						id="public-site-description-link"
						type="url"
						value={linkUrl}
						placeholder="https://example.com"
						oninput={updateLinkUrl}
						disabled={disabled}
					/>
					{#if linkError}
						<p class="text-xs text-destructive">{linkError}</p>
					{/if}
				</div>
				<div class="flex justify-end gap-2">
					<Button type="button" variant="outline" size="sm" onclick={removeLink} disabled={!editor || disabled}>
						<Unlink class="size-4" />
						解除
					</Button>
					<Button type="button" size="sm" onclick={applyLink} disabled={!editor || disabled}>
						適用
					</Button>
				</div>
			</Popover.Content>
		</Popover.Root>
	</div>
	<div
		bind:this={editorElement}
		class={cn(disabled && 'pointer-events-none opacity-60')}
		data-testid="public-site-description-editor"
	></div>
</div>
