<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import {
		ArrowLeft,
		Archive,
		ClipboardList,
		FilePenLine,
		Plus,
		Send,
		Trash2
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		archiveForm,
		createForm,
		createFormAssignment,
		deleteFormAssignment,
		loadForm,
		loadForms,
		loadFormSubmissionDetail,
		loadFormSubmissions,
		publishForm,
		updateForm
	} from '$lib/features/forms';
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
		parseResponseBody,
		redirectToLoginWithNext,
		resolvePortalHomePath
	} from '$lib/features/auth-session.svelte';
	import {
		authRpc,
		type FormAssignmentPayload,
		type FormFieldInput,
		type FormFieldType,
		type FormPayload,
		type FormSubmissionDetailPayload,
		type FormSubmissionSummaryPayload,
		type FormTargetType,
		type FormType,
		type ServicePayload,
		type SlotPayload
	} from '$lib/rpc-client';

	type ResolvablePath = Pathname;
	type Mode = 'list' | 'new' | 'edit' | 'assignments' | 'submissions';
	type FieldDraft = {
		id?: string;
		fieldKey: string;
		fieldType: FormFieldType;
		label: string;
		description: string;
		placeholder: string;
		required: boolean;
		optionsText: string;
	};
	type FormDraft = {
		formType: FormType;
		name: string;
		description: string;
		fields: FieldDraft[];
	};
	type FormTypeDefinition = {
		value: FormType;
		label: string;
		description: string;
		defaultName: string;
		defaultDescription: string;
		previewTitle: string;
		previewDescription: string;
		previewSectionTitle: string;
		previewIncludesBookingFields: boolean;
	};
	type DefaultBookingField = {
		label: string;
		requirement: '必須' | '任意';
		policy: '固定';
	};

	const formTypeDefinitions: FormTypeDefinition[] = [
		{
			value: 'reservation_input',
			label: '予約フォーム設定',
			description: '公開予約時に入力してもらう追加項目です。',
			defaultName: '予約フォームの追加項目',
			defaultDescription: '公開予約フォームの標準項目の後に表示する追加質問です。',
			previewTitle: '予約フォームのプレビュー',
			previewDescription: '予約者情報と追加質問を、公開予約フォームに近い並びで表示します。',
			previewSectionTitle: '追加質問',
			previewIncludesBookingFields: true
		},
		{
			value: 'pre_survey',
			label: '事前アンケート',
			description: '予約前に確認したい質問です。',
			defaultName: '事前アンケート',
			defaultDescription: '予約前に確認したい質問を設定します。',
			previewTitle: '事前アンケートのプレビュー',
			previewDescription: '事前アンケートの項目だけを表示します。',
			previewSectionTitle: '事前アンケート',
			previewIncludesBookingFields: false
		},
		{
			value: 'consent',
			label: '同意事項',
			description: 'キャンセルポリシーなどへの同意チェックです。',
			defaultName: '同意事項',
			defaultDescription: '予約前に同意してもらう内容を設定します。',
			previewTitle: '同意事項のプレビュー',
			previewDescription: '同意事項の項目だけを表示します。',
			previewSectionTitle: '同意事項',
			previewIncludesBookingFields: false
		}
	];
	const formTypeOptions: Array<{ value: FormType; label: string }> = formTypeDefinitions.map(
		(definition) => ({
			value: definition.value,
			label: definition.label
		})
	);
	const defaultBookingFields: DefaultBookingField[] = [
		{ label: '氏名', requirement: '必須', policy: '固定' },
		{ label: 'メールアドレス', requirement: '必須', policy: '固定' },
		{ label: '電話番号', requirement: '任意', policy: '固定' },
		{ label: '人数', requirement: '必須', policy: '固定' },
		{ label: '同伴者名', requirement: '任意', policy: '固定' },
		{ label: '備考', requirement: '任意', policy: '固定' }
	];
	const fieldTypeOptions: Array<{ value: FormFieldType; label: string }> = [
		{ value: 'text', label: '1行テキスト' },
		{ value: 'textarea', label: '複数行テキスト' },
		{ value: 'radio', label: 'ラジオボタン' },
		{ value: 'checkbox', label: 'チェックボックス' },
		{ value: 'select', label: 'セレクト' },
		{ value: 'date', label: '日付' },
		{ value: 'consent', label: '同意チェック' }
	];
	const targetTypeOptions: Array<{ value: FormTargetType; label: string }> = [
		{ value: 'store', label: '店舗全体' },
		{ value: 'service', label: 'サービス' },
		{ value: 'slot', label: '予約枠' }
	];

	let loading = $state(true);
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);
	let currentContext = $state<ScopedRouteContext | null>(null);
	let forms = $state<FormPayload[]>([]);
	let selectedForm = $state<FormPayload | null>(null);
	let submissions = $state<FormSubmissionSummaryPayload[]>([]);
	let selectedSubmission = $state<FormSubmissionDetailPayload | null>(null);
	let services = $state<ServicePayload[]>([]);
	let slots = $state<SlotPayload[]>([]);
	let draft = $state<FormDraft>({
		formType: 'reservation_input',
		name: '',
		description: '',
		fields: []
	});
	let assignmentForm = $state<{ targetType: FormTargetType; targetId: string }>({
		targetType: 'store',
		targetId: ''
	});

	const routePathname = $derived(getRoutePathFromUrlPath(page.url.pathname));
	const routeScopedContext = $derived(extractScopedRouteContext(page.url.pathname));
	const routeFormId = $derived(page.params.formId ?? '');
	const routeNewFormType = $derived.by((): FormType => {
		const value = page.url.searchParams.get('type');
		return isFormType(value) ? value : 'reservation_input';
	});
	const navigationContext = $derived(currentContext ?? routeScopedContext);
	const mode = $derived.by((): Mode => {
		if (routePathname.endsWith('/new')) {
			return 'new';
		}
		if (routePathname.endsWith('/assignments')) {
			return 'assignments';
		}
		if (routePathname.endsWith('/submissions')) {
			return 'submissions';
		}
		return routeFormId ? 'edit' : 'list';
	});
	const formsPath = $derived(
		navigationContext ? buildScopedPath(navigationContext, '/admin/forms') : '/admin/forms'
	);
	const newFormPathForType = (formType: FormType): ResolvablePath =>
		preserveScopedRouteContext(
			`/admin/forms/new?type=${encodeURIComponent(formType)}`,
			page.url.pathname
		) as ResolvablePath;
	const editFormPath = (formId: string): ResolvablePath =>
		preserveScopedRouteContext(
			`/admin/forms/${encodeURIComponent(formId)}`,
			page.url.pathname
		) as ResolvablePath;
	const assignmentsPath = (formId: string): ResolvablePath =>
		preserveScopedRouteContext(
			`/admin/forms/${encodeURIComponent(formId)}/assignments`,
			page.url.pathname
		) as ResolvablePath;
	const submissionsPath = (formId: string): ResolvablePath =>
		preserveScopedRouteContext(
			`/admin/forms/${encodeURIComponent(formId)}/submissions`,
			page.url.pathname
		) as ResolvablePath;
	const bookingsPath = (bookingId: string): ResolvablePath =>
		preserveScopedRouteContext(
			`/admin/bookings/${encodeURIComponent(bookingId)}`,
			page.url.pathname
		) as ResolvablePath;

	function isFormType(value: string | null): value is FormType {
		return value === 'reservation_input' || value === 'pre_survey' || value === 'consent';
	}
	const getFormTypeDefinition = (value: FormType): FormTypeDefinition => {
		const definition = formTypeDefinitions.find((item) => item.value === value);
		if (definition) {
			return definition;
		}
		return formTypeDefinitions[0] as FormTypeDefinition;
	};
	const formTypeLabel = (value: FormType): string =>
		formTypeOptions.find((option) => option.value === value)?.label ?? value;
	const fieldTypeLabel = (value: FormFieldType): string =>
		fieldTypeOptions.find((option) => option.value === value)?.label ?? value;
	const targetTypeLabel = (value: FormTargetType): string =>
		targetTypeOptions.find((option) => option.value === value)?.label ?? value;
	const statusLabel = (value: FormPayload['status']): string => {
		if (value === 'published') {
			return '公開中';
		}
		if (value === 'archived') {
			return 'アーカイブ';
		}
		return '下書き';
	};
	const formatDateTime = (value: string): string => new Date(value).toLocaleString('ja-JP');
	const sortFormsByUpdatedAtDesc = (left: FormPayload, right: FormPayload): number =>
		new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
	const formTypeGroups = $derived.by(() =>
		formTypeDefinitions.map((definition) => {
			const activeForms = [
				...forms.filter((form) => form.formType === definition.value && form.status !== 'archived')
			].sort(sortFormsByUpdatedAtDesc);
			return {
				definition,
				activeForms,
				primaryForm: activeForms[0] ?? null
			};
		})
	);
	const selectedDefinition = $derived(getFormTypeDefinition(draft.formType));
	const optionTextToPayload = (value: string) =>
		Array.from(
			new Set(
				value
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean)
			)
		).map((option) => ({ value: option, label: option }));

	const fieldToDraft = (field: FormPayload['fields'][number]): FieldDraft => ({
		id: field.id,
		fieldKey: field.fieldKey,
		fieldType: field.fieldType,
		label: field.label,
		description: field.description ?? '',
		placeholder: field.placeholder ?? '',
		required: field.required,
		optionsText: field.options.map((option) => option.label || option.value).join('\n')
	});

	const createDefaultDraft = (formType: FormType): FormDraft => {
		const definition = getFormTypeDefinition(formType);
		const fields: FieldDraft[] = [];
		return {
			formType,
			name: definition.defaultName,
			description: definition.defaultDescription,
			fields: [createEmptyField(formType, fields)]
		};
	};

	const applyFormToDraft = (form: FormPayload | null) => {
		if (!form) {
			draft = createDefaultDraft(routeNewFormType);
			return;
		}
		draft = {
			formType: form.formType,
			name: form.name,
			description: form.description ?? '',
			fields: form.fields.map(fieldToDraft)
		};
	};

	const createEmptyFieldKey = (fields: FieldDraft[] = draft.fields) => {
		const keys = new Set(fields.map((field) => field.fieldKey.trim()));
		let index = fields.length + 1;
		let key = `field_${index}`;
		while (keys.has(key)) {
			index += 1;
			key = `field_${index}`;
		}
		return key;
	};

	const createEmptyField = (
		formType: FormType = draft.formType,
		fields: FieldDraft[] = draft.fields
	): FieldDraft => ({
		fieldKey: createEmptyFieldKey(fields),
		fieldType: formType === 'consent' ? 'consent' : 'text',
		label: '',
		description: '',
		placeholder: '',
		required: formType === 'consent',
		optionsText: ''
	});

	const addField = () => {
		draft.fields = [...draft.fields, createEmptyField()];
	};

	const removeField = (index: number) => {
		draft.fields = draft.fields.filter((_, currentIndex) => currentIndex !== index);
	};

	const moveField = (index: number, direction: -1 | 1) => {
		const nextIndex = index + direction;
		if (nextIndex < 0 || nextIndex >= draft.fields.length) {
			return;
		}
		const nextFields = [...draft.fields];
		const [field] = nextFields.splice(index, 1);
		if (!field) {
			return;
		}
		nextFields.splice(nextIndex, 0, field);
		draft.fields = nextFields;
	};

	const updateField = <Key extends keyof FieldDraft>(
		index: number,
		key: Key,
		value: FieldDraft[Key]
	) => {
		draft.fields = draft.fields.map((field, currentIndex) =>
			currentIndex === index ? { ...field, [key]: value } : field
		);
	};

	const requiresOptions = (fieldType: FormFieldType) =>
		fieldType === 'radio' || fieldType === 'checkbox' || fieldType === 'select';
	const allowsPlaceholder = (fieldType: FormFieldType) =>
		fieldType === 'text' || fieldType === 'textarea';
	const optionRows = (field: FieldDraft): string[] =>
		field.optionsText.length > 0 ? field.optionsText.split('\n') : [];
	const defaultOptionsText = '選択肢 1\n選択肢 2';

	const updateFieldType = (index: number, fieldType: FormFieldType) => {
		draft.fields = draft.fields.map((field, currentIndex) => {
			if (currentIndex !== index) {
				return field;
			}
			return {
				...field,
				fieldType,
				placeholder: allowsPlaceholder(fieldType) ? field.placeholder : '',
				required: fieldType === 'consent' ? true : field.required,
				optionsText: requiresOptions(fieldType)
					? field.optionsText.trim()
						? field.optionsText
						: defaultOptionsText
					: ''
			};
		});
	};

	const updateFieldOption = (fieldIndex: number, optionIndex: number, value: string) => {
		const field = draft.fields[fieldIndex];
		if (!field) {
			return;
		}
		const nextOptions = optionRows(field);
		nextOptions[optionIndex] = value;
		updateField(fieldIndex, 'optionsText', nextOptions.join('\n'));
	};

	const addFieldOption = (fieldIndex: number) => {
		const field = draft.fields[fieldIndex];
		if (!field) {
			return;
		}
		const nextOptions = optionRows(field);
		nextOptions.push(`選択肢 ${nextOptions.length + 1}`);
		updateField(fieldIndex, 'optionsText', nextOptions.join('\n'));
	};

	const removeFieldOption = (fieldIndex: number, optionIndex: number) => {
		const field = draft.fields[fieldIndex];
		if (!field) {
			return;
		}
		const nextOptions = optionRows(field);
		nextOptions.splice(optionIndex, 1);
		updateField(fieldIndex, 'optionsText', nextOptions.join('\n'));
	};

	const validateDraft = () => {
		if (!draft.name.trim()) {
			toast.error('フォーム名を入力してください。');
			return false;
		}
		const keys: string[] = [];
		for (const field of draft.fields) {
			const fieldKey = field.fieldKey.trim();
			if (!/^[a-zA-Z0-9_-]+$/u.test(fieldKey)) {
				toast.error('項目キーは英数字、ハイフン、アンダースコアで入力してください。');
				return false;
			}
			if (keys.includes(fieldKey)) {
				toast.error('項目キーが重複しています。');
				return false;
			}
			keys.push(fieldKey);
			if (!field.label.trim()) {
				toast.error('項目ラベルを入力してください。');
				return false;
			}
			if (requiresOptions(field.fieldType) && optionTextToPayload(field.optionsText).length === 0) {
				toast.error(`${field.label || field.fieldKey}の選択肢を入力してください。`);
				return false;
			}
		}
		if (
			draft.formType === 'consent' &&
			draft.fields.every((field) => field.fieldType !== 'consent')
		) {
			toast.error('同意フォームには同意チェック項目が必要です。');
			return false;
		}
		return true;
	};

	const toFieldInputs = (): FormFieldInput[] =>
		draft.fields.map((field, index) => ({
			id: field.id,
			fieldKey: field.fieldKey.trim(),
			fieldType: field.fieldType,
			label: field.label.trim(),
			description: field.description.trim() || null,
			placeholder: allowsPlaceholder(field.fieldType) ? field.placeholder.trim() || null : null,
			required: field.required,
			options: requiresOptions(field.fieldType) ? optionTextToPayload(field.optionsText) : [],
			sortOrder: index
		}));

	const refreshTargets = async (context: ScopedRouteContext) => {
		const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
		const to = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
		const [servicesResponse, slotsResponse] = await Promise.all([
			authRpc.listServicesScoped(context),
			authRpc.listSlotsScoped(context, { from, to })
		]);
		const [servicesPayload, slotsPayload] = await Promise.all([
			parseResponseBody(servicesResponse),
			parseResponseBody(slotsResponse)
		]);
		services = servicesResponse.ok && Array.isArray(servicesPayload) ? servicesPayload : [];
		slots = slotsResponse.ok && Array.isArray(slotsPayload) ? slotsPayload : [];
	};

	const targetOptions = $derived.by(() => {
		if (assignmentForm.targetType === 'store') {
			return selectedForm ? [{ value: selectedForm.storeId, label: '店舗全体' }] : [];
		}
		if (assignmentForm.targetType === 'service') {
			return services.map((service) => ({ value: service.id, label: service.name }));
		}
		return slots.map((slot) => ({
			value: slot.id,
			label: `${formatDateTime(slot.startAt)} / ${services.find((service) => service.id === slot.serviceId)?.name ?? slot.serviceId}`
		}));
	});

	const targetLabel = (assignment: FormAssignmentPayload) => {
		if (assignment.targetType === 'store') {
			return '店舗全体';
		}
		if (assignment.targetType === 'service') {
			return (
				services.find((service) => service.id === assignment.targetId)?.name ?? assignment.targetId
			);
		}
		const slot = slots.find((item) => item.id === assignment.targetId);
		if (!slot) {
			return assignment.targetId;
		}
		return `${formatDateTime(slot.startAt)} / ${services.find((service) => service.id === slot.serviceId)?.name ?? slot.serviceId}`;
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
			forms = [];
			selectedForm = null;
			return;
		}

		const listPayload = await loadForms(context);
		forms = listPayload.forms;

		if (mode === 'new') {
			selectedForm = null;
			applyFormToDraft(null);
			return;
		}

		if (routeFormId) {
			selectedForm = await loadForm(context, routeFormId);
			if (!selectedForm) {
				errorMessage = 'フォームが見つかりません。';
				return;
			}
			applyFormToDraft(selectedForm);
			assignmentForm = {
				targetType: 'store',
				targetId: selectedForm.storeId
			};
			if (mode === 'assignments') {
				await refreshTargets(context);
			}
			if (mode === 'submissions') {
				const payload = await loadFormSubmissions(context, selectedForm.id);
				submissions = payload.submissions;
			}
		} else {
			selectedForm = null;
		}
	};

	const saveForm = async () => {
		if (!currentContext || busy || !validateDraft()) {
			return;
		}
		busy = true;
		try {
			const input = {
				formType: draft.formType,
				name: draft.name.trim(),
				description: draft.description.trim() || null,
				fields: toFieldInputs()
			};
			const formId = selectedForm?.id ?? null;
			const isNewForm = mode === 'new' || !formId;
			const result = isNewForm
				? await createForm(currentContext, input)
				: await updateForm(currentContext, formId, input);
			if (!result.ok || !result.form) {
				toast.error(result.message);
				return;
			}
			let savedForm = result.form;
			if (isNewForm && savedForm.assignments.length === 0) {
				const assignmentResult = await createFormAssignment(currentContext, savedForm.id, {
					targetType: 'store',
					targetId: savedForm.storeId
				});
				if (assignmentResult.ok && assignmentResult.assignments) {
					savedForm = { ...savedForm, assignments: assignmentResult.assignments };
				} else {
					toast.warning('作成しましたが、店舗全体への自動割り当てに失敗しました。');
				}
			}
			toast.success(result.message);
			await goto(resolve(editFormPath(savedForm.id)));
		} finally {
			busy = false;
		}
	};

	const publishSelectedForm = async () => {
		if (!currentContext || !selectedForm || busy) {
			return;
		}
		busy = true;
		try {
			const result = await publishForm(currentContext, selectedForm.id);
			if (!result.ok || !result.form) {
				toast.error(result.message);
				return;
			}
			selectedForm = result.form;
			applyFormToDraft(result.form);
			toast.success(result.message);
			await refresh();
		} finally {
			busy = false;
		}
	};

	const archiveSelectedForm = async () => {
		if (!currentContext || !selectedForm || busy) {
			return;
		}
		busy = true;
		try {
			const result = await archiveForm(currentContext, selectedForm.id);
			if (!result.ok || !result.form) {
				toast.error(result.message);
				return;
			}
			selectedForm = result.form;
			toast.success(result.message);
			await refresh();
		} finally {
			busy = false;
		}
	};

	const submitAssignment = async () => {
		if (!currentContext || !selectedForm || busy || !assignmentForm.targetId) {
			return;
		}
		busy = true;
		try {
			const result = await createFormAssignment(currentContext, selectedForm.id, {
				targetType: assignmentForm.targetType,
				targetId: assignmentForm.targetId
			});
			if (!result.ok || !result.assignments) {
				toast.error(result.message);
				return;
			}
			selectedForm.assignments = result.assignments;
			toast.success(result.message);
		} finally {
			busy = false;
		}
	};

	const removeAssignment = async (assignmentId: string) => {
		if (!currentContext || !selectedForm || busy) {
			return;
		}
		busy = true;
		try {
			const result = await deleteFormAssignment(currentContext, selectedForm.id, assignmentId);
			if (!result.ok || !result.assignments) {
				toast.error(result.message);
				return;
			}
			selectedForm.assignments = result.assignments;
			toast.success(result.message);
		} finally {
			busy = false;
		}
	};

	const showSubmissionDetail = async (submissionId: string) => {
		if (!currentContext || busy) {
			return;
		}
		busy = true;
		try {
			selectedSubmission = await loadFormSubmissionDetail(currentContext, submissionId);
		} finally {
			busy = false;
		}
	};

	const assignmentSummary = (form: FormPayload): string => {
		if (
			form.assignments.some(
				(assignment) => assignment.targetType === 'store' && assignment.targetId === form.storeId
			)
		) {
			return 'この店舗のすべての予約に表示';
		}
		if (form.assignments.length > 0) {
			return 'サービス・予約枠ごとの詳細設定あり';
		}
		return '未割り当て';
	};

	const draftOptions = (field: FieldDraft) => optionTextToPayload(field.optionsText);

	const previewPlaceholder = (field: FieldDraft): string => {
		if (field.placeholder.trim()) {
			return field.placeholder.trim();
		}
		if (field.fieldType === 'date') {
			return '2026-06-06';
		}
		if (field.fieldType === 'textarea') {
			return '入力内容';
		}
		return '回答';
	};

	const renderAnswerValue = (value: unknown): string => {
		if (Array.isArray(value)) {
			return value.join('、');
		}
		if (typeof value === 'boolean') {
			return value ? '同意済み' : '未同意';
		}
		if (value === null || value === undefined || value === '') {
			return '-';
		}
		return String(value);
	};

	onMount(() => {
		void (async () => {
			loading = true;
			errorMessage = null;
			try {
				await refresh();
			} catch (error) {
				errorMessage =
					error instanceof Error ? error.message : 'フォーム管理の読み込みに失敗しました。';
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-3">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="space-y-2">
				<h1 class="text-3xl font-semibold text-foreground">フォーム管理</h1>
				<p class="text-sm text-muted-foreground">
					公開予約時に表示する標準項目、追加質問、事前アンケート、同意事項を管理します。
				</p>
			</div>
		</div>
		{#if mode !== 'list'}
			<Button type="button" variant="ghost" href={resolve(formsPath as ResolvablePath)}>
				<ArrowLeft class="size-4" />
				フォーム管理へ戻る
			</Button>
		{/if}
	</header>

	{#if loading}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">フォーム管理を読み込み中…</p>
			</CardContent>
		</Card>
	{:else if !currentContext}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardHeader>
				<h2 class="text-xl font-semibold text-foreground">店舗を選択してください</h2>
				<CardDescription>フォームは店舗ごとに管理します。</CardDescription>
			</CardHeader>
		</Card>
	{:else if errorMessage}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-destructive">{errorMessage}</p>
			</CardContent>
		</Card>
	{:else if mode === 'list'}
		<section class="grid gap-4 lg:grid-cols-3" aria-label="フォーム管理メニュー">
			{#each formTypeGroups as group (group.definition.value)}
				<Card class="surface-panel border-border/80 shadow-lg">
					<CardHeader class="space-y-3">
						<div class="space-y-1">
							<h2 class="text-xl font-semibold text-foreground">{group.definition.label}</h2>
							<CardDescription>{group.definition.description}</CardDescription>
						</div>
						<div class="flex flex-wrap gap-2">
							{#if group.primaryForm}
								<Badge variant={group.primaryForm.status === 'published' ? 'outline' : 'secondary'}>
									{statusLabel(group.primaryForm.status)}
								</Badge>
								<Badge variant="secondary">{group.primaryForm.fields.length}項目</Badge>
							{:else}
								<Badge variant="secondary">未作成</Badge>
							{/if}
						</div>
					</CardHeader>
					<CardContent class="space-y-4">
						{#if group.primaryForm}
							<div class="space-y-2 rounded-md border border-border/80 bg-background p-3 text-sm">
								<p class="font-medium text-foreground">{group.primaryForm.name}</p>
								<p class="text-muted-foreground">{assignmentSummary(group.primaryForm)}</p>
								<p class="text-xs text-muted-foreground">
									更新日時: {formatDateTime(group.primaryForm.updatedAt)}
								</p>
							</div>
							{#if group.activeForms.length > 1}
								<div class="space-y-2 text-sm">
									<p class="font-medium text-foreground">同じ種類のフォーム</p>
									<div class="space-y-2">
										{#each group.activeForms.slice(1) as form (form.id)}
											<div
												class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-secondary/30 px-3 py-2"
											>
												<span class="min-w-0 truncate">{form.name}</span>
												<Button
													type="button"
													variant="outline"
													size="sm"
													href={resolve(editFormPath(form.id))}
												>
													編集
												</Button>
											</div>
										{/each}
									</div>
								</div>
							{/if}
						{:else}
							<div class="rounded-md border border-border/80 bg-secondary/40 p-3">
								<p class="text-sm text-muted-foreground">
									最初に作成すると、この店舗のすべての予約に表示されます。
								</p>
							</div>
						{/if}
						<div class="flex flex-wrap gap-2">
							<Button
								type="button"
								href={resolve(
									group.primaryForm
										? editFormPath(group.primaryForm.id)
										: newFormPathForType(group.definition.value)
								)}
							>
								<FilePenLine class="size-4" />
								{group.primaryForm
									? `${group.definition.label}を編集`
									: `${group.definition.label}を作成`}
							</Button>
							{#if group.primaryForm}
								<Button
									type="button"
									variant="outline"
									href={resolve(submissionsPath(group.primaryForm.id))}
								>
									回答を見る
								</Button>
							{/if}
						</div>
					</CardContent>
				</Card>
			{/each}
		</section>
	{:else if mode === 'new' || mode === 'edit'}
		<form
			class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]"
			onsubmit={(event) => {
				event.preventDefault();
				void saveForm();
			}}
		>
			<Card class="surface-panel border-border/80 shadow-lg">
				<CardHeader class="space-y-2">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="space-y-1">
							<h2 class="text-xl font-semibold text-foreground">{selectedDefinition.label}</h2>
							<CardDescription>
								{selectedForm?.currentPublishedVersion
									? `公開版 v${selectedForm.currentPublishedVersion.versionNumber}`
									: '公開前'}
								{#if selectedForm}
									<span class="mx-1">/</span>{assignmentSummary(selectedForm)}
								{:else}
									<span class="mx-1">/</span>作成後、この店舗のすべての予約に表示
								{/if}
							</CardDescription>
						</div>
						{#if selectedForm}
							<div class="flex flex-wrap gap-2">
								<Button
									type="button"
									variant="outline"
									onclick={publishSelectedForm}
									disabled={busy || selectedForm.status === 'archived'}
								>
									<Send class="size-4" />
									公開
								</Button>
								<Button
									type="button"
									variant="destructive"
									onclick={archiveSelectedForm}
									disabled={busy || selectedForm.status === 'archived'}
								>
									<Archive class="size-4" />
									アーカイブ
								</Button>
							</div>
						{/if}
					</div>
				</CardHeader>
				<CardContent class="space-y-6">
					<div class="grid gap-4 md:grid-cols-2">
						<div class="space-y-2">
							<Label for="form-name">設定名</Label>
							<Input
								id="form-name"
								bind:value={draft.name}
								disabled={busy}
								maxlength={200}
								required
							/>
						</div>
						<div class="space-y-2">
							<Label for="form-type-readonly">種類</Label>
							<div
								id="form-type-readonly"
								class="flex h-10 items-center rounded-md border border-border/80 bg-secondary/40 px-3 text-sm text-foreground"
							>
								{selectedDefinition.label}
							</div>
						</div>
						<div class="space-y-2 md:col-span-2">
							<Label for="form-description">説明</Label>
							<textarea
								id="form-description"
								class="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
								bind:value={draft.description}
								disabled={busy}
								maxlength={1000}
							></textarea>
						</div>
					</div>

					{#if draft.formType === 'reservation_input'}
						<section class="space-y-3" aria-labelledby="default-fields-heading">
							<div class="space-y-1">
								<h3 id="default-fields-heading" class="text-lg font-semibold text-foreground">
									デフォルト項目
								</h3>
								<p class="text-sm text-muted-foreground">
									標準項目は予約データとして保存されます。フォーム基盤の項目には含めません。
								</p>
							</div>
							<div class="overflow-hidden rounded-md border border-border/80">
								<table class="w-full text-sm">
									<thead class="bg-secondary/60 text-left text-muted-foreground">
										<tr>
											<th class="px-3 py-2 font-medium">項目</th>
											<th class="px-3 py-2 font-medium">必須</th>
											<th class="px-3 py-2 font-medium">変更</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-border/70 bg-background">
										{#each defaultBookingFields as field (field.label)}
											<tr>
												<td class="px-3 py-2 font-medium text-foreground">{field.label}</td>
												<td class="px-3 py-2">{field.requirement}</td>
												<td class="px-3 py-2 text-muted-foreground">{field.policy}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</section>
					{:else}
						<div class="rounded-md border border-border/80 bg-secondary/40 p-4">
							<p class="text-sm text-muted-foreground">
								右側のプレビューでは、このフォーム種別で設定する項目だけを確認できます。
							</p>
						</div>
					{/if}

					<section class="space-y-4" aria-labelledby="form-fields-heading">
						<div class="flex flex-wrap items-center justify-between gap-3">
							<div class="space-y-1">
								<h3 id="form-fields-heading" class="text-lg font-semibold text-foreground">
									カスタム項目
								</h3>
								<p class="text-sm text-muted-foreground">
									追加した項目だけがフォーム回答として保存されます。
								</p>
							</div>
							<Button type="button" variant="outline" onclick={addField} disabled={busy}>
								<Plus class="size-4" />
								項目を追加
							</Button>
						</div>
						{#if draft.fields.length === 0}
							<div class="rounded-md border border-border/80 bg-secondary/40 p-4">
								<p class="text-sm text-muted-foreground">カスタム項目は未設定です。</p>
							</div>
						{:else}
							<div class="space-y-4">
								{#each draft.fields as field, index (field.fieldKey || index)}
									<fieldset class="space-y-4 rounded-md border border-border/80 bg-background p-4">
										<legend class="px-1 text-sm font-semibold text-foreground">
											{field.label || `項目 ${index + 1}`}
										</legend>
										<div class="grid gap-4 md:grid-cols-2">
											<div class="space-y-2">
												<Label for={`form-field-type-${index}`}>種類</Label>
												<select
													id={`form-field-type-${index}`}
													class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
													value={field.fieldType}
													onchange={(event) =>
														updateFieldType(
															index,
															(event.currentTarget as HTMLSelectElement).value as FormFieldType
														)}
													disabled={busy}
												>
													{#each fieldTypeOptions as option (option.value)}
														<option value={option.value}>{option.label}</option>
													{/each}
												</select>
											</div>
											<div class="space-y-2">
												<Label for={`form-field-label-${index}`}>ラベル</Label>
												<Input
													id={`form-field-label-${index}`}
													value={field.label}
													oninput={(event) =>
														updateField(
															index,
															'label',
															(event.currentTarget as HTMLInputElement).value
														)}
													disabled={busy}
													maxlength={200}
													required
												/>
											</div>
											{#if allowsPlaceholder(field.fieldType)}
												<div class="space-y-2">
													<Label for={`form-field-placeholder-${index}`}>プレースホルダー</Label>
													<Input
														id={`form-field-placeholder-${index}`}
														value={field.placeholder}
														oninput={(event) =>
															updateField(
																index,
																'placeholder',
																(event.currentTarget as HTMLInputElement).value
															)}
														disabled={busy}
														maxlength={200}
													/>
												</div>
											{/if}
											<div class="space-y-2">
												<Label for={`form-field-description-${index}`}>補足</Label>
												<Input
													id={`form-field-description-${index}`}
													value={field.description}
													oninput={(event) =>
														updateField(
															index,
															'description',
															(event.currentTarget as HTMLInputElement).value
														)}
													disabled={busy}
													maxlength={1000}
												/>
											</div>
											{#if requiresOptions(field.fieldType)}
												<div class="space-y-3 md:col-span-2">
													<div class="flex flex-wrap items-center justify-between gap-2">
														<p class="text-sm font-medium text-foreground">選択肢</p>
														<Button
															type="button"
															variant="outline"
															size="sm"
															onclick={() => addFieldOption(index)}
															disabled={busy}
														>
															<Plus class="size-4" />
															選択肢を追加
														</Button>
													</div>
													{#if optionRows(field).length === 0}
														<div class="rounded-md border border-border/80 bg-secondary/40 p-3">
															<p class="text-sm text-muted-foreground">
																選択肢は未設定です。選択肢を追加してください。
															</p>
														</div>
													{:else}
														<div class="space-y-2">
															{#each optionRows(field) as option, optionIndex (optionIndex)}
																<div
																	class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border/80 bg-secondary/30 p-2"
																>
																	{#if field.fieldType === 'radio'}
																		<input
																			type="radio"
																			class="size-4"
																			disabled
																			aria-hidden="true"
																		/>
																	{:else if field.fieldType === 'checkbox'}
																		<input
																			type="checkbox"
																			class="size-4"
																			disabled
																			aria-hidden="true"
																		/>
																	{:else}
																		<span
																			class="flex size-6 items-center justify-center rounded-md border border-border/80 bg-background text-xs text-muted-foreground"
																			aria-hidden="true"
																		>
																			{optionIndex + 1}
																		</span>
																	{/if}
																	<div class="min-w-0">
																		<Label
																			for={`form-field-option-${index}-${optionIndex}`}
																			class="sr-only"
																		>
																			選択肢 {optionIndex + 1}
																		</Label>
																		<Input
																			id={`form-field-option-${index}-${optionIndex}`}
																			value={option}
																			oninput={(event) =>
																				updateFieldOption(
																					index,
																					optionIndex,
																					(event.currentTarget as HTMLInputElement).value
																				)}
																			disabled={busy}
																			maxlength={200}
																			placeholder={`選択肢 ${optionIndex + 1}`}
																		/>
																	</div>
																	<Button
																		type="button"
																		variant="destructive"
																		size="sm"
																		onclick={() => removeFieldOption(index, optionIndex)}
																		disabled={busy || optionRows(field).length <= 1}
																	>
																		削除
																	</Button>
																</div>
															{/each}
														</div>
													{/if}
												</div>
											{/if}
											<div class="flex flex-wrap items-center gap-2 md:col-span-2">
												<label
													class="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-sm"
												>
													<input
														type="checkbox"
														checked={field.required}
														onchange={(event) =>
															updateField(
																index,
																'required',
																(event.currentTarget as HTMLInputElement).checked
															)}
														disabled={busy}
													/>
													<span>必須</span>
												</label>
												<Button
													type="button"
													variant="outline"
													size="sm"
													onclick={() => moveField(index, -1)}
													disabled={busy || index === 0}
												>
													上へ
												</Button>
												<Button
													type="button"
													variant="outline"
													size="sm"
													onclick={() => moveField(index, 1)}
													disabled={busy || index === draft.fields.length - 1}
												>
													下へ
												</Button>
												<Button
													type="button"
													variant="destructive"
													size="sm"
													onclick={() => removeField(index)}
													disabled={busy}
												>
													<Trash2 class="size-4" />
													削除
												</Button>
											</div>
										</div>
									</fieldset>
								{/each}
							</div>
						{/if}
					</section>

					<div class="flex flex-wrap gap-2">
						<Button type="submit" disabled={busy}>{busy ? '保存中…' : '保存'}</Button>
						{#if selectedForm}
							<Button
								type="button"
								variant="outline"
								href={resolve(assignmentsPath(selectedForm.id))}
							>
								<ClipboardList class="size-4" />
								表示対象の詳細設定
							</Button>
							<Button
								type="button"
								variant="outline"
								href={resolve(submissionsPath(selectedForm.id))}
							>
								回答
							</Button>
						{/if}
					</div>
				</CardContent>
			</Card>

			<aside class="lg:sticky lg:top-6 lg:self-start">
				<Card class="surface-panel border-border/80 shadow-lg">
					<CardHeader>
						<h2 class="text-xl font-semibold text-foreground">{selectedDefinition.previewTitle}</h2>
						<CardDescription>{selectedDefinition.previewDescription}</CardDescription>
					</CardHeader>
					<CardContent class="space-y-5">
						{#if selectedDefinition.previewIncludesBookingFields}
							<section class="space-y-3" aria-labelledby="preview-customer-heading">
								<h3 id="preview-customer-heading" class="text-base font-semibold text-foreground">
									予約者情報
								</h3>
								<div class="grid gap-3">
									<div class="grid gap-3 sm:grid-cols-2">
										<div class="space-y-1.5">
											<Label for="preview-customer-name">氏名 *</Label>
											<Input id="preview-customer-name" value="" placeholder="山田 太郎" disabled />
										</div>
										<div class="space-y-1.5">
											<Label for="preview-customer-email">メールアドレス *</Label>
											<Input
												id="preview-customer-email"
												value=""
												placeholder="taro@example.com"
												disabled
											/>
										</div>
									</div>
									<div class="grid gap-3 sm:grid-cols-2">
										<div class="space-y-1.5">
											<Label for="preview-customer-phone">電話番号</Label>
											<Input
												id="preview-customer-phone"
												value=""
												placeholder="090-0000-0000"
												disabled
											/>
										</div>
										<div class="space-y-1.5">
											<Label for="preview-participants-count">人数 *</Label>
											<Input id="preview-participants-count" value="1" disabled />
										</div>
									</div>
									<div class="space-y-1.5">
										<Label for="preview-companions">同伴者名</Label>
										<textarea
											id="preview-companions"
											class="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm opacity-70"
											placeholder="1行に1名ずつ入力"
											disabled
										></textarea>
									</div>
									<div class="space-y-1.5">
										<Label for="preview-note">備考</Label>
										<textarea
											id="preview-note"
											class="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm opacity-70"
											disabled
										></textarea>
									</div>
								</div>
							</section>
						{/if}

						<section class="space-y-3" aria-labelledby="preview-custom-heading">
							<h3 id="preview-custom-heading" class="text-base font-semibold text-foreground">
								{selectedDefinition.previewSectionTitle}
							</h3>
							{#if draft.fields.length === 0}
								<div class="rounded-md border border-border/80 bg-secondary/40 p-3">
									<p class="text-sm text-muted-foreground">追加項目はありません。</p>
								</div>
							{:else}
								<div class="space-y-3">
									{#each draft.fields as field, index (field.fieldKey || index)}
										{@const previewId = `preview-custom-${index}`}
										<div class="space-y-1.5">
											{#if field.fieldType === 'consent'}
												<label
													class="flex items-start gap-3 rounded-md border border-border/80 bg-secondary/30 p-3 text-sm"
												>
													<input type="checkbox" class="mt-1 size-4" disabled />
													<span class="min-w-0 space-y-1">
														<span class="block font-medium text-foreground">
															{field.label || `項目 ${index + 1}`}{field.required ? ' *' : ''}
														</span>
														{#if field.description}
															<span class="block text-xs text-muted-foreground">
																{field.description}
															</span>
														{/if}
													</span>
												</label>
											{:else if field.fieldType === 'checkbox'}
												<div class="space-y-2">
													<p class="text-sm font-medium text-foreground">
														{field.label || `項目 ${index + 1}`}{field.required ? ' *' : ''}
													</p>
													<div class="grid gap-2">
														{#each draftOptions(field) as option (option.value)}
															<label
																class="flex items-center gap-2 rounded-md border border-border/80 bg-secondary/30 px-3 py-2 text-sm"
															>
																<input type="checkbox" disabled />
																<span>{option.label}</span>
															</label>
														{/each}
													</div>
												</div>
											{:else if field.fieldType === 'radio'}
												<div class="space-y-2">
													<p class="text-sm font-medium text-foreground">
														{field.label || `項目 ${index + 1}`}{field.required ? ' *' : ''}
													</p>
													<div class="grid gap-2">
														{#each draftOptions(field) as option (option.value)}
															<label
																class="flex items-center gap-2 rounded-md border border-border/80 bg-secondary/30 px-3 py-2 text-sm"
															>
																<input type="radio" disabled />
																<span>{option.label}</span>
															</label>
														{/each}
													</div>
												</div>
											{:else if field.fieldType === 'select'}
												<Label for={previewId}>
													{field.label || `項目 ${index + 1}`}{field.required ? ' *' : ''}
												</Label>
												<select
													id={previewId}
													class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm opacity-70"
													disabled
												>
													<option>{draftOptions(field)[0]?.label ?? '選択してください'}</option>
												</select>
											{:else if field.fieldType === 'textarea'}
												<Label for={previewId}>
													{field.label || `項目 ${index + 1}`}{field.required ? ' *' : ''}
												</Label>
												<textarea
													id={previewId}
													class="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm opacity-70"
													placeholder={previewPlaceholder(field)}
													disabled
												></textarea>
											{:else}
												<Label for={previewId}>
													{field.label || `項目 ${index + 1}`}{field.required ? ' *' : ''}
												</Label>
												<Input
													id={previewId}
													type={field.fieldType === 'date' ? 'date' : 'text'}
													value=""
													placeholder={previewPlaceholder(field)}
													disabled
												/>
											{/if}
											{#if field.description && field.fieldType !== 'consent'}
												<p class="text-xs text-muted-foreground">{field.description}</p>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</section>
					</CardContent>
				</Card>
			</aside>
		</form>
	{:else if mode === 'assignments' && selectedForm}
		<Card class="surface-panel border-border/80 shadow-lg">
			<CardHeader>
				<h2 class="text-xl font-semibold text-foreground">割り当て</h2>
				<CardDescription
					>{selectedForm.name} / {formTypeLabel(selectedForm.formType)}</CardDescription
				>
			</CardHeader>
			<CardContent class="space-y-5">
				<form
					class="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)_auto]"
					onsubmit={(event) => {
						event.preventDefault();
						void submitAssignment();
					}}
				>
					<div class="space-y-2">
						<Label for="assignment-target-type">対象</Label>
						<select
							id="assignment-target-type"
							class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
							bind:value={assignmentForm.targetType}
							onchange={() => {
								assignmentForm.targetId =
									assignmentForm.targetType === 'store' && selectedForm ? selectedForm.storeId : '';
							}}
							disabled={busy}
						>
							{#each targetTypeOptions as option (option.value)}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					</div>
					<div class="space-y-2">
						<Label for="assignment-target-id">割り当て先</Label>
						<select
							id="assignment-target-id"
							class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
							bind:value={assignmentForm.targetId}
							disabled={busy}
							required
						>
							<option value="">選択してください</option>
							{#each targetOptions as option (option.value)}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					</div>
					<div class="flex items-end">
						<Button type="submit" disabled={busy || !assignmentForm.targetId}>割り当て</Button>
					</div>
				</form>

				{#if selectedForm.assignments.length === 0}
					<div class="rounded-md border border-border/80 bg-secondary/40 p-4">
						<p class="text-sm text-muted-foreground">割り当ては未設定です。</p>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full min-w-[640px] text-sm">
							<thead class="border-b border-border/80 text-left text-muted-foreground">
								<tr>
									<th class="px-3 py-2 font-medium">対象</th>
									<th class="px-3 py-2 font-medium">割り当て先</th>
									<th class="px-3 py-2 font-medium">作成日時</th>
									<th class="px-3 py-2 font-medium">操作</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-border/70">
								{#each selectedForm.assignments as assignment (assignment.id)}
									<tr>
										<td class="px-3 py-3">{targetTypeLabel(assignment.targetType)}</td>
										<td class="px-3 py-3">{targetLabel(assignment)}</td>
										<td class="px-3 py-3">{formatDateTime(assignment.createdAt)}</td>
										<td class="px-3 py-3">
											<Button
												type="button"
												variant="destructive"
												size="sm"
												onclick={() => removeAssignment(assignment.id)}
												disabled={busy}
											>
												解除
											</Button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</CardContent>
		</Card>
	{:else if mode === 'submissions' && selectedForm}
		<section class="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(320px,0.7fr)]">
			<Card class="surface-panel border-border/80 shadow-lg">
				<CardHeader>
					<h2 class="text-xl font-semibold text-foreground">回答一覧</h2>
					<CardDescription>{selectedForm.name}</CardDescription>
				</CardHeader>
				<CardContent>
					{#if submissions.length === 0}
						<div class="rounded-md border border-border/80 bg-secondary/40 p-4">
							<p class="text-sm text-muted-foreground">回答はまだありません。</p>
						</div>
					{:else}
						<div class="overflow-x-auto">
							<table class="w-full min-w-[720px] text-sm">
								<thead class="border-b border-border/80 text-left text-muted-foreground">
									<tr>
										<th class="px-3 py-2 font-medium">回答者</th>
										<th class="px-3 py-2 font-medium">送信元</th>
										<th class="px-3 py-2 font-medium">回答数</th>
										<th class="px-3 py-2 font-medium">送信日時</th>
										<th class="px-3 py-2 font-medium">操作</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-border/70">
									{#each submissions as submission (submission.id)}
										<tr>
											<td class="px-3 py-3">
												<div class="space-y-1">
													<p class="font-medium text-foreground">
														{submission.customerNameSnapshot ?? submission.participantId ?? '-'}
													</p>
													<p class="text-xs text-muted-foreground">
														{submission.customerEmailSnapshot ?? ''}
													</p>
												</div>
											</td>
											<td class="px-3 py-3">{submission.source}</td>
											<td class="px-3 py-3">{submission.answerCount}</td>
											<td class="px-3 py-3">{formatDateTime(submission.submittedAt)}</td>
											<td class="px-3 py-3">
												<div class="flex flex-wrap gap-2">
													<Button
														type="button"
														variant="outline"
														size="sm"
														onclick={() => showSubmissionDetail(submission.id)}
														disabled={busy}
													>
														詳細
													</Button>
													{#if submission.bookingId}
														<Button
															type="button"
															variant="outline"
															size="sm"
															href={resolve(bookingsPath(submission.bookingId))}
														>
															予約
														</Button>
													{/if}
												</div>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</CardContent>
			</Card>

			<Card class="surface-panel border-border/80 shadow-lg">
				<CardHeader>
					<h2 class="text-xl font-semibold text-foreground">回答詳細</h2>
					<CardDescription>
						{selectedSubmission
							? `${selectedSubmission.formName} v${selectedSubmission.versionNumber}`
							: '回答を選択してください'}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{#if !selectedSubmission}
						<p class="text-sm text-muted-foreground">一覧から回答を選択してください。</p>
					{:else}
						<div class="space-y-4">
							<div class="rounded-md border border-border/80 bg-secondary/30 p-3 text-sm">
								<p>送信日時: {formatDateTime(selectedSubmission.submittedAt)}</p>
								<p>送信元: {selectedSubmission.source}</p>
								{#if selectedSubmission.bookingId}
									<p>
										予約:
										<a
											class="text-primary underline-offset-4 hover:underline"
											href={resolve(bookingsPath(selectedSubmission.bookingId))}
										>
											{selectedSubmission.bookingId}
										</a>
									</p>
								{/if}
							</div>
							<div class="space-y-3">
								{#each selectedSubmission.answers as answer (answer.id)}
									<div class="rounded-md border border-border/80 bg-background p-3">
										<div class="flex flex-wrap items-center justify-between gap-2">
											<p class="font-medium text-foreground">{answer.labelSnapshot}</p>
											<span class="text-xs text-muted-foreground">
												{fieldTypeLabel(answer.fieldType)}
											</span>
										</div>
										<p class="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
											{renderAnswerValue(answer.value)}
										</p>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</CardContent>
			</Card>
		</section>
	{/if}
</main>
