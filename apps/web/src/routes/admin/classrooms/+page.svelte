<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import {
		createClassroom,
		listClassroomsByOrgSlug,
		loadOrganizations,
		updateClassroom,
		type ClassroomContextPayload
	} from '$lib/features/organization-context.svelte';
	import {
		getCurrentPathWithSearch,
		loadPortalAccess,
		loadSession,
		redirectToLoginWithNext
	} from '$lib/features/auth-session.svelte';
	import { buildScopedPath } from '$lib/features/scoped-routing';
	import type { OrganizationPayload } from '$lib/rpc-client';
	import { toast } from 'svelte-sonner';

	type ResolvablePath = Pathname;

	let loading = $state(true);
	let busy = $state(false);
	let activeOrganization = $state<OrganizationPayload | null>(null);
	let activeClassroom = $state<ClassroomContextPayload | null>(null);
	let classrooms = $state<ClassroomContextPayload[]>([]);
	let canManageOrganization = $state(false);
	let createForm = $state({ name: '', slug: '' });
	let editDialogOpen = $state(false);
	let editTarget = $state<ClassroomContextPayload | null>(null);
	let editForm = $state({ name: '', slug: '' });

	const roleLabelMap = {
		manager: 'manager',
		staff: 'staff',
		participant: 'participant'
	} as const;

	const refresh = async () => {
		const { session } = await loadSession();
		if (!session) {
			redirectToLoginWithNext(getCurrentPathWithSearch());
			return;
		}

		const [{ activeOrganization: nextOrganization, activeClassroom: nextClassroom }, portalAccess] =
			await Promise.all([loadOrganizations(), loadPortalAccess()]);

		activeOrganization = nextOrganization;
		activeClassroom = nextClassroom;
		canManageOrganization = portalAccess.hasOrganizationAdminAccess;

		if (!nextOrganization?.slug) {
			classrooms = [];
			return;
		}

		classrooms = await listClassroomsByOrgSlug(nextOrganization.slug);
	};

	const submitCreateClassroom = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!activeOrganization?.slug || !canManageOrganization) {
			return;
		}

		busy = true;
		try {
			const result = await createClassroom(activeOrganization.slug, createForm);
			if (!result.ok) {
				toast.error(result.message);
				return;
			}

			toast.success(result.message);
			createForm = { name: '', slug: '' };
			await refresh();
		} finally {
			busy = false;
		}
	};

	const openEditDialog = (classroom: ClassroomContextPayload) => {
		editTarget = classroom;
		editForm = {
			name: classroom.name,
			slug: classroom.slug
		};
		editDialogOpen = true;
	};

	const submitUpdateClassroom = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!activeOrganization?.slug || !editTarget || !canManageOrganization) {
			return;
		}

		busy = true;
		try {
			const result = await updateClassroom(activeOrganization.slug, editTarget.slug, editForm);
			if (!result.ok || !result.classroom) {
				toast.error(result.message);
				return;
			}

			toast.success(result.message);
			editDialogOpen = false;

			if (activeClassroom?.slug === editTarget.slug) {
				await goto(
					resolve(
						buildScopedPath(
							{
								orgSlug: activeOrganization.slug,
								classroomSlug: result.classroom.slug
							},
							'/admin/classrooms'
						) as ResolvablePath
					),
					{ invalidateAll: true }
				);
				return;
			}

			await refresh();
		} finally {
			busy = false;
		}
	};

	const openClassroom = async (classroomSlug: string) => {
		if (!activeOrganization?.slug) {
			return;
		}
		await goto(
			resolve(
				buildScopedPath(
					{
						orgSlug: activeOrganization.slug,
						classroomSlug
					},
					'/admin/classrooms'
				) as ResolvablePath
			),
			{ invalidateAll: true }
		);
	};

	const openClassroomInvitations = async (classroomSlug: string) => {
		if (!activeOrganization?.slug) {
			return;
		}
		await goto(
			resolve(
				buildScopedPath(
					{
						orgSlug: activeOrganization.slug,
						classroomSlug
					},
					'/admin/invitations'
				) as ResolvablePath
			)
		);
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

<main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
	<header class="space-y-2">
		<h1 class="text-3xl font-semibold text-slate-900">教室管理</h1>
		<p class="text-sm text-slate-600">
			教室の作成、名称・slug の更新、教室ごとの管理導線への遷移を行います。
		</p>
	</header>

	{#if loading}
		<Card class="surface-panel border-slate-200/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">教室情報を読み込み中…</p>
			</CardContent>
		</Card>
	{:else if !activeOrganization}
		<Card class="surface-panel border-slate-200/80 shadow-lg">
			<CardContent class="py-6">
				<p class="text-sm text-muted-foreground">利用中の組織を選択してください。</p>
			</CardContent>
		</Card>
	{:else}
		<section class="grid gap-6 xl:grid-cols-[360px_1fr]">
			<Card class="surface-panel border-slate-200/80 shadow-lg">
				<CardHeader class="space-y-2">
					<h2 class="text-xl font-semibold text-slate-900">教室を作成</h2>
					<CardDescription>
						対象組織: <span class="font-medium text-slate-900">{activeOrganization.name}</span>
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if !canManageOrganization}
						<p class="text-sm text-muted-foreground">
							教室の作成と設定更新は owner / admin のみ実行できます。
						</p>
					{:else}
						<form class="space-y-4 rounded-lg border border-slate-200/80 bg-white/80 p-4" onsubmit={submitCreateClassroom}>
							<div class="space-y-2">
								<Label for="classroom-name">教室名</Label>
								<Input id="classroom-name" name="classroom_name" bind:value={createForm.name} maxlength={120} required />
							</div>
							<div class="space-y-2">
								<Label for="classroom-slug">slug</Label>
								<Input id="classroom-slug" name="classroom_slug" bind:value={createForm.slug} maxlength={120} required />
								<p class="text-xs text-slate-500">slug は scoped URL に使われます。</p>
							</div>
							<Button type="submit" disabled={busy}>教室を作成</Button>
						</form>
					{/if}
				</CardContent>
			</Card>

			<Card class="surface-panel border-slate-200/80 shadow-lg">
				<CardHeader class="space-y-2">
					<h2 class="text-xl font-semibold text-slate-900">教室一覧</h2>
					<CardDescription>現在アクセス可能な教室と、その管理導線です。</CardDescription>
				</CardHeader>
				<CardContent class="space-y-3">
					{#if classrooms.length === 0}
						<p class="text-sm text-muted-foreground">表示できる教室はまだありません。</p>
					{:else}
						<div class="space-y-3">
							{#each classrooms as classroom (classroom.id)}
								<div class="rounded-lg border border-slate-200/80 bg-white/80 p-4">
									<div class="flex flex-wrap items-start justify-between gap-3">
										<div class="space-y-2">
											<div class="flex flex-wrap items-center gap-2">
												<p class="text-base font-semibold text-slate-900">{classroom.name}</p>
												{#if classroom.slug === activeClassroom?.slug}
													<Badge variant="default">利用中</Badge>
												{/if}
												{#if classroom.role}
													<Badge variant="outline">{roleLabelMap[classroom.role]}</Badge>
												{/if}
											</div>
											<p class="text-xs text-slate-500">slug: {classroom.slug}</p>
										</div>
										<div class="flex flex-wrap gap-2">
											<Button type="button" variant="secondary" onclick={() => openClassroom(classroom.slug)}>
												この教室を開く
											</Button>
											<Button
												type="button"
												variant="outline"
												onclick={() => openClassroomInvitations(classroom.slug)}
											>
												招待管理
											</Button>
											<Button
												type="button"
												variant="outline"
												onclick={() => openEditDialog(classroom)}
												disabled={!canManageOrganization}
											>
												編集
											</Button>
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</CardContent>
			</Card>
		</section>
	{/if}
</main>

<Dialog bind:open={editDialogOpen}>
	<DialogContent aria-describedby="classroom-edit-description" class="sm:max-w-lg">
		<DialogHeader>
			<DialogTitle>教室を編集</DialogTitle>
			<DialogDescription id="classroom-edit-description">
				教室名と slug を更新します。slug を変更すると scoped URL も変わります。
			</DialogDescription>
		</DialogHeader>
		{#if editTarget}
			<form class="space-y-4" onsubmit={submitUpdateClassroom}>
				<div class="space-y-2">
					<Label for="edit-classroom-name">教室名</Label>
					<Input id="edit-classroom-name" name="edit_classroom_name" bind:value={editForm.name} maxlength={120} required />
				</div>
				<div class="space-y-2">
					<Label for="edit-classroom-slug">slug</Label>
					<Input id="edit-classroom-slug" name="edit_classroom_slug" bind:value={editForm.slug} maxlength={120} required />
				</div>
				<DialogFooter>
					<Button type="button" variant="ghost" onclick={() => (editDialogOpen = false)} disabled={busy}>
						閉じる
					</Button>
					<Button type="submit" disabled={busy}>保存</Button>
				</DialogFooter>
			</form>
		{/if}
	</DialogContent>
</Dialog>
