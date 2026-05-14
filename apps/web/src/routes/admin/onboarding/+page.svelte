<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { emitAuthSessionUpdated } from '$lib/features/auth-lifecycle';
	import { writeLastAuthPortal } from '$lib/features/auth-portal-preference';
	import {
		createOrganizationWithInitialClassroom,
		uploadOrganizationLogo
	} from '$lib/features/organization-context.svelte';
	import {
		createSlugCandidate,
		normalizeSlug,
		SLUG_INPUT_HINT,
		SLUG_PATTERN_ATTRIBUTE
	} from '$lib/features/slug';
	import {
		getCurrentPathWithSearch,
		loadPendingInvitationHomePath,
		loadPortalAccess,
		loadSession,
		redirectToLoginWithNext,
		resolvePortalHomePath
	} from '$lib/features/auth-session.svelte';
	import { buildScopedPath } from '$lib/features/scoped-routing';
	import { toast } from 'svelte-sonner';

	type ResolvablePath = Pathname;

	let loading = $state(true);
	let busy = $state(false);
	let form = $state({
		organizationName: '',
		organizationSlug: '',
		classroomName: '',
		classroomSlug: ''
	});
	let organizationSlugManuallyEdited = $state(false);
	let classroomSlugManuallyEdited = $state(false);
	let organizationLogoFiles = $state<FileList | undefined>(undefined);

	const selectedOrganizationLogoFile = $derived(organizationLogoFiles?.item(0) ?? null);

	const updateOrganizationName = (event: Event) => {
		const name = (event.currentTarget as HTMLInputElement).value;
		form.organizationName = name;
		if (!organizationSlugManuallyEdited) {
			form.organizationSlug = createSlugCandidate(name, 'organization');
		}
	};

	const updateOrganizationSlug = (event: Event) => {
		organizationSlugManuallyEdited = true;
		form.organizationSlug = normalizeSlug((event.currentTarget as HTMLInputElement).value);
	};

	const updateClassroomName = (event: Event) => {
		const name = (event.currentTarget as HTMLInputElement).value;
		form.classroomName = name;
		if (!classroomSlugManuallyEdited) {
			form.classroomSlug = name.trim() ? createSlugCandidate(name, 'classroom') : '';
		}
	};

	const updateClassroomSlug = (event: Event) => {
		classroomSlugManuallyEdited = true;
		form.classroomSlug = normalizeSlug((event.currentTarget as HTMLInputElement).value);
	};

	const refresh = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return false;
		}

		const portalAccess = await loadPortalAccess();
		if (portalAccess.hasAdminPortalAccess) {
			const homePath = resolvePortalHomePath(portalAccess) ?? '/admin/dashboard';
			await goto(resolve(homePath));
			return false;
		}
		if (portalAccess.hasParticipantAccess || portalAccess.canUseParticipantBooking) {
			await goto(resolve('/participant/home'));
			return false;
		}
		const invitationHomePath = await loadPendingInvitationHomePath();
		if (invitationHomePath) {
			await goto(resolve(invitationHomePath as ResolvablePath));
			return false;
		}

		return true;
	};

	const submit = async (event: SubmitEvent) => {
		event.preventDefault();
		busy = true;
		try {
			let logo: string | undefined;
			const logoFile = organizationLogoFiles?.item(0) ?? null;
			if (logoFile) {
				const uploaded = await uploadOrganizationLogo(logoFile);
				if (!uploaded.ok || !uploaded.logoUrl) {
					toast.error(uploaded.message);
					return;
				}
				logo = uploaded.logoUrl;
			}

			const result = await createOrganizationWithInitialClassroom({
				organizationName: form.organizationName,
				organizationSlug: createSlugCandidate(
					form.organizationSlug || form.organizationName,
					'organization'
				),
				classroomName: form.classroomName,
				classroomSlug: form.classroomName.trim()
					? createSlugCandidate(form.classroomSlug || form.classroomName, 'classroom')
					: '',
				logo
			});
			if (!result.ok || !result.organization || !result.classroom) {
				toast.error(result.message);
				return;
			}

			writeLastAuthPortal('admin');
			emitAuthSessionUpdated();
			toast.success(result.message);

			await goto(
				resolve(
					buildScopedPath(
						{
							orgSlug: result.organization.slug,
							classroomSlug: result.classroom.slug
						},
						'/admin/dashboard'
					) as ResolvablePath
				),
				{ invalidateAll: true }
			);
		} finally {
			busy = false;
		}
	};

	onMount(() => {
		void (async () => {
			loading = true;
			try {
				await refresh();
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<Badge variant="outline">初回設定</Badge>
		<h1 class="text-3xl font-semibold text-foreground">最初の組織と教室を作成</h1>
		<p class="text-sm text-muted-foreground">
			管理画面を使い始めるために、まず組織を作成します。初期教室の設定は任意ですが、最初に決めておく運用を強く推奨します。
		</p>
	</header>

	<Card class="surface-panel border-border/80 shadow-lg">
		<CardHeader class="space-y-2">
			<h2 class="text-xl font-semibold text-foreground">初期セットアップ</h2>
			<CardDescription>
				組織作成は必須です。URL識別子は名前から自動で用意します。初期教室名を空欄にすると、組織名ベースの初期教室をあとから変更できます。
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if loading}
				<p class="text-sm text-muted-foreground">セッションと権限を確認しています…</p>
			{:else}
				<form class="space-y-4" onsubmit={submit}>
					<div class="grid gap-4 md:grid-cols-2">
						<div class="space-y-2">
							<Label for="onboarding-organization-name">組織名</Label>
							<Input
								id="onboarding-organization-name"
								name="onboarding_organization_name"
								type="text"
								value={form.organizationName}
								oninput={updateOrganizationName}
								required
								disabled={busy}
							/>
						</div>
						<div class="space-y-2">
							<details class="rounded-md border border-border/80 bg-card/80 px-3 py-2">
								<summary class="cursor-pointer text-sm font-medium text-foreground">
									組織のURL識別子を編集
								</summary>
								<div class="mt-3 space-y-2">
									<Label for="onboarding-organization-slug">組織のURL識別子</Label>
									<Input
										id="onboarding-organization-slug"
										name="onboarding_organization_slug"
										type="text"
										value={form.organizationSlug}
										oninput={updateOrganizationSlug}
										pattern={SLUG_PATTERN_ATTRIBUTE}
										title={SLUG_INPUT_HINT}
										autocomplete="off"
										disabled={busy}
									/>
									<p class="text-xs text-muted-foreground">{SLUG_INPUT_HINT}</p>
								</div>
							</details>
						</div>
					</div>

					<div class="grid gap-4 md:grid-cols-2">
						<div class="space-y-2">
							<Label for="onboarding-classroom-name">初期教室名</Label>
							<Input
								id="onboarding-classroom-name"
								name="onboarding_classroom_name"
								type="text"
								value={form.classroomName}
								oninput={updateClassroomName}
								disabled={busy}
							/>
						</div>
						<div class="space-y-2">
							<details class="rounded-md border border-border/80 bg-card/80 px-3 py-2">
								<summary class="cursor-pointer text-sm font-medium text-foreground">
									初期教室のURL識別子を編集
								</summary>
								<div class="mt-3 space-y-2">
									<Label for="onboarding-classroom-slug">初期教室のURL識別子</Label>
									<Input
										id="onboarding-classroom-slug"
										name="onboarding_classroom_slug"
										type="text"
										value={form.classroomSlug}
										oninput={updateClassroomSlug}
										pattern={SLUG_PATTERN_ATTRIBUTE}
										title={SLUG_INPUT_HINT}
										autocomplete="off"
										disabled={busy || !form.classroomName.trim()}
									/>
									<p class="text-xs text-muted-foreground">{SLUG_INPUT_HINT}</p>
								</div>
							</details>
						</div>
					</div>
					<p class="text-xs text-muted-foreground">
						推奨:
						初回教室もここで設定してください。未入力の場合は組織名ベースの初期教室が自動作成されます。
					</p>

					<div class="space-y-2">
						<Label for="onboarding-organization-logo">組織ロゴ (任意)</Label>
						<Input
							id="onboarding-organization-logo"
							name="onboarding_organization_logo"
							type="file"
							bind:files={organizationLogoFiles}
							disabled={busy}
						/>
						{#if selectedOrganizationLogoFile}
							<p class="text-xs text-muted-foreground">
								選択中: {selectedOrganizationLogoFile.name}
							</p>
						{/if}
					</div>

					<Button type="submit" disabled={busy}>組織と教室を作成</Button>
				</form>
			{/if}
		</CardContent>
	</Card>
</main>
