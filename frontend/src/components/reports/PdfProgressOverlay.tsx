/**
 * PDF üretim ilerleme overlay'i (on binlerce satırda uygulamanın donmadığını gösterir).
 */
import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useThemeStore } from '../../store/themeStore';

export interface PdfProgress { done: number; total: number }

export const PdfProgressOverlay: React.FC<{ progress: PdfProgress | null }> = ({ progress }) => {
  const { colors } = useThemeStore();
  if (!progress) return null;
  const pct = Math.min(100, Math.round((progress.done / Math.max(1, progress.total)) * 100));
  return (
    <View pointerEvents="auto" style={styles.overlay}>
      <View style={[styles.box, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ marginTop: 14, fontSize: 14, fontWeight: '700', color: colors.text }}>PDF Hazırlanıyor…</Text>
        <Text style={{ marginTop: 4, fontSize: 12, color: colors.textSecondary }}>
          {progress.done.toLocaleString('tr-TR')} / {progress.total.toLocaleString('tr-TR')} satır
        </Text>
        <View style={[styles.track, { backgroundColor: colors.border }]}>
          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: colors.primary }} />
        </View>
        <Text style={{ marginTop: 8, fontSize: 11, color: colors.textSecondary }}>Lütfen bekleyin, uygulamayı kapatmayın.</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
  box: { borderRadius: 16, padding: 22, minWidth: 260, alignItems: 'center', borderWidth: 1 },
  track: { marginTop: 10, width: 220, height: 6, borderRadius: 3, overflow: 'hidden' },
});

export default PdfProgressOverlay;
