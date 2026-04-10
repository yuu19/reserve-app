import {
  createContext,
  forwardRef,
  type FC,
  type ForwardRefExoticComponent,
  type ReactNode,
  type RefAttributes,
  useContext,
} from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { smartHrColors, smartHrFontStack } from './design-system';

type Theme = {
  theme: 'light' | 'dark';
};

type ProviderProps = {
  children: ReactNode;
  config?: unknown;
};

type ButtonProps = {
  children?: ReactNode;
  onPress?: () => void;
  isDisabled?: boolean;
  variant?: string;
  className?: string;
};

type ButtonLabelProps = {
  children?: ReactNode;
};

type CardProps = {
  children?: ReactNode;
  className?: string;
};

type TextFieldProps = {
  children?: ReactNode;
  isRequired?: boolean;
  className?: string;
};

type TextFieldLabelProps = {
  children?: ReactNode;
  className?: string;
};

type TextFieldInputProps = TextInputProps & {
  className?: string;
};

type WebButtonType = FC<ButtonProps> & {
  LabelContent: FC<ButtonLabelProps>;
};

type WebCardType = FC<CardProps> & {
  Body: FC<CardProps>;
  Footer: FC<CardProps>;
  Title: FC<CardProps>;
  Description: FC<CardProps>;
};

type WebTextFieldType = FC<TextFieldProps> & {
  Label: FC<TextFieldLabelProps>;
  Input: ForwardRefExoticComponent<TextFieldInputProps & RefAttributes<TextInput>>;
};

type NativeUIModule = typeof import('heroui-native');

const WebButtonVariantContext = createContext<string>('primary');

const WebHeroUINativeProvider: FC<ProviderProps> = ({ children }) => {
  return <>{children}</>;
};

const WebButton = (({ children, onPress, isDisabled, variant }: ButtonProps) => {
  const variantStyle =
    variant === 'danger'
      ? styles.buttonDanger
      : variant === 'secondary'
        ? styles.buttonSecondary
        : variant === 'ghost'
          ? styles.buttonGhost
          : styles.buttonPrimary;

  return (
    <Pressable onPress={onPress} disabled={isDisabled} style={[styles.button, variantStyle]}>
      <WebButtonVariantContext.Provider value={variant ?? 'primary'}>
        {children}
      </WebButtonVariantContext.Provider>
    </Pressable>
  );
}) as WebButtonType;

WebButton.LabelContent = ({ children }: ButtonLabelProps) => {
  const variant = useContext(WebButtonVariantContext);
  const variantStyle =
    variant === 'danger'
      ? styles.buttonLabelOnColor
      : variant === 'secondary'
        ? styles.buttonLabelSecondary
        : variant === 'ghost'
          ? styles.buttonLabelGhost
          : styles.buttonLabelOnColor;

  return <Text style={[styles.buttonLabel, variantStyle]}>{children}</Text>;
};

const WebCard = (({ children }: CardProps) => {
  return <View style={styles.card}>{children}</View>;
}) as WebCardType;

WebCard.Body = ({ children }: CardProps) => <View style={styles.cardBody}>{children}</View>;
WebCard.Footer = ({ children }: CardProps) => <View style={styles.cardFooter}>{children}</View>;
WebCard.Title = ({ children }: CardProps) => <Text style={styles.cardTitle}>{children}</Text>;
WebCard.Description = ({ children }: CardProps) => (
  <Text style={styles.cardDescription}>{children}</Text>
);

const WebTextField = (({ children }: TextFieldProps) => {
  return <View style={styles.field}>{children}</View>;
}) as WebTextFieldType;

WebTextField.Label = ({ children }: TextFieldLabelProps) => (
  <Text style={styles.fieldLabel}>{children}</Text>
);

WebTextField.Input = forwardRef<TextInput, TextFieldInputProps>((props, ref) => {
  const { className: _className, style, ...rest } = props;
  return <TextInput ref={ref} style={[styles.input, style]} {...rest} />;
});

const useWebTheme = (): Theme => ({ theme: 'light' });

const nativeUI: NativeUIModule | null = (() => {
  if (Platform.OS === 'web') {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('heroui-native') as NativeUIModule;
})();

export const Button = (nativeUI?.Button ?? WebButton) as NativeUIModule['Button'] | WebButtonType;
export const Card = (nativeUI?.Card ?? WebCard) as NativeUIModule['Card'] | WebCardType;
export const HeroUINativeProvider = (nativeUI?.HeroUINativeProvider ?? WebHeroUINativeProvider) as
  | NativeUIModule['HeroUINativeProvider']
  | FC<ProviderProps>;
export const TextField = (nativeUI?.TextField ?? WebTextField) as
  | NativeUIModule['TextField']
  | WebTextFieldType;
export const useTheme = (nativeUI?.useTheme ?? useWebTheme) as
  | NativeUIModule['useTheme']
  | (() => Theme);

const styles = StyleSheet.create({
  card: {
    borderColor: smartHrColors.border,
    borderWidth: 1,
    borderRadius: 6,
    backgroundColor: smartHrColors.white,
  },
  cardBody: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 8,
  },
  cardFooter: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 4,
    gap: 8,
  },
  cardTitle: {
    fontFamily: smartHrFontStack,
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 29,
    color: smartHrColors.textBlack,
  },
  cardDescription: {
    fontFamily: smartHrFontStack,
    fontSize: 14,
    lineHeight: 21,
    color: smartHrColors.textGrey,
  },
  button: {
    borderRadius: 6,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  buttonPrimary: {
    backgroundColor: smartHrColors.primary,
    borderColor: smartHrColors.primary,
  },
  buttonSecondary: {
    backgroundColor: smartHrColors.white,
    borderColor: smartHrColors.primary,
  },
  buttonDanger: {
    backgroundColor: smartHrColors.danger,
    borderColor: smartHrColors.danger,
  },
  buttonGhost: {
    backgroundColor: smartHrColors.white,
    borderColor: smartHrColors.border,
  },
  buttonLabel: {
    fontFamily: smartHrFontStack,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
  },
  buttonLabelOnColor: {
    color: smartHrColors.white,
  },
  buttonLabelSecondary: {
    color: smartHrColors.primary,
  },
  buttonLabelGhost: {
    color: smartHrColors.textBlack,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily: smartHrFontStack,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
    color: smartHrColors.textBlack,
  },
  input: {
    borderWidth: 1,
    borderColor: smartHrColors.border,
    borderRadius: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    fontFamily: smartHrFontStack,
    fontSize: 16,
    lineHeight: 24,
    color: smartHrColors.textBlack,
    backgroundColor: smartHrColors.white,
  },
});
