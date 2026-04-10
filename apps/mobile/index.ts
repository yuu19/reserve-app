import { Platform } from 'react-native';
import { registerRootComponent } from 'expo';

import App from './App';
import { smartHrColors } from './src/lib/design-system';

const installWebFatalErrorOverlay = () => {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  const showError = (title: string, detail: string) => {
    const existing = document.getElementById('web-fatal-error-overlay');
    if (existing) {
      existing.textContent = `${title}\n${detail}`;
      return;
    }

    const element = document.createElement('pre');
    element.id = 'web-fatal-error-overlay';
    element.textContent = `${title}\n${detail}`;
    element.style.position = 'fixed';
    element.style.left = '12px';
    element.style.right = '12px';
    element.style.bottom = '12px';
    element.style.zIndex = '2147483647';
    element.style.padding = '12px';
    element.style.margin = '0';
    element.style.borderRadius = '6px';
    element.style.border = `1px solid ${smartHrColors.danger}`;
    element.style.background = '#fbecf1';
    element.style.color = smartHrColors.textBlack;
    element.style.font =
      '12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    element.style.whiteSpace = 'pre-wrap';
    element.style.maxHeight = '45vh';
    element.style.overflow = 'auto';

    document.body.appendChild(element);
  };

  const formatReason = (reason: unknown) => {
    if (reason instanceof Error) {
      return reason.stack ?? reason.message;
    }
    if (typeof reason === 'string') {
      return reason;
    }
    try {
      return JSON.stringify(reason);
    } catch {
      return String(reason);
    }
  };

  window.addEventListener('error', (event) => {
    showError('Web 起動エラー', formatReason(event.error ?? event.message));
  });

  window.addEventListener('unhandledrejection', (event) => {
    showError('Web 未処理エラー', formatReason(event.reason));
  });
};

if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-gesture-handler');
}

installWebFatalErrorOverlay();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
