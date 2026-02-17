import type { FC, ReactNode } from 'react';
import { Platform, View, type ViewStyle } from 'react-native';

type RootProps = {
  children: ReactNode;
  style?: ViewStyle;
};

type NativeGestureHandlerModule = typeof import('react-native-gesture-handler');

const nativeGestureModule: NativeGestureHandlerModule | null = (() => {
  if (Platform.OS === 'web') {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-gesture-handler') as NativeGestureHandlerModule;
})();

const WebGestureRootView: FC<RootProps> = ({ children, style }) => {
  return <View style={style}>{children}</View>;
};

export const GestureRootView = (nativeGestureModule?.GestureHandlerRootView ??
  WebGestureRootView) as FC<RootProps>;
