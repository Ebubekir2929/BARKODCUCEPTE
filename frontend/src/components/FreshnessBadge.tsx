// 2026-06 — Standart "cache tazeliği" rozeti.
// Ekstre / fiş detayı / rapor ekranlarında verinin ne kadar taze olduğunu gösterir.
// ageSec < 90 → yeşil "az önce" (canlı/prefetch sıcak), aksi halde mavi "X dk önce".
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export const fmtAge = (sec: number): string => {
  if (sec < 90) return 'az önce';
  if (sec < 3600) return `${Math.round(sec / 60)} dk önce`;
  if (sec < 86400) return `${Math.round(sec / 3600)} sa önce`;
  return `${Math.round(sec / 86400)} gün önce`;
};

interface Props {
  ageSec: number | null | undefined; // null/undefined → rozet gizlenir
  label?: string;                    // varsayılan: "Son güncelleme"
  compact?: boolean;                 // sadece "az önce" gibi kısa metin
}

export default function FreshnessBadge({ ageSec, label = 'Son güncelleme', compact = false }: Props) {
  if (ageSec == null || isNaN(ageSec as number)) return null;
  const fresh = (ageSec as number) < 90;
  const color = fresh ? '#10B981' : '#3B82F6';
  return (
    <View style={[styles.badge, { backgroundColor: color + '15' }]}>
      <Ionicons name={fresh ? 'flash' : 'time-outline'} size={10} color={color} />
      <Text style={[styles.text, { color }]}>
        {compact ? fmtAge(ageSec as number) : `${label}: ${fmtAge(ageSec as number)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  text: { fontSize: 10, fontWeight: '700' },
});
