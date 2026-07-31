/**
 * Skeleton.tsx — İskelet yükleme görünümü (shimmer/pulse) — 2026-08
 * İlk veri çekiminde spinner yerine, gelecek listenin gri parlayan
 * satır şablonlarını gösterir. Animated (native driver) ile hafiftir.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, Text, StyleSheet } from 'react-native';
import { useThemeStore } from '../store/themeStore';

export function SkeletonBlock({
  width = '100%',
  height = 12,
  radius = 6,
  style,
}: {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: any;
}) {
  const { colors } = useThemeStore();
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.border, opacity: pulse },
        style,
      ]}
    />
  );
}

/** Liste satırı şablonları — ekstre/fiş detayı/rapor sonuçları için */
export function SkeletonRows({ count = 8, note }: { count?: number; note?: string }) {
  const { colors } = useThemeStore();
  return (
    <View style={{ padding: 12, gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ flex: 1, gap: 7 }}>
            <SkeletonBlock width={i % 2 === 0 ? '72%' : '58%'} height={13} />
            <SkeletonBlock width={i % 3 === 0 ? '44%' : '36%'} height={10} />
          </View>
          <View style={{ alignItems: 'flex-end', gap: 7 }}>
            <SkeletonBlock width={64} height={13} />
            <SkeletonBlock width={40} height={10} />
          </View>
        </View>
      ))}
      {note ? (
        <View style={{ alignItems: 'center', paddingTop: 4 }}>
          <SkeletonNote note={note} />
        </View>
      ) : null}
    </View>
  );
}

function SkeletonNote({ note }: { note: string }) {
  const { colors } = useThemeStore();
  return (
    <Text style={{ fontSize: 11, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 24 }}>
      {note}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
  },
});
