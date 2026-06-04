<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Plus, Trash2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		buildScopedPath,
		extractScopedRouteContext,
		getRoutePathFromUrlPath,
		preserveScopedRouteContext,
		type ScopedRouteContext
	} from '$lib/features/scoped-routing';
	import {
		getCurrentPathWithSearch,
		loadPortalAccess,
		loadSession,
		redirectToLoginWithNext,
		resolvePortalHomePath
	} from '$lib/features/auth-session.svelte';
	import { loadIntakeFields, updateIntakeFields } from '$lib/features/intake-fields';
	import type { PublicSiteIntakeFieldPayload } from '$lib/rpc-client';

	type ResolvablePath = Pathname;
	type IntakeFieldType = PublicSiteIntakeFieldPayload['fieldType'];
	type IntakeFieldForm = {
		fieldId: string;
		label: string;
		fieldType: IntakeFieldType;
		required: boolean;
		visibleOnPublic: boolean;
		optionsText: string;
		helpText: string;
		placeholder: string;
	};

	const fieldTypeOptions: Array<{ value: IntakeFieldType; label: string }> = [
		{ value: 'text', label: '1行テキスト' },
		{ value: 'textarea', label: '複数行テキスト' },
		{ value: 'select', label: '選択式' },
		{ value: 'checkbox', label: 'チェック' }
	];

	let loading = $state(true);
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);
	let currentContext = $state<ScopedRouteContext | null>(null);
	let fields = $state<IntakeFieldForm[]>([]);

	const routePathname = $derived(getRoutePathFromUrlPath(page.url.pathname));
	const routeScopedContext = $derived(extractScopedRouteContext(page.url.pathname));
	const navigationContext = $derived(currentContext ?? routeScopedContext);
	const publicSiteManagementPath = $derived(
		navigationContext ? buildScopedPath(navigationContext, '/admin/public-site') : null
	);
	const publicEventsPath = $derived(
		navigationContext ? buildScopedPath(navigationContext, '/events') : null
	);
	const previewFields = $derived(fields.filter((field) => field.visibleOnPublic));
	const toScopedRoute = (targetPath: string): ResolvablePath =>
		preserveScopedRouteContext(targetPath, page.url.pathname) as ResolvablePath;

	const createEmptyField = (): IntakeFieldForm => ({
		fieldId: `field_${fields.length + 1}`,
		label: '',
		fieldType: 'text',
		required: false,
		visibleOnPublic: true,
		optionsText: '',
		helpText: '',
		placeholder: ''
	});

	const optionsFromText = (value: string): string[] => {
		const options: string[] = [];
		const seenOptions = new SvelteSet<string>();
		for (const option of value
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)) {
			if (seenOptions.has(option)) {
				continue;
			}
			seenOptions.add(option);
			options.push(option);
		}
		return options;
	};

	const previewFieldLabel = (field: IntakeFieldForm, index: number): string =>
		field.label.trim() || field.fieldId.trim() || `項目 ${index + 1}`;

	const previewPlaceholder = (field: IntakeFieldForm): string | undefined =>
		field.placeholder.trim() || undefined;

	const previewHelpText = (field: IntakeFieldForm): string => field.helpText.trim();

	const applyFields = (nextFields: PublicSiteIntakeFieldPayload[]) => {
		fields = nextFields.map((field) => ({
			fieldId: field.fieldId,
			label: field.label,
			fieldType: field.fieldType,
			required: field.required,
			visibleOnPublic: field.visibleOnPublic ?? true,
			optionsText: field.options.join('\n'),
			helpText: field.helpText ?? '',
			placeholder: field.placeholder ?? ''
		}));
	};

	const addField = () => {
		fields = [...fields, createEmptyField()];
	};

	const removeField = (index: number) => {
		fields = fields.filter((_, currentIndex) => currentIndex !== index);
	};

	const moveField = (index: number, direction: -1 | 1) => {
		const nextIndex = index + direction;
		if (nextIndex < 0 || nextIndex >= fields.length) {
			return;
		}
		const nextFields = [...fields];
		const [field] = nextFields.splice(index, 1);
		if (!field) {
			return;
		}
		nextFields.splice(nextIndex, 0, field);
		fields = nextFields;
	};

	const updateField = <Key extends keyof IntakeFieldForm>(
		index: number,
		key: Key,
		value: IntakeFieldForm[Key]
	) => {
		fields = fields.map((field, currentIndex) =>
			currentIndex === index ? { ...field, [key]: value } : field
		);
	};

	const updateFieldText = (
		index: number,
		key: 'fieldId' | 'label' | 'optionsText' | 'helpText' | 'placeholder',
		event: Event
	) => {
		updateField(index, key, (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value);
	};

	const updateFieldType = (index: number, event: Event) => {
		updateField(
			index,
			'fieldType',
			(event.currentTarget as HTMLSelectElement).value as IntakeFieldType
		);
	};

	const updateFieldBoolean = (index: number, key: 'required' | 'visibleOnPublic', event: Event) => {
		updateField(index, key, (event.currentTarget as HTMLInputElement).checked);
	};

	const validateFields = (): boolean => {
		const fieldIds = new SvelteSet<string>();
		for (const field of fields) {
			const fieldId = field.fieldId.trim();
			if (!/^[a-z0-9][a-z0-9_-]*$/u.test(fieldId)) {
				toast.error('項目IDは英小文字・数字・ハイフン・アンダースコアで入力してください。');
				return false;
			}
			if (fieldIds.has(fieldId)) {
				toast.error('項目IDが重複しています。');
				return false;
			}
			fieldIds.add(fieldId);
			if (!field.label.trim()) {
				toast.error('項目名を入力してください。');
				return false;
			}
			if (field.fieldType === 'select' && optionsFromText(field.optionsText).length === 0) {
				toast.error(`${field.label || field.fieldId}の選択肢を1つ以上入力してください。`);
				return false;
			}
		}
		return true;
	};

	const refresh = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}

		const portalAccess = await loadPortalAccess(routeScopedContext);
		if (!portalAccess.canManageStore) {
			await goto(resolve(resolvePortalHomePath(portalAccess) ?? '/participant/home'));
			return;
		}

		const context = routeScopedContext ?? portalAccess.activeContext ?? null;
		currentContext = context;
		if (!context) {
			fields = [];
			return;
		}

		const payload = await loadIntakeFields(context);
		if (!payload) {
			errorMessage = 'カスタム入力の取得に失敗しました。';
			fields = [];
			return;
		}
		applyFields(payload.fields);
	};

	const submit = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!currentContext || !validateFields()) {
			return;
		}

		busy = true;
		try {
			const result = await updateIntakeFields(currentContext, {
				fields: fields.map((field) => ({
					fieldId: field.fieldId.trim(),
					label: field.label.trim(),
					fieldType: field.fieldType,
					required: field.required,
					visibleOnPublic: field.visibleOnPublic,
					options: field.fieldType === 'select' ? optionsFromText(field.optionsText) : [],
					helpText: field.helpText.trim() || null,
					placeholder: field.fieldType === 'checkbox' ? null : field.placeholder.trim() || null
				}))
			});
			if (!result.ok || !result.fields) {
				toast.error(result.message);
				return;
			}

			applyFields(result.fields.fields);
			toast.success(result.message);
		} finally {
			busy = false;
		}
	};

	onMount(() => {
		void (async () => {
			loading = true;
			errorMessage = null;
			try {
				if (routePathname === '/intake-fields') {
					await goto(resolve(toScopedRoute('/admin/intake-fields')));
					return;
				}
				await refresh();
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-3">
		{#if publicSiteManagementPath}
			<Button
				type="button"
				variant="ghost"
				href={resolve(publicSiteManagementPath as ResolvablePath)}
			>
				<ArrowLeft class="size-4" />
				予約サイト管理へ戻る
			</Button>
		{/if}
		<div class="space-y-2">
			<h1 class="text-3xl font-semibold text-foreground">カスタム入力</h1>
			<p class="text-sm text-muted-foreground">
				公開予約フォームで予約者に入力してもらう追加項目を店舗ごとに管理します。
			</p>
		</div>
	</header>

	{#if loading}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">カスタム入力を読み込み中…</p>
			</CardContent>
		</Card>
	{:else if !currentContext}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardHeader>
				<h2 class="text-xl font-semibold text-foreground">店舗を選択してください</h2>
				<CardDescription>カスタム入力は店舗ごとに管理します。</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<Button type="button" variant="outline" href={resolve(toScopedRoute('/admin/stores'))}>
					店舗管理へ移動
				</Button>
			</CardContent>
		</Card>
	{:else if errorMessage}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-destructive">{errorMessage}</p>
			</CardContent>
		</Card>
	{:else}
		<section class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.45fr)]">
			<Card class="surface-panel border-border/80 shadow-lg">
				<CardHeader class="space-y-2">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="space-y-1">
							<h2 class="text-xl font-semibold text-foreground">入力項目</h2>
							<CardDescription>上から順に公開予約フォームへ表示します。</CardDescription>
						</div>
						<Button type="button" variant="outline" onclick={addField} disabled={busy}>
							<Plus class="mr-2 size-4" />
							項目を追加
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					<form class="space-y-5" onsubmit={submit}>
						{#if fields.length === 0}
							<div class="rounded-md border border-border/80 bg-secondary/40 p-4">
								<p class="text-sm text-muted-foreground">追加項目は未設定です。</p>
							</div>
						{:else}
							{#each fields as field, index (field.fieldId || index)}
								<fieldset class="space-y-4 rounded-lg border border-border/80 bg-card/80 p-4">
									<legend class="px-1 text-sm font-semibold text-foreground">
										{field.label || `項目 ${index + 1}`}
									</legend>

									<div class="flex flex-wrap justify-end gap-2">
										<Button
											type="button"
											variant="outline"
											size="sm"
											onclick={() => moveField(index, -1)}
											disabled={busy || index === 0}
										>
											<ArrowUp class="mr-1 size-4" />
											上へ
										</Button>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onclick={() => moveField(index, 1)}
											disabled={busy || index === fields.length - 1}
										>
											<ArrowDown class="mr-1 size-4" />
											下へ
										</Button>
										<Button
											type="button"
											variant="destructive"
											size="sm"
											onclick={() => removeField(index)}
											disabled={busy}
										>
											<Trash2 class="mr-1 size-4" />
											削除
										</Button>
									</div>

									<div class="grid gap-4 md:grid-cols-2">
										<div class="space-y-2">
											<Label for={`intake-field-id-${index}`}>項目ID</Label>
											<Input
												id={`intake-field-id-${index}`}
												value={field.fieldId}
												oninput={(event) => updateFieldText(index, 'fieldId', event)}
												disabled={busy}
												maxlength={80}
												required
											/>
										</div>
										<div class="space-y-2">
											<Label for={`intake-field-label-${index}`}>項目名</Label>
											<Input
												id={`intake-field-label-${index}`}
												value={field.label}
												oninput={(event) => updateFieldText(index, 'label', event)}
												disabled={busy}
												maxlength={120}
												required
											/>
										</div>
										<div class="space-y-2">
											<Label for={`intake-field-type-${index}`}>種類</Label>
											<select
												id={`intake-field-type-${index}`}
												class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
												value={field.fieldType}
												onchange={(event) => updateFieldType(index, event)}
												disabled={busy}
											>
												{#each fieldTypeOptions as option (option.value)}
													<option value={option.value}>{option.label}</option>
												{/each}
											</select>
										</div>
										<div class="space-y-2">
											<Label for={`intake-field-placeholder-${index}`}>プレースホルダー</Label>
											<Input
												id={`intake-field-placeholder-${index}`}
												value={field.placeholder}
												oninput={(event) => updateFieldText(index, 'placeholder', event)}
												disabled={busy || field.fieldType === 'checkbox'}
												maxlength={200}
											/>
										</div>
										<div class="space-y-2 md:col-span-2">
											<Label for={`intake-field-help-${index}`}>補足文</Label>
											<Input
												id={`intake-field-help-${index}`}
												value={field.helpText}
												oninput={(event) => updateFieldText(index, 'helpText', event)}
												disabled={busy}
												maxlength={500}
											/>
										</div>
										{#if field.fieldType === 'select'}
											<div class="space-y-2 md:col-span-2">
												<Label for={`intake-field-options-${index}`}>選択肢</Label>
												<textarea
													id={`intake-field-options-${index}`}
													class="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
													value={field.optionsText}
													oninput={(event) => updateFieldText(index, 'optionsText', event)}
													disabled={busy}
													required
												></textarea>
											</div>
										{/if}
										<div class="flex flex-wrap gap-3 md:col-span-2">
											<label
												class="flex items-center gap-2 rounded-md border border-border/70 bg-background/70 px-3 py-2 text-sm"
											>
												<input
													type="checkbox"
													class="size-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
													checked={field.required}
													onchange={(event) => updateFieldBoolean(index, 'required', event)}
													disabled={busy}
												/>
												<span>必須</span>
											</label>
											<label
												class="flex items-center gap-2 rounded-md border border-border/70 bg-background/70 px-3 py-2 text-sm"
											>
												<input
													type="checkbox"
													class="size-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
													checked={field.visibleOnPublic}
													onchange={(event) => updateFieldBoolean(index, 'visibleOnPublic', event)}
													disabled={busy}
												/>
												<span>公開予約フォームに表示</span>
											</label>
										</div>
									</div>
								</fieldset>
							{/each}
						{/if}

						<div class="flex flex-wrap items-center gap-2">
							<Button type="submit" disabled={busy}>
								{busy ? '保存中…' : '保存'}
							</Button>
							<Button
								type="button"
								variant="outline"
								href={publicSiteManagementPath
									? resolve(publicSiteManagementPath as ResolvablePath)
									: undefined}
								disabled={!publicSiteManagementPath || busy}
							>
								<ArrowLeft class="size-4" />
								予約サイト管理へ戻る
							</Button>
							<Button
								type="button"
								variant="outline"
								href={publicEventsPath ? resolve(publicEventsPath as ResolvablePath) : undefined}
								target="_blank"
								rel="noreferrer"
								disabled={!publicEventsPath || busy}
							>
								<ExternalLink class="size-4" />
								予約ページ一覧を開く
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>

			<Card
				class="surface-panel border-border/80 shadow-lg"
				role="region"
				aria-labelledby="intake-preview-heading"
			>
				<CardHeader class="space-y-2">
					<h2 id="intake-preview-heading" class="text-lg font-semibold text-foreground">
						予約フォームプレビュー
					</h2>
					<CardDescription>公開予約フォームに表示する項目だけを確認できます。</CardDescription>
				</CardHeader>
				<CardContent>
					{#if previewFields.length === 0}
						<div class="rounded-md border border-border/80 bg-secondary/40 p-4">
							<p class="text-sm text-muted-foreground">
								公開予約フォームに表示する項目はありません。
							</p>
						</div>
					{:else}
						<div class="space-y-4 rounded-lg border border-border/80 bg-background p-4">
							{#each previewFields as field, previewIndex (field.fieldId || previewIndex)}
								{@const fieldLabel = previewFieldLabel(field, previewIndex)}
								{@const fieldHelpText = previewHelpText(field)}
								{@const fieldPlaceholder = previewPlaceholder(field)}
								{@const fieldOptions = optionsFromText(field.optionsText)}
								{@const inputId = `intake-preview-field-${previewIndex}`}
								{@const helpId = `intake-preview-help-${previewIndex}`}
								<div class="space-y-2">
									{#if field.fieldType === 'checkbox'}
										<label
											class="flex items-center gap-2 rounded-md border border-border/80 bg-secondary/40 px-3 py-2 text-sm"
										>
											<input
												type="checkbox"
												class="size-4 rounded border-input text-primary"
												aria-describedby={fieldHelpText ? helpId : undefined}
												required={field.required}
												disabled
											/>
											<span class="min-w-0">
												<span class="font-medium text-foreground">{fieldLabel}</span>
												{#if field.required}
													<span class="ml-2 text-xs font-semibold text-destructive">必須</span>
												{/if}
											</span>
										</label>
									{:else}
										<Label for={inputId} class="flex items-center gap-2">
											<span>{fieldLabel}</span>
											{#if field.required}
												<span class="text-xs font-semibold text-destructive">必須</span>
											{/if}
										</Label>
										{#if field.fieldType === 'textarea'}
											<textarea
												id={inputId}
												class="min-h-24 w-full rounded-md border border-input bg-secondary/30 px-3 py-2 text-sm text-foreground shadow-xs disabled:cursor-default disabled:opacity-100"
												value=""
												placeholder={fieldPlaceholder}
												aria-describedby={fieldHelpText ? helpId : undefined}
												required={field.required}
												disabled
											></textarea>
										{:else if field.fieldType === 'select'}
											<select
												id={inputId}
												class="flex h-10 w-full rounded-md border border-input bg-secondary/30 px-3 py-2 text-sm text-foreground shadow-xs disabled:cursor-default disabled:opacity-100"
												aria-describedby={fieldHelpText ? helpId : undefined}
												required={field.required}
												disabled
											>
												<option value="">{fieldPlaceholder ?? '選択してください'}</option>
												{#each fieldOptions as option (option)}
													<option value={option}>{option}</option>
												{/each}
											</select>
										{:else}
											<Input
												id={inputId}
												value=""
												placeholder={fieldPlaceholder}
												aria-describedby={fieldHelpText ? helpId : undefined}
												required={field.required}
												disabled
												class="bg-secondary/30 disabled:cursor-default disabled:opacity-100"
											/>
										{/if}
									{/if}
									{#if fieldHelpText}
										<p id={helpId} class="text-xs text-muted-foreground">{fieldHelpText}</p>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</CardContent>
			</Card>
		</section>
	{/if}
</main>
