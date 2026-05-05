/**
 * AuthShell — wraps `(auth)` screens (login / register / forgot-password)
 * in a polished two-column desktop layout when rendered on the web at
 * widths ≥ 768px. On mobile and narrow web, children render as-is so the
 * existing mobile layout is preserved.
 *
 * Left column = brand panel (gradient + logo + tagline + feature bullets).
 * Right column = form (full height, scrollable, max width capped).
 */
import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';

interface Props {
  children: React.ReactNode;
  /** Optional title for the brand panel (defaults to "Barkodcu Cepte"). */
  brandTitle?: string;
  /** Optional headline below the logo (defaults to a Turkish tagline). */
  headline?: string;
  /** Optional sub-tagline. */
  tagline?: string;
}

const FEATURE_BULLETS = [
  { icon: 'analytics-outline' as const, text: 'Anlık satış takibi & uyarılar' },
  { icon: 'cube-outline' as const, text: 'Stok ve fiyat yönetimi' },
  { icon: 'people-outline' as const, text: 'Cari hesap ve ekstreler' },
  { icon: 'document-text-outline' as const, text: 'Detaylı raporlar' },
  { icon: 'notifications-outline' as const, text: 'Push bildirimleri' },
];

export const AuthShell: React.FC<Props> = ({
  children,
  brandTitle = 'Barkodcu Cepte',
  headline = 'POS yönetimini cebinizde, masanızda',
  tagline = 'Şubelerinizi tek panelden izleyin, yüksek satış ve iptal anlık bildirim alın.',
}) => {
  const { colors } = useThemeStore();
  const { width } = useWindowDimensions();
  // Two-column shell only for web ≥ 768px — keeps mobile/native untouched.
  const useTwoCol = Platform.OS === 'web' && width >= 768;

  if (!useTwoCol) {
    return <>{children}</>;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* LEFT — brand panel (only on desktop ≥ 1024 to keep tablet form-focused) */}
      {width >= 1024 && (
        <View style={[styles.brandPanel, { backgroundColor: colors.primary }]}>
          {/* Soft gradient overlay using stacked semi-transparent layers */}
          <View style={[styles.brandOverlay, { backgroundColor: colors.primary }]} />
          <View style={[styles.brandOverlay, {
            backgroundColor: 'rgba(255,255,255,0.08)',
            top: -200,
            right: -100,
            width: 500,
            height: 500,
            borderRadius: 250,
          }]} />
          <View style={[styles.brandOverlay, {
            backgroundColor: 'rgba(0,0,0,0.12)',
            bottom: -150,
            left: -80,
            width: 400,
            height: 400,
            borderRadius: 200,
          }]} />

          <View style={styles.brandContent}>
            {/* Logo block */}
            <View style={styles.logoRow}>
              <View style={styles.logoBox}>
                <Ionicons name="bar-chart" size={26} color="#fff" />
              </View>
              <Text style={styles.brandTitle}>{brandTitle}</Text>
            </View>

            {/* Headline */}
            <Text style={styles.headline}>{headline}</Text>
            <Text style={styles.tagline}>{tagline}</Text>

            {/* Feature bullets */}
            <View style={styles.bullets}>
              {FEATURE_BULLETS.map((b) => (
                <View key={b.text} style={styles.bulletRow}>
                  <View style={styles.bulletIcon}>
                    <Ionicons name={b.icon} size={18} color="#fff" />
                  </View>
                  <Text style={styles.bulletText}>{b.text}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.copyright}>© 2026 Barkodcu Cepte · Tüm Hakları Saklıdır</Text>
          </View>
        </View>
      )}

      {/* RIGHT — form column (children rendered inside) */}
      <View style={[styles.formPanel, { backgroundColor: colors.background }]}>
        <View style={styles.formInner}>{children}</View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', height: '100%' as any },
  brandPanel: {
    width: '45%',
    maxWidth: 600,
    overflow: 'hidden',
    position: 'relative',
  },
  brandOverlay: {
    ...StyleSheet.absoluteFillObject,
  } as any,
  brandContent: {
    flex: 1,
    padding: 56,
    justifyContent: 'center',
    zIndex: 2,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 56,
  },
  logoBox: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },
  headline: {
    fontSize: 36,
    fontWeight: '900',
    color: '#fff',
    lineHeight: 44,
    marginBottom: 16,
  },
  tagline: {
    fontSize: 16,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 24,
    marginBottom: 40,
  },
  bullets: { gap: 14 },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bulletIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#fff',
  },
  copyright: {
    marginTop: 56,
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
  },
  formPanel: {
    flex: 1,
    minWidth: 0,
  },
  formInner: {
    flex: 1,
    height: '100%' as any,
  },
});

export default AuthShell;
