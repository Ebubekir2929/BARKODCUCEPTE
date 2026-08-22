/**
 * Son 6 Ay Satış Trendi — ay bazında çubuk grafiği (2026-08).
 * GET /api/data/aylik-trend verisini çeker; 5 dk modül-içi cache.
 * Tüm aylar 0 ise bölüm gizlenir. Devam eden ay (bu ay) kesikli vurgulanır.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';

interface AyVerisi {
  ay: string;       // YYYY-MM
  toplam: number;
  devam_ediyor: boolean;
}

interface Props {
  tenantId: string | null;
  colors: any;
  style?: StyleProp<ViewStyle>;
}

const AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const ayKisa = (ym: string) => AY_KISA[parseInt(ym.slice(5, 7), 10) - 1] || ym;

const fmtShort = (v: number) => {
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`;
  return v.toFixed(0);
};

const _cache = new Map<string, { t: number; data: AyVerisi[] }>();
const CACHE_MS = 5 * 60 * 1000;

export function MonthlyTrendChart({ tenantId, colors, style }: Props) {
  const [data, setData] = useState<AyVerisi[] | null>(() => {
    const c = tenantId ? _cache.get(tenantId) : null;
    return c ? c.data : null;
  });

  useEffect(() => {
    if (!tenantId) return;
    const c = _cache.get(tenantId);
    if (c && Date.now() - c.t < CACHE_MS) {
      setData(c.data);
      return;
    }
    let iptal = false;
    (async () => {
      try {
        const { token } = useAuthStore.getState();
        const res = await fetch(
          `${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/api/data/aylik-trend?tenant_id=${tenantId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const j = await res.json();
        if (!iptal && j?.ok && Array.isArray(j.data)) {
          _cache.set(tenantId, { t: Date.now(), data: j.data });
          setData(j.data);
        }
      } catch {
        // sessiz
      }
    })();
    return () => { iptal = true; };
  }, [tenantId]);

  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.toplam), 1);
  const genelToplam = data.reduce((s, d) => s + d.toplam, 0);
  if (genelToplam <= 0) return null;
  const enIyiIdx = data.reduce((bi, d, i) => (d.toplam > data[bi].toplam ? i : bi), 0);

  return (
    <View style={style}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <View style={{
          width: 36, height: 36, borderRadius: 10,
          backgroundColor: colors.primary + '18',
          justifyContent: 'center', alignItems: 'center',
        }}>
          <Ionicons name="bar-chart" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>
            Son 6 Ay Satış Trendi
          </Text>
          <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
            Toplam ₺{genelToplam.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 140 }}>
        {data.map((d, i) => {
          const oran = d.toplam / max;
          const h = d.toplam > 0 ? Math.max(oran * 98, 4) : 4;
          const vurgulu = i === enIyiIdx && d.toplam > 0;
          const barRenk = vurgulu ? colors.primary : d.toplam > 0 ? colors.primary + '55' : colors.border;
          return (
            <View key={d.ay} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
              <Text
                style={{ fontSize: 9, fontWeight: '700', color: vurgulu ? colors.primary : colors.textSecondary, marginBottom: 3 }}
                numberOfLines={1}
              >
                {d.toplam > 0 ? fmtShort(d.toplam) : ''}
              </Text>
              <View style={{
                width: '100%', maxWidth: 38, height: h, borderRadius: 6,
                backgroundColor: barRenk,
                borderWidth: d.devam_ediyor ? 1.5 : 0,
                borderColor: colors.primary,
                borderStyle: d.devam_ediyor ? 'dashed' : 'solid',
              }} />
              <Text style={{
                fontSize: 10, fontWeight: d.devam_ediyor ? '800' : '600',
                color: d.devam_ediyor ? colors.primary : colors.textSecondary, marginTop: 5,
              }}>
                {ayKisa(d.ay)}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={{ fontSize: 9, color: colors.textSecondary, marginTop: 8, opacity: 0.7 }}>
        Kesikli çubuk devam eden ayı gösterir
      </Text>
    </View>
  );
}
