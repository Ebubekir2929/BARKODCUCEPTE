/**
 * POS istemcisi 15 dk'dan uzun süredir sunucuya bağlanmadıysa Raporlar ekranının üstünde
 * kırmızı uyarı şeridi. Dokununca Senkron Sağlığı ekranı açılır.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeStore } from '../../store/themeStore';
import { usePosDurum } from '../../hooks/usePosDurum';
import { fmtAge } from '../FreshnessBadge';

export const PosOfflineBanner: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const { colors } = useThemeStore();
  const durum = usePosDurum(tenantId);
  if (!durum || (durum.durum !== 'kritik' && durum.durum !== 'yok')) return null;

  const detay = durum.yas_sn == null
    ? 'POS istemcisi hiç bağlanmadı'
    : `Son bağlantı: ${fmtAge(durum.yas_sn)}`;

  return (
    <TouchableOpacity
      style={[styles.bar, { backgroundColor: colors.error }]}
      onPress={() => router.push('/senkron-saglik')}
      activeOpacity={0.85}
      testID="pos-offline-banner"
    >
      <Ionicons name="cloud-offline" size={20} color="#fff" />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>POS bağlantısı yok</Text>
        <Text style={styles.sub} numberOfLines={1}>{detay} · raporlar güncel veri alamaz</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#fff" />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, minHeight: 48 },
  title: { color: '#fff', fontSize: 13, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '500', marginTop: 1 },
});

export default PosOfflineBanner;
