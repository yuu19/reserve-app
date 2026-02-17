import {
  forwardRef,
  type FC,
  type ForwardRefExoticComponent,
  type ReactNode,
  type RefAttributes,
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
      {children}
    </Pressable>
  );
}) as WebButtonType;

WebButton.LabelContent = ({ children }: ButtonLabelProps) => {
  return <Text style={styles.buttonLabel}>{children}</Text>;
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
export const HeroUINativeProvider = (nativeUI?.HeroUINativeProvider ??
  WebHeroUINativeProvider) as NativeUIModule['HeroUINativeProvider'] | FC<ProviderProps>;
export const TextField = (nativeUI?.TextField ?? WebTextField) as
  | NativeUIModule['TextField']
  | WebTextFieldType;
export const useTheme = (nativeUI?.useTheme ?? useWebTheme) as
  | NativeUIModule['useTheme']
  | (() => Theme);

const styles = StyleSheet.create({
  card: {
    borderColor: '#d4d4d8',
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  cardBody: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  cardFooter: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 4,
    gap: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  cardDescription: {
    fontSize: 13,
    color: '#374151',
  },
  button: {
    borderRadius: 10,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  buttonPrimary: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  buttonSecondary: {
    backgroundColor: '#ffffff',
    borderColor: '#d1d5db',
  },
  buttonDanger: {
    backgroundColor: '#dc2626',
    borderColor: '#dc2626',
  },
  buttonGhost: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
  },
  buttonLabel: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '600',
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    color: '#374151',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    minHeight: 40,
    paddingHorizontal: 10,
    color: '#111827',
    backgroundColor: '#ffffff',
  },
});
