/** @jsxImportSource react */
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export type TrialEndingReminderEmailProps = {
  organizationName: string;
  ownerName: string;
  trialEndsAtLabel: string;
  paymentMethodStatusLabel: string;
  contractsUrl: string;
  actionText: string;
  noteText: string;
};

const styles = {
  body: {
    backgroundColor: '#f5f6f8',
    fontFamily: 'Arial, "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif',
    margin: 0,
    padding: '24px 12px',
  },
  container: {
    backgroundColor: '#ffffff',
    borderRadius: '10px',
    border: '1px solid #e5e7eb',
    margin: '0 auto',
    maxWidth: '560px',
    padding: '28px 24px',
  },
  heading: {
    color: '#111827',
    fontSize: '24px',
    fontWeight: '700',
    lineHeight: '1.4',
    margin: '0 0 16px',
  },
  text: {
    color: '#1f2937',
    fontSize: '14px',
    lineHeight: '1.7',
    margin: '0 0 12px',
  },
  detailSection: {
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    margin: '8px 0 20px',
    padding: '12px 14px',
  },
  detailText: {
    color: '#111827',
    fontSize: '14px',
    lineHeight: '1.6',
    margin: '0 0 6px',
  },
  button: {
    backgroundColor: '#111827',
    borderRadius: '8px',
    color: '#ffffff',
    display: 'inline-block',
    fontSize: '14px',
    fontWeight: '700',
    padding: '12px 18px',
    textDecoration: 'none',
  },
  note: {
    color: '#92400e',
    fontSize: '13px',
    lineHeight: '1.7',
    margin: '16px 0 0',
  },
  hr: {
    borderColor: '#e5e7eb',
    margin: '22px 0 14px',
  },
  footer: {
    color: '#6b7280',
    fontSize: '12px',
    lineHeight: '1.5',
    margin: 0,
  },
} as const;

export const TrialEndingReminderEmail = ({
  organizationName,
  ownerName,
  trialEndsAtLabel,
  paymentMethodStatusLabel,
  contractsUrl,
  actionText,
  noteText,
}: TrialEndingReminderEmailProps) => {
  return (
    <Html lang="ja">
      <Head />
      <Preview>{organizationName} のプレミアムトライアル終了が近づいています</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading as="h2" style={styles.heading}>
            プレミアムトライアル終了前のお知らせ
          </Heading>
          <Text style={styles.text}>{ownerName} さん、{organizationName} の契約状況をご確認ください。</Text>
          <Text style={styles.text}>
            現在のプレミアムトライアルは <strong>{trialEndsAtLabel}</strong> に終了予定です。
          </Text>
          <Section style={styles.detailSection}>
            <Text style={styles.detailText}>
              <strong>現在の支払い方法登録状況:</strong> {paymentMethodStatusLabel}
            </Text>
            <Text style={styles.detailText}>
              <strong>必要な対応:</strong> {actionText}
            </Text>
          </Section>
          <Button href={contractsUrl} style={styles.button}>
            契約ページを開く
          </Button>
          <Text style={styles.note}>{noteText}</Text>
          <Hr style={styles.hr} />
          <Text style={styles.footer}>このメールは organization owner に送信されています。</Text>
        </Container>
      </Body>
    </Html>
  );
};
