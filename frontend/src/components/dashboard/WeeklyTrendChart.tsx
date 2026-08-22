/**
 * Son 7 Gün Satış Trendi — dashboard mini bar grafiği (2026-08).
 * GET /api/data/haftalik-trend verisini çeker; basit View barları ile çizer
 * (grafik kütüphanesi gerekmez). Tenant başına 5 dk modül-içi cache (SWR hissi).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';

interface GunVerisi {
  tarih: string;   // YYYY-MM-DD
  toplam: number;
  nakit: number;
  kart: number;
}

interface Props {
  tenantId: string | null;
  colors: any;
  style?: StyleProp<ViewStyle>;
  /** Bir gün barına dokunulunca çağrılır (YYYY-MM-DD) — dashboard o günün özetine geçer */
  onDayPress?: (tarih: string) => void;
}

const GUN_KISA = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

// Modül seviyesi basit cache — tenant değişmedikçe 5 dk yeniden çekme
const _cache = new Map<string, { t: number; data: GunVerisi[] }>();
const CACHE_MS = 5 * 60 * 1000;

const fmtShort = (v: number) => {
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`;
  return v.toFixed(0);
};

export function WeeklyTrendChart({ tenantId, colors, style, onDayPress }: Props) {
  const [data, setData] = useState<GunVerisi[] | null>(() => {
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
          `${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/api/data/haftalik-trend?tenant_id=${tenantId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const j = await res.json();
        if (!iptal && j?.ok && Array.isArray(j.data)) {
          _cache.set(tenantId, { t: Date.now(), data: j.data });
          setData(j.data);
        }
      } catch {
        // sessiz — trend grafiği kritik değil
      }
    })();
    return () => { iptal = true; };
  }, [tenantId]);

  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.toplam), 1);
  const toplam7 = data.reduce((s, d) => s + d.toplam, 0);
  if (toplam7 <= 0) return null; // hiç satış yoksa bölümü gizle
  const enIyiIdx = data.reduce((bi, d, i) => (d.toplam > data[bi].toplam ? i : bi), 0);
  const bugunIdx = data.length - 1;

  return (
    <View style={style}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <View style={{
          width: 36, height: 36, borderRadius: 10,
          backgroundColor: colors.primary + '18',
          justifyContent: 'center', alignItems: 'center',
        }}>
          <Ionicons name="trending-up" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>
            Son 7 Gün Satış Trendi
          </Text>
          <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
            Toplam ₺{toplam7.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} · Ort ₺{(toplam7 / 7).toLocaleString('tr-TR', { maximumFractionDigits: 0 })}/gün
          </Text>
          {!!onDayPress && (
            <Text style={{ fontSize: 10, color: colors.textSecondary, marginTop: 2, opacity: 0.7 }}>
              Bir güne dokunarak o günün özetini görüntüleyin
            </Text>
          )}
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 130 }}>
        {data.map((d, i) => {
          const oran = d.toplam / max;
          const h = d.toplam > 0 ? Math.max(oran * 92, 4) : 4;
          const gun = new Date(d.tarih + 'T12:00:00');
          const vurgulu = i === enIyiIdx && d.toplam > 0;
          const barRenk = vurgulu ? colors.primary : d.toplam > 0 ? colors.primary + '55' : colors.border;
          return (
            <TouchableOpacity
              key={d.tarih}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', minHeight: 44 }}
              onPress={() => onDayPress && onDayPress(d.tarih)}
              disabled={!onDayPress}
              activeOpacity={0.6}
            >
              <Text
                style={{ fontSize: 9, fontWeight: '700', color: vurgulu ? colors.primary : colors.textSecondary, marginBottom: 3 }}
                numberOfLines={1}
              >
                {d.toplam > 0 ? fmtShort(d.toplam) : ''}
              </Text>
              <View style={{
                width: '100%', maxWidth: 34, height: h, borderRadius: 6,
                backgroundColor: barRenk,
              }} />
              <Text style={{
                fontSize: 10, fontWeight: i === bugunIdx ? '800' : '600',
                color: i === bugunIdx ? colors.primary : colors.textSecondary, marginTop: 5,
              }}>
                {i === bugunIdx ? 'Bugün' : GUN_KISA[gun.getDay()]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
