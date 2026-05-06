// 2026-05-06 — Web sürümü bu projede devre dışı bırakıldı.
// Web platformu ayrı bir projede yazılacak. Bu proje sadece native mobil
// (iOS / Android) için geçerli. Kullanıcı web tarayıcıdan girdiğinde temiz
// bir "Mobil Uygulama" landing sayfası görür — kırılan UI, yanlış grafikler,
// uyumsuz responsive davranışlar görüntülenmez.
import React from 'react';
import { View, Text, StyleSheet, Linking, TouchableOpacity, ScrollView } from 'react-native';

const COLOR_PRIMARY = '#2563EB';
const COLOR_BG = '#0B1220';
const COLOR_CARD = '#0F172A';
const COLOR_TEXT = '#F8FAFC';
const COLOR_MUTED = '#94A3B8';
const COLOR_ACCENT = '#22C55E';

export default function WebDisabledScreen() {
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Text style={styles.iconText}>📱</Text>
          </View>

          <Text style={styles.brand}>Barkodcu Cepte</Text>
          <Text style={styles.tagline}>POS Yönetimi · Mobil Uygulama</Text>

          <View style={styles.divider} />

          <Text style={styles.heading}>Bu uygulama sadece mobil cihazlar için</Text>
          <Text style={styles.body}>
            Barkodcu Cepte iOS ve Android cihazlarınızda çalışacak şekilde tasarlandı.
            Web sürümü ayrı bir adreste yakında kullanıma sunulacaktır.
          </Text>

          <View style={styles.storeRow}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.storeBtn, { backgroundColor: '#000' }]}
              onPress={() => Linking.openURL('https://apps.apple.com/').catch(() => {})}
            >
              <Text style={styles.storeBtnText}>App Store</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.storeBtn, { backgroundColor: COLOR_ACCENT }]}
              onPress={() => Linking.openURL('https://play.google.com/store').catch(() => {})}
            >
              <Text style={styles.storeBtnText}>Google Play</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          <Text style={styles.footerText}>
            Telefonunuzdan açtığınızda otomatik olarak mobil uygulamayı görürsünüz.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLOR_BG,
    minHeight: '100%' as any,
  },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    paddingVertical: 64,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: COLOR_CARD,
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    shadowColor: COLOR_PRIMARY,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: COLOR_PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconText: {
    fontSize: 56,
  },
  brand: {
    fontSize: 26,
    fontWeight: '900',
    color: COLOR_TEXT,
    letterSpacing: -0.4,
  },
  tagline: {
    fontSize: 13,
    color: COLOR_MUTED,
    fontWeight: '600',
    marginTop: 4,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: '#1E293B',
    marginVertical: 24,
  },
  heading: {
    fontSize: 18,
    fontWeight: '800',
    color: COLOR_TEXT,
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: COLOR_MUTED,
    textAlign: 'center',
    lineHeight: 22,
  },
  storeRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  storeBtn: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 12,
  },
  storeBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  footerText: {
    fontSize: 12,
    color: COLOR_MUTED,
    textAlign: 'center',
  },
});
