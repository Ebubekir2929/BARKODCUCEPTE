// 2026-08 — Premium kamera izni kartı (iOS Modal YASAK — absolute overlay kullanılır)
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';

interface Props {
  visible: boolean;
  onClose: () => void;
  onGranted: () => void;
  requestPermission: () => Promise<any>;
  canAskAgain: boolean;
}

export default function KameraIzinKarti({ visible, onClose, onGranted, requestPermission, canAskAgain }: Props) {
  const { colors } = useThemeStore();
  const [ayarModu, setAyarModu] = useState(false);
  if (!visible) return null;
  const ayarGerek = ayarModu || !canAskAgain;

  const izinIste = async () => {
    try {
      const r = await requestPermission();
      if (r?.granted) {
        setAyarModu(false);
        onGranted();
      } else if (r && r.canAskAgain === false) {
        setAyarModu(true);
      } else {
        onClose();
      }
    } catch {
      onClose();
    }
  };

  return (
    <View style={styles.scrim} pointerEvents="auto">
      <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose} />
      <View style={[styles.kart, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.ikonHalka, { backgroundColor: colors.primary + '14' }]}>
          <View style={[styles.ikonIc, { backgroundColor: colors.primary + '26' }]}>
            <Ionicons name="camera" size={30} color={colors.primary} />
          </View>
        </View>
        <Text style={[styles.baslik, { color: colors.text }]}>
          {ayarGerek ? 'İzin Ayarlardan Açılmalı' : 'Kamera İzni'}
        </Text>
        <Text style={[styles.aciklama, { color: colors.textSecondary }]}>
          {ayarGerek
            ? 'Kamera izni daha önce reddedilmiş. Barkod taramak için ayarlardan izni açmanız gerekiyor.'
            : 'Ürün barkodunu okutup fiyat ve stok bilgisini anında görmek için kameranıza erişmemiz gerekiyor.'}
        </Text>
        {ayarGerek ? (
          <TouchableOpacity
            style={[styles.anaBtn, { backgroundColor: colors.primary }]}
            onPress={() => { onClose(); Linking.openSettings(); }}
            activeOpacity={0.85}
          >
            <Ionicons name="settings-outline" size={18} color="#fff" />
            <Text style={styles.anaBtnText}>Ayarları Aç</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.anaBtn, { backgroundColor: colors.primary }]}
            onPress={izinIste}
            activeOpacity={0.85}
          >
            <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
            <Text style={styles.anaBtnText}>İzin Ver</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.vazgecBtn} onPress={onClose} hitSlop={8}>
          <Text style={[styles.vazgecText, { color: colors.textSecondary }]}>Şimdi Değil</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2,6,23,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    elevation: 20,
    padding: 24,
  },
  kart: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 18,
    alignItems: 'center',
    ...Platform.select({
      web: { boxShadow: '0 20px 50px rgba(0,0,0,0.45)' },
      default: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
    }),
  },
  ikonHalka: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  ikonIc: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  baslik: { fontSize: 19, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  aciklama: { fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginBottom: 20 },
  anaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    alignSelf: 'stretch', paddingVertical: 14, borderRadius: 14,
  },
  anaBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  vazgecBtn: { paddingVertical: 12, marginTop: 4 },
  vazgecText: { fontSize: 14, fontWeight: '600' },
});
