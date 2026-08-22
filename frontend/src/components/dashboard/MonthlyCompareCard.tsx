/**
 * Aylık Karşılaştırma kartı — bu ay vs geçen ay (aynı dönem) satış toplamı,
 * yüzde farkı rozetiyle. GET /api/data/aylik-karsilastirma verisini çeker.
 * 5 dk modül-içi cache; her iki dönem de 0 ise kart gizlenir.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';

interface AylikVeri {
  bu_ay: { ay: string; toplam: number; gun: number };
  gecen_ay_ayni_donem: { ay: string; toplam: number };
  gecen_ay_toplam: number;
  fark: number;
  fark_yuzde: number | null;
}

interface Props {
  tenantId: string | null;
  colors: any;
  style?: StyleProp<ViewStyle>;
}

const AY_ADI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const ayAdi = (ym: string) => AY_ADI[parseInt(ym.slice(5, 7), 10) - 1] || ym;
const fmtTL = (v: number) => v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const _cache = new Map<string, { t: number; data: AylikVeri }>();
const CACHE_MS = 5 * 60 * 1000;

export function MonthlyCompareCard({ tenantId, colors, style }: Props) {
  const [data, setData] = useState<AylikVeri | null>(() => {
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
          `${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/api/data/aylik-karsilastirma?tenant_id=${tenantId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const j = await res.json();
        if (!iptal && j?.ok && j.data) {
          _cache.set(tenantId, { t: Date.now(), data: j.data });
          setData(j.data);
        }
      } catch {
        // sessiz — kart kritik değil
      }
    })();
    return () => { iptal = true; };
  }, [tenantId]);

  if (!data) return null;
  if (data.bu_ay.toplam <= 0 && data.gecen_ay_toplam <= 0) return null;

  const artis = data.fark >= 0;
  const rozetRenk = artis ? (colors.success || '#10B981') : (colors.error || '#EF4444');

  return (
    <View style={style}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <View style={{
          width: 36, height: 36, borderRadius: 10,
          backgroundColor: colors.primary + '18',
          justifyContent: 'center', alignItems: 'center',
        }}>
          <Ionicons name="calendar" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>
            Aylık Karşılaştırma
          </Text>
          <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
            {ayAdi(data.bu_ay.ay)} 1-{data.bu_ay.gun} vs {ayAdi(data.gecen_ay_ayni_donem.ay)} 1-{data.bu_ay.gun}
          </Text>
        </View>
        {data.fark_yuzde !== null && (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 3,
            backgroundColor: rozetRenk + '18',
            paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
          }}>
            <Ionicons name={artis ? 'trending-up' : 'trending-down'} size={13} color={rozetRenk} />
            <Text style={{ fontSize: 13, fontWeight: '900', color: rozetRenk }}>
              {artis ? '+' : ''}{data.fark_yuzde}%
            </Text>
          </View>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{
          flex: 1, padding: 12, borderRadius: 12,
          backgroundColor: colors.primary + '12',
          borderWidth: 1.5, borderColor: colors.primary + '40',
        }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Bu Ay ({ayAdi(data.bu_ay.ay)})
          </Text>
          <Text style={{ fontSize: 17, fontWeight: '900', color: colors.primary, marginTop: 4 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            ₺{fmtTL(data.bu_ay.toplam)}
          </Text>
        </View>
        <View style={{
          flex: 1, padding: 12, borderRadius: 12,
          backgroundColor: colors.background,
          borderWidth: 1, borderColor: colors.border,
        }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {ayAdi(data.gecen_ay_ayni_donem.ay)} (aynı dönem)
          </Text>
          <Text style={{ fontSize: 17, fontWeight: '900', color: colors.text, marginTop: 4 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            ₺{fmtTL(data.gecen_ay_ayni_donem.toplam)}
          </Text>
        </View>
      </View>

      <View style={{
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border,
      }}>
        <Text style={{ fontSize: 11, color: colors.textSecondary }}>
          {ayAdi(data.gecen_ay_ayni_donem.ay)} ayı tam toplam
        </Text>
        <Text style={{ fontSize: 12, fontWeight: '800', color: colors.textSecondary }}>
          ₺{fmtTL(data.gecen_ay_toplam)}
        </Text>
      </View>
      {data.fark_yuzde !== null && (
        <Text style={{ fontSize: 11, color: rozetRenk, marginTop: 6, fontWeight: '600' }}>
          {artis ? '▲' : '▼'} Geçen ayın aynı dönemine göre {artis ? '' : '-'}₺{fmtTL(Math.abs(data.fark))} {artis ? 'fazla' : 'eksik'}
        </Text>
      )}
    </View>
  );
}
