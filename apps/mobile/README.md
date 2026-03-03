# Mobile (Expo + NativeWind + HeroUI Native)

## Setup

```bash
pnpm install
pnpm --filter @apps/mobile dev
```

`EXPO_PUBLIC_BACKEND_URL` 未設定時は `http://localhost:3000` を使用します。

## Included UI stack

- `nativewind` with `metro.config.js` + `global.css`
- `heroui-native` provider and Tailwind plugin

## Implemented features

- Email/Password サインイン・新規登録・サインアウト
- organization 作成 / 一覧 / active 切り替え
- 招待作成 (role 選択) / 招待一覧 / 承諾 / 取り消し

## Key files

- `App.tsx`: HeroUI Native provider + sample screen
- `tailwind.config.js`: NativeWind preset + HeroUI plugin
- `babel.config.js`: NativeWind JSX transform + Reanimated plugin
- `metro.config.js`: NativeWind Metro integration

## EAS Build (実機インストール)

### 追加済み設定

- `app.json`
  - `ios.bundleIdentifier`: `com.yusuke.betterauthorganizationdemo`
  - `android.package`: `com.yusuke.betterauthorganizationdemo`
  - `runtimeVersion` / `updates` を設定
- `eas.json`
  - `development` / `preview` / `production` プロファイルを作成
  - `EXPO_PUBLIC_BACKEND_URL` の profile 別設定を追加
- `.easignore`
  - EAS アップロード対象から不要ファイルを除外
- `package.json`
  - `eas build` / `eas submit` 用スクリプトを追加

### 初回セットアップ

```bash
pnpm dlx eas-cli login
pnpm --filter @apps/mobile exec eas init
```

### 実機インストール用ビルド

```bash
# iOS (内部配布)
pnpm --filter @apps/mobile eas:build:preview:ios

# Android (内部配布)
pnpm --filter @apps/mobile eas:build:preview:android
```

ビルド完了後、EAS の配布リンクまたは QR から実機にインストールできます。

### 注意点

- `eas.json` の `EXPO_PUBLIC_BACKEND_URL` は本番/検証環境の URL に更新してください。
  - Prod: `https://api.wakureserve.com`
  - Preview/Staging: `https://api.stg.wakureserve.com`
- `bundleIdentifier` / `package` は各自のアプリ識別子に変更してください。
