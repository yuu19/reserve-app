import { StatusBar } from 'expo-status-bar';
import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import './global.css';
import { authClient, backendBaseURL } from './src/lib/auth-client';
import { GestureRootView } from './src/lib/gesture-root';
import { smartHrHeroUITheme } from './src/lib/design-system';
import { Button, Card, HeroUINativeProvider, TextField, useTheme } from './src/lib/ui';
import {
  mobileApi,
  type AuthSessionPayload,
  type InvitationPayload,
  type JsonRecord,
  type OrganizationPayload,
  type OrganizationRole,
} from './src/lib/mobile-api';

type Mode = 'sign-in' | 'sign-up';
type BusyAction =
  | null
  | 'sign-in'
  | 'sign-in-google'
  | 'sign-up'
  | 'sign-out'
  | 'create-organization'
  | 'set-active-organization'
  | 'create-invitation'
  | 'accept-invitation'
  | 'cancel-invitation'
  | 'refresh';

const invitationRoleOptions: OrganizationRole[] = ['admin', 'member'];

const isRecord = (value: unknown): value is JsonRecord => {
  return typeof value === 'object' && value !== null;
};

const isOrganizationPayload = (value: unknown): value is OrganizationPayload => {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.slug === 'string'
  );
};

const isInvitationPayload = (value: unknown): value is InvitationPayload => {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.organizationId === 'string' &&
    typeof value.organizationSlug === 'string' &&
    typeof value.email === 'string' &&
    typeof value.subjectKind === 'string' &&
    typeof value.role === 'string' &&
    typeof value.status === 'string'
  );
};

const asSessionPayload = (value: unknown): AuthSessionPayload => {
  if (value === null) {
    return null;
  }

  if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.session)) {
    return null;
  }

  return {
    user: value.user,
    session: value.session,
  };
};

const asOrganizations = (value: unknown): OrganizationPayload[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isOrganizationPayload);
};

const asOrganization = (value: unknown): OrganizationPayload | null => {
  return isOrganizationPayload(value) ? value : null;
};

const asInvitations = (value: unknown): InvitationPayload[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isInvitationPayload);
};

const parseResponseBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const toErrorMessage = (payload: unknown, fallback: string): string => {
  if (isRecord(payload) && typeof payload.message === 'string') {
    return payload.message;
  }

  if (isRecord(payload) && typeof payload.error === 'string') {
    return payload.error;
  }

  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string') {
    return payload.error.message;
  }

  if (typeof payload === 'string' && payload.length > 0) {
    return payload;
  }

  return fallback;
};

const formatTimestamp = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('ja-JP');
};

type AppErrorBoundaryState = {
  error: Error | null;
};

class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = {
    error: null,
  };

  override componentDidCatch(error: Error, _info: ErrorInfo) {
    this.setState({ error });
  }

  override render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <SafeAreaView className="flex-1 bg-background">
        <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-4 pb-8">
          <Text className="text-base text-foreground">アプリの描画中にエラーが発生しました。</Text>
          <Text className="text-sm text-muted-foreground">{this.state.error.message}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }
}

const AppConsole = () => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [mode, setMode] = useState<Mode>('sign-in');
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingOrganizations, setLoadingOrganizations] = useState(false);
  const [loadingInvitations, setLoadingInvitations] = useState(false);

  const [session, setSession] = useState<AuthSessionPayload>(null);
  const [organizations, setOrganizations] = useState<OrganizationPayload[]>([]);
  const [activeOrganization, setActiveOrganization] = useState<OrganizationPayload | null>(null);
  const [organizationInvitations, setOrganizationInvitations] = useState<InvitationPayload[]>([]);
  const [userInvitations, setUserInvitations] = useState<InvitationPayload[]>([]);

  const [signInForm, setSignInForm] = useState({
    email: '',
    password: '',
  });
  const [signUpForm, setSignUpForm] = useState({
    name: '',
    email: '',
    password: '',
  });
  const [organizationForm, setOrganizationForm] = useState({
    name: '',
    slug: '',
  });
  const [invitationForm, setInvitationForm] = useState({
    email: '',
    role: 'member' as OrganizationRole,
  });

  const sessionLabel = session ? 'ログイン中' : '未ログイン';
  const activeOrganizationId =
    session && isRecord(session.session) && typeof session.session.activeOrganizationId === 'string'
      ? session.session.activeOrganizationId
      : null;
  const activeOrganizationLabel =
    activeOrganization?.name ?? activeOrganizationId ?? '選択されていません';
  const isBusy = busyAction !== null;

  const notifyError = (message: string) => {
    Alert.alert('エラー', message);
  };

  const notifySuccess = (message: string) => {
    Alert.alert('完了', message);
  };

  const resetOrganizationState = () => {
    setOrganizations([]);
    setActiveOrganization(null);
    setOrganizationInvitations([]);
    setUserInvitations([]);
  };

  const refreshSession = async (): Promise<AuthSessionPayload> => {
    setLoadingSession(true);
    try {
      const response = await mobileApi.getSession();
      const payload = await parseResponseBody(response);

      if (!response.ok) {
        setSession(null);
        return null;
      }

      const nextSession = asSessionPayload(payload);
      setSession(nextSession);
      return nextSession;
    } catch {
      setSession(null);
      notifyError('セッションの取得に失敗しました。');
      return null;
    } finally {
      setLoadingSession(false);
    }
  };

  const loadOrganizations = async (currentSession: AuthSessionPayload) => {
    if (!currentSession) {
      setOrganizations([]);
      setActiveOrganization(null);
      return null;
    }

    setLoadingOrganizations(true);
    try {
      const [listResponse, activeResponse] = await Promise.all([
        mobileApi.listOrganizations(),
        mobileApi.getFullOrganization(),
      ]);

      const [listPayload, activePayload] = await Promise.all([
        parseResponseBody(listResponse),
        parseResponseBody(activeResponse),
      ]);

      const nextOrganizations = listResponse.ok ? asOrganizations(listPayload) : [];
      const nextActiveOrganization = activeResponse.ok ? asOrganization(activePayload) : null;

      setOrganizations(nextOrganizations);
      setActiveOrganization(nextActiveOrganization);

      return nextActiveOrganization;
    } catch {
      setOrganizations([]);
      setActiveOrganization(null);
      notifyError('organization 情報の取得に失敗しました。');
      return null;
    } finally {
      setLoadingOrganizations(false);
    }
  };

  const loadInvitations = async (
    currentSession: AuthSessionPayload,
    activeOrgSlug?: string | null,
  ) => {
    if (!currentSession) {
      setOrganizationInvitations([]);
      setUserInvitations([]);
      return;
    }

    setLoadingInvitations(true);
    try {
      const [userInvitationResponse, organizationInvitationResponse] = await Promise.all([
        mobileApi.listUserInvitations(),
        activeOrgSlug ? mobileApi.listInvitations(activeOrgSlug) : Promise.resolve(null),
      ]);

      if (userInvitationResponse.ok) {
        const userInvitationPayload = await parseResponseBody(userInvitationResponse);
        setUserInvitations(
          asInvitations(userInvitationPayload).filter(
            (invitation) => invitation.subjectKind === 'org_operator',
          ),
        );
      } else {
        setUserInvitations([]);
      }

      if (organizationInvitationResponse && organizationInvitationResponse.ok) {
        const organizationInvitationPayload = await parseResponseBody(
          organizationInvitationResponse,
        );
        setOrganizationInvitations(
          asInvitations(organizationInvitationPayload).filter(
            (invitation) => invitation.subjectKind === 'org_operator',
          ),
        );
      } else {
        setOrganizationInvitations([]);
      }
    } catch {
      setOrganizationInvitations([]);
      setUserInvitations([]);
      notifyError('招待情報の取得に失敗しました。');
    } finally {
      setLoadingInvitations(false);
    }
  };

  const reloadContext = async () => {
    setBusyAction('refresh');
    const nextSession = await refreshSession();
    if (!nextSession) {
      resetOrganizationState();
      setBusyAction(null);
      return;
    }

    const nextActive = await loadOrganizations(nextSession);
    await loadInvitations(nextSession, nextActive?.slug);
    setBusyAction(null);
  };

  const submitSignIn = async () => {
    setBusyAction('sign-in');
    try {
      const result = await authClient.signIn.email({
        email: signInForm.email.trim(),
        password: signInForm.password,
      });
      if (result?.error) {
        notifyError(toErrorMessage(result, 'サインインに失敗しました。'));
        return;
      }

      await reloadContext();
      notifySuccess('サインインしました。');
    } catch {
      notifyError('サインイン中に通信エラーが発生しました。');
    } finally {
      setBusyAction(null);
    }
  };

  const submitSignInWithGoogle = async () => {
    setBusyAction('sign-in-google');
    try {
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL: '/auth/callback',
      });
      if (result?.error) {
        notifyError(toErrorMessage(result, 'Google サインインに失敗しました。'));
        return;
      }

      await reloadContext();
      notifySuccess('Google でサインインしました。');
    } catch {
      notifyError('Google サインイン中に通信エラーが発生しました。');
    } finally {
      setBusyAction(null);
    }
  };

  const submitSignUp = async () => {
    setBusyAction('sign-up');
    try {
      const result = await authClient.signUp.email({
        name: signUpForm.name.trim(),
        email: signUpForm.email.trim(),
        password: signUpForm.password,
      });
      if (result?.error) {
        notifyError(toErrorMessage(result, 'アカウント作成に失敗しました。'));
        return;
      }

      await reloadContext();
      notifySuccess('アカウントを作成しました。');
    } catch {
      notifyError('アカウント作成中に通信エラーが発生しました。');
    } finally {
      setBusyAction(null);
    }
  };

  const submitSignOut = async () => {
    setBusyAction('sign-out');
    try {
      const result = await authClient.signOut();
      if (result?.error) {
        notifyError(toErrorMessage(result, 'サインアウトに失敗しました。'));
        return;
      }

      setSession(null);
      resetOrganizationState();
      notifySuccess('サインアウトしました。');
    } catch {
      notifyError('サインアウト中に通信エラーが発生しました。');
    } finally {
      setBusyAction(null);
    }
  };

  const submitCreateOrganization = async () => {
    if (!session) {
      return;
    }

    setBusyAction('create-organization');
    try {
      const response = await mobileApi.createOrganization({
        name: organizationForm.name.trim(),
        slug: organizationForm.slug.trim(),
      });
      const payload = await parseResponseBody(response);

      if (!response.ok) {
        notifyError(toErrorMessage(payload, 'organization の作成に失敗しました。'));
        return;
      }

      setOrganizationForm({ name: '', slug: '' });

      const currentSession = await refreshSession();
      const nextActive = await loadOrganizations(currentSession);
      await loadInvitations(currentSession, nextActive?.slug);

      notifySuccess('organization を作成しました。');
    } catch {
      notifyError('organization 作成中に通信エラーが発生しました。');
    } finally {
      setBusyAction(null);
    }
  };

  const submitSetActiveOrganization = async (organizationId: string | null) => {
    if (!session) {
      return;
    }

    setBusyAction('set-active-organization');
    try {
      const response = await mobileApi.setActiveOrganization({ organizationId });
      const payload = await parseResponseBody(response);

      if (!response.ok) {
        notifyError(toErrorMessage(payload, 'active organization の更新に失敗しました。'));
        return;
      }

      const currentSession = await refreshSession();
      const nextActive = await loadOrganizations(currentSession);
      await loadInvitations(currentSession, nextActive?.slug);

      notifySuccess(
        organizationId ? 'active organization を切り替えました。' : 'active を解除しました。',
      );
    } catch {
      notifyError('active organization 更新中に通信エラーが発生しました。');
    } finally {
      setBusyAction(null);
    }
  };

  const submitCreateInvitation = async () => {
    if (!session || !activeOrganization?.slug) {
      notifyError('招待を作成するには active organization を選択してください。');
      return;
    }

    setBusyAction('create-invitation');
    try {
      const response = await mobileApi.createInvitation(activeOrganization.slug, {
        email: invitationForm.email.trim(),
        role: invitationForm.role,
      });
      const payload = await parseResponseBody(response);

      if (!response.ok) {
        notifyError(toErrorMessage(payload, '招待の作成に失敗しました。'));
        return;
      }

      setInvitationForm((prev) => ({ ...prev, email: '' }));
      await loadInvitations(session, activeOrganization.slug);
      notifySuccess('招待を作成しました。');
    } catch {
      notifyError('招待作成中に通信エラーが発生しました。');
    } finally {
      setBusyAction(null);
    }
  };

  const submitAcceptInvitation = async (invitationId: string) => {
    if (!session) {
      return;
    }

    setBusyAction('accept-invitation');
    try {
      const response = await mobileApi.acceptInvitation({ invitationId });
      const payload = await parseResponseBody(response);
      if (!response.ok) {
        notifyError(toErrorMessage(payload, '招待の承諾に失敗しました。'));
        return;
      }

      const currentSession = await refreshSession();
      const nextActive = await loadOrganizations(currentSession);
      await loadInvitations(currentSession, nextActive?.slug);
      notifySuccess('招待を承諾しました。');
    } catch {
      notifyError('招待承諾中に通信エラーが発生しました。');
    } finally {
      setBusyAction(null);
    }
  };

  const submitCancelInvitation = async (invitationId: string) => {
    if (!session) {
      return;
    }

    setBusyAction('cancel-invitation');
    try {
      const response = await mobileApi.cancelInvitation({ invitationId });
      const payload = await parseResponseBody(response);
      if (!response.ok) {
        notifyError(toErrorMessage(payload, '招待の取り消しに失敗しました。'));
        return;
      }

      await loadInvitations(session, activeOrganization?.slug);
      notifySuccess('招待を取り消しました。');
    } catch {
      notifyError('招待取り消し中に通信エラーが発生しました。');
    } finally {
      setBusyAction(null);
    }
  };

  useEffect(() => {
    void reloadContext();
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="gap-4 p-4 pb-8"
        keyboardShouldPersistTaps="handled"
      >
        <Card>
          <Card.Body className="gap-3">
            <View className="flex-row items-center justify-between gap-2">
              <Card.Title>Mobile 認証コンソール</Card.Title>
              <Text
                className={`rounded-full px-3 py-1 text-xs ${
                  session
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-default text-default-foreground'
                }`}
              >
                {sessionLabel}
              </Text>
            </View>
            <Card.Description>
              Better Auth (Expo) + organization + 招待フロー。{'\n'}
              API: {backendBaseURL}
            </Card.Description>
          </Card.Body>
          <Card.Footer className="flex-row gap-2">
            <Button variant="ghost" onPress={reloadContext} isDisabled={isBusy || loadingSession}>
              <Button.LabelContent>{loadingSession ? '更新中...' : '再取得'}</Button.LabelContent>
            </Button>
            {session ? (
              <Button variant="danger" onPress={submitSignOut} isDisabled={isBusy}>
                <Button.LabelContent>サインアウト</Button.LabelContent>
              </Button>
            ) : null}
          </Card.Footer>
        </Card>

        {!session ? (
          <Card>
            <Card.Body className="gap-4">
              <View className="flex-row gap-2">
                <Button
                  variant="secondary"
                  onPress={submitSignInWithGoogle}
                  className="flex-1"
                  isDisabled={isBusy}
                >
                  <Button.LabelContent>
                    {busyAction === 'sign-in-google' ? 'Google 認証中...' : 'Google ログイン'}
                  </Button.LabelContent>
                </Button>
              </View>
              <View className="flex-row gap-2">
                <Button
                  variant={mode === 'sign-in' ? 'primary' : 'secondary'}
                  onPress={() => setMode('sign-in')}
                  className="flex-1"
                  isDisabled={isBusy}
                >
                  <Button.LabelContent>サインイン</Button.LabelContent>
                </Button>
                <Button
                  variant={mode === 'sign-up' ? 'primary' : 'secondary'}
                  onPress={() => setMode('sign-up')}
                  className="flex-1"
                  isDisabled={isBusy}
                >
                  <Button.LabelContent>新規登録</Button.LabelContent>
                </Button>
              </View>

              {mode === 'sign-in' ? (
                <View className="gap-3">
                  <TextField isRequired>
                    <TextField.Label>メールアドレス</TextField.Label>
                    <TextField.Input
                      value={signInForm.email}
                      onChangeText={(email) => setSignInForm((prev) => ({ ...prev, email }))}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </TextField>
                  <TextField isRequired>
                    <TextField.Label>パスワード</TextField.Label>
                    <TextField.Input
                      value={signInForm.password}
                      onChangeText={(password) => setSignInForm((prev) => ({ ...prev, password }))}
                      secureTextEntry
                    />
                  </TextField>
                  <Button onPress={submitSignIn} isDisabled={isBusy}>
                    <Button.LabelContent>
                      {busyAction === 'sign-in' ? 'サインイン中...' : 'サインイン'}
                    </Button.LabelContent>
                  </Button>
                </View>
              ) : (
                <View className="gap-3">
                  <TextField isRequired>
                    <TextField.Label>ユーザー名</TextField.Label>
                    <TextField.Input
                      value={signUpForm.name}
                      onChangeText={(name) => setSignUpForm((prev) => ({ ...prev, name }))}
                      autoCapitalize="words"
                    />
                  </TextField>
                  <TextField isRequired>
                    <TextField.Label>メールアドレス</TextField.Label>
                    <TextField.Input
                      value={signUpForm.email}
                      onChangeText={(email) => setSignUpForm((prev) => ({ ...prev, email }))}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </TextField>
                  <TextField isRequired>
                    <TextField.Label>パスワード</TextField.Label>
                    <TextField.Input
                      value={signUpForm.password}
                      onChangeText={(password) => setSignUpForm((prev) => ({ ...prev, password }))}
                      secureTextEntry
                    />
                  </TextField>
                  <Button onPress={submitSignUp} isDisabled={isBusy}>
                    <Button.LabelContent>
                      {busyAction === 'sign-up' ? '作成中...' : 'アカウント作成'}
                    </Button.LabelContent>
                  </Button>
                </View>
              )}
            </Card.Body>
          </Card>
        ) : null}

        <Card>
          <Card.Body className="gap-3">
            <Card.Title>organization 管理</Card.Title>
            {!session ? (
              <Card.Description>サインインすると利用できます。</Card.Description>
            ) : (
              <>
                <View className="gap-3 rounded-lg border border-border p-3">
                  <Text className="text-sm text-muted-foreground">新しい organization</Text>
                  <TextField isRequired>
                    <TextField.Label>名前</TextField.Label>
                    <TextField.Input
                      value={organizationForm.name}
                      onChangeText={(name) => setOrganizationForm((prev) => ({ ...prev, name }))}
                    />
                  </TextField>
                  <TextField isRequired>
                    <TextField.Label>slug</TextField.Label>
                    <TextField.Input
                      value={organizationForm.slug}
                      onChangeText={(slug) => setOrganizationForm((prev) => ({ ...prev, slug }))}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </TextField>
                  <Button onPress={submitCreateOrganization} isDisabled={isBusy}>
                    <Button.LabelContent>
                      {busyAction === 'create-organization' ? '作成中...' : 'organization 作成'}
                    </Button.LabelContent>
                  </Button>
                </View>

                <View className="gap-2">
                  <Text className="text-sm text-muted-foreground">
                    ACTIVE: {activeOrganizationLabel}
                  </Text>
                  {loadingOrganizations ? (
                    <Text className="text-sm text-muted-foreground">organization を取得中...</Text>
                  ) : organizations.length === 0 ? (
                    <Text className="text-sm text-muted-foreground">
                      所属 organization はありません。
                    </Text>
                  ) : (
                    organizations.map((organization) => (
                      <View
                        key={organization.id}
                        className="gap-2 rounded-lg border border-border bg-surface p-3"
                      >
                        <View className="flex-row items-center justify-between">
                          <Text className="text-base text-surface-foreground">
                            {organization.name}
                          </Text>
                          <Text
                            className={`rounded-full px-2 py-1 text-xs ${
                              organization.id === activeOrganizationId
                                ? 'bg-accent text-accent-foreground'
                                : 'bg-default text-default-foreground'
                            }`}
                          >
                            {organization.id === activeOrganizationId ? 'active' : 'inactive'}
                          </Text>
                        </View>
                        <Text className="text-xs text-muted-foreground">
                          slug: {organization.slug}
                        </Text>
                        <Button
                          variant="secondary"
                          onPress={() => submitSetActiveOrganization(organization.id)}
                          isDisabled={isBusy || organization.id === activeOrganizationId}
                        >
                          <Button.LabelContent>active にする</Button.LabelContent>
                        </Button>
                      </View>
                    ))
                  )}

                  <Button
                    variant="ghost"
                    onPress={() => submitSetActiveOrganization(null)}
                    isDisabled={isBusy || !activeOrganizationId}
                  >
                    <Button.LabelContent>active を解除</Button.LabelContent>
                  </Button>
                </View>
              </>
            )}
          </Card.Body>
        </Card>

        <Card>
          <Card.Body className="gap-3">
            <Card.Title>招待管理</Card.Title>
            {!session ? (
              <Card.Description>サインインすると利用できます。</Card.Description>
            ) : (
              <>
                <Text className="text-sm text-muted-foreground">
                  ACTIVE ORGANIZATION: {activeOrganizationLabel}
                </Text>

                {activeOrganization ? (
                  <View className="gap-3 rounded-lg border border-border p-3">
                    <Text className="text-sm text-muted-foreground">メンバー招待</Text>
                    <TextField isRequired>
                      <TextField.Label>メールアドレス</TextField.Label>
                      <TextField.Input
                        value={invitationForm.email}
                        onChangeText={(email) => setInvitationForm((prev) => ({ ...prev, email }))}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </TextField>

                    <View className="gap-2">
                      <Text className="text-xs text-muted-foreground">ロール選択</Text>
                      <View className="flex-row gap-2">
                        {invitationRoleOptions.map((role) => (
                          <Button
                            key={role}
                            variant={invitationForm.role === role ? 'primary' : 'secondary'}
                            onPress={() => setInvitationForm((prev) => ({ ...prev, role }))}
                            className="flex-1"
                            isDisabled={isBusy}
                          >
                            <Button.LabelContent>{role}</Button.LabelContent>
                          </Button>
                        ))}
                      </View>
                    </View>

                    <Button onPress={submitCreateInvitation} isDisabled={isBusy}>
                      <Button.LabelContent>
                        {busyAction === 'create-invitation' ? '招待作成中...' : '招待を作成'}
                      </Button.LabelContent>
                    </Button>
                  </View>
                ) : (
                  <Text className="text-sm text-muted-foreground">
                    招待には active organization の選択が必要です。
                  </Text>
                )}

                <View className="gap-2">
                  <Text className="text-sm text-muted-foreground">送信済み招待</Text>
                  {loadingInvitations ? (
                    <Text className="text-sm text-muted-foreground">招待を取得中...</Text>
                  ) : organizationInvitations.length === 0 ? (
                    <Text className="text-sm text-muted-foreground">
                      送信済み招待はありません。
                    </Text>
                  ) : (
                    organizationInvitations.map((invitation) => (
                      <View
                        key={invitation.id}
                        className="gap-2 rounded-lg border border-border bg-surface p-3"
                      >
                        <Text className="text-sm text-surface-foreground">{invitation.email}</Text>
                        <Text className="text-xs text-muted-foreground">
                          role: {invitation.role} / status: {invitation.status}
                        </Text>
                        <Text className="text-xs text-muted-foreground">
                          expires: {formatTimestamp(invitation.expiresAt)}
                        </Text>
                        <Button
                          variant="danger"
                          onPress={() => submitCancelInvitation(invitation.id)}
                          isDisabled={isBusy || invitation.status !== 'pending'}
                        >
                          <Button.LabelContent>取り消し</Button.LabelContent>
                        </Button>
                      </View>
                    ))
                  )}
                </View>

                <View className="gap-2">
                  <Text className="text-sm text-muted-foreground">受信した招待</Text>
                  {loadingInvitations ? (
                    <Text className="text-sm text-muted-foreground">招待を取得中...</Text>
                  ) : userInvitations.length === 0 ? (
                    <Text className="text-sm text-muted-foreground">
                      受信した招待はありません。
                    </Text>
                  ) : (
                    userInvitations.map((invitation) => (
                      <View
                        key={invitation.id}
                        className="gap-2 rounded-lg border border-border bg-surface p-3"
                      >
                        <Text className="text-sm text-surface-foreground">
                          {invitation.organizationName ?? invitation.organizationId}
                        </Text>
                        <Text className="text-xs text-muted-foreground">
                          role: {invitation.role} / status: {invitation.status}
                        </Text>
                        <Button
                          variant="secondary"
                          onPress={() => submitAcceptInvitation(invitation.id)}
                          isDisabled={isBusy || invitation.status !== 'pending'}
                        >
                          <Button.LabelContent>承諾</Button.LabelContent>
                        </Button>
                      </View>
                    ))
                  )}
                </View>
              </>
            )}
          </Card.Body>
        </Card>
      </ScrollView>

      <StatusBar style={isDark ? 'light' : 'dark'} />
    </SafeAreaView>
  );
};

export default function App() {
  return (
    <GestureRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <HeroUINativeProvider config={{ colorScheme: 'system', theme: smartHrHeroUITheme }}>
          <AppErrorBoundary>
            <AppConsole />
          </AppErrorBoundary>
        </HeroUINativeProvider>
      </SafeAreaProvider>
    </GestureRootView>
  );
}
