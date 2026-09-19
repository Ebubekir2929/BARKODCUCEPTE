/**
 * Haftalık Ürün Trendi — dashboard bölümü (2026-09 v19).
 * Son 7 günde (dashboard tarih filtresinin günü dahil) en çok satan ürünlerin
 * GÜNLÜK adetleri mini çubuklarla; son 3 gün / ilk 3 gün ivmesi rozetle.
 * Hızlı yükselenler bir bakışta görülür. Arama ile ürün süzülür.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';

interface TrendUrun {
  STOK_ID?: number | string;
  STOK_ADI: string;
  BIRIM_ADI?: string;
  GUNLUK: number[];
  TOPLAM: number;
  TUTAR: number;
  GUN_ORT: number;
  IVME_YUZDE: number | null;
}

interface Props {
  tenantId: string | null;
  bitis: string; // YYYY-MM-DD — dashboard filtresindeki gün (dahil)
  lokasyonId?: string | null;
  colors: any;
  style?: StyleProp<ViewStyle>;
}

const GUN_KISA = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const fmtMiktar = (v: number) => (v || 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
const fmtTL = (v: any) => (parseFloat(String(v ?? '0')) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function WeeklyProductTrendSection({ tenantId, bitis, lokasyonId, colors, style }: Props) {
  const [urunler, setUrunler] = useState<TrendUrun[] | null>(null);
  const [gunler, setGunler] = useState<string[]>([]);
  const [gunToplam, setGunToplam] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [arama, setArama] = useState('');
  const [gosterilen, setGosterilen] = useState(8);
  const [mod, setMod] = useState<'toplam' | 'ivme'>('toplam');

  useEffect(() => {
    if (!tenantId || !bitis) return;
    let iptal = false;
    setLoading(true);
    setArama('');
    setGosterilen(8);
    (async () => {
      try {
        const { token } = useAuthStore.getState();
        const lok = lokasyonId ? `&lokasyon_id=${encodeURIComponent(lokasyonId)}` : '';
        const res = await fetch(
          `${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/api/data/haftalik-urun-trend?tenant_id=${tenantId}&bitis=${bitis}&limit=60${lok}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const j = await res.json();
        if (!iptal) {
          setUrunler(j?.ok && Array.isArray(j.data) ? j.data : []);
          setGunler(Array.isArray(j?.gunler) ? j.gunler : []);
          setGunToplam(Array.isArray(j?.gun_toplamlari) ? j.gun_toplamlari : []);
        }
      } catch {
        if (!iptal) setUrunler([]);
      } finally {
        if (!iptal) setLoading(false);
      }
    })();
    return () => { iptal = true; };
  }, [tenantId, bitis, lokasyonId]);

  const liste = useMemo(() => {
    if (!urunler) return [];
    const q = arama.trim().toLocaleLowerCase('tr-TR');
    const l = q ? urunler.filter((u) => (u.STOK_ADI || '').toLocaleLowerCase('tr-TR').includes(q)) : urunler.slice();
    if (mod === 'ivme') l.sort((a, b) => (b.IVME_YUZDE ?? -1e9) - (a.IVME_YUZDE ?? -1e9));
    return l;
  }, [urunler, arama, mod]);

  const gunEtiket = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return GUN_KISA[(d.getDay() + 6) % 7];
  };
  const haftaToplam = gunToplam.reduce((a, b) => a + b, 0);

  return (
    <View style={style} testID="weekly-product-trend">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primary + '18', justifyContent: 'center', alignItems: 'center' }}>
          <Ionicons name="trending-up" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>Haftalık Ürün Trendi</Text>
          <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
            {gunler.length === 7 ? `${gunler[0].slice(8, 10)}.${gunler[0].slice(5, 7)} – ${gunler[6].slice(8, 10)}.${gunler[6].slice(5, 7)}` : 'Son 7 gün'} · günlük adetler
          </Text>
        </View>
        {urunler !== null && !loading && (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 15, fontWeight: '900', color: colors.primary }}>{fmtMiktar(haftaToplam)} adet</Text>
            <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textSecondary }}>7 gün toplamı</Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={{ alignItems: 'center', paddingVertical: 20 }}><ActivityIndicator size="small" color={colors.primary} /></View>
      ) : !urunler || urunler.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 16 }}>
          <Ionicons name="trending-up-outline" size={28} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, marginTop: 6, fontSize: 13 }}>Son 7 günde ürün satışı yok</Text>
        </View>
      ) : (
        <>
          {/* Haftanın gün toplamları — küçük özet çubukları */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 44, marginBottom: 12 }}>
            {gunToplam.map((v, i) => {
              const mx = Math.max(...gunToplam, 1);
              return (
                <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                  <View style={{ width: '70%', height: Math.max(3, Math.round((v / mx) * 30)), borderRadius: 3, backgroundColor: i === 6 ? colors.primary : colors.primary + '60' }} />
                  <Text style={{ fontSize: 9, color: colors.textSecondary, marginTop: 2 }}>{gunler[i] ? gunEtiket(gunler[i]) : ''}</Text>
                </View>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 44, backgroundColor: colors.background }}>
              <Ionicons name="search" size={16} color={colors.textSecondary} />
              <TextInput
                testID="weekly-trend-search"
                style={{ flex: 1, fontSize: 13, color: colors.text, paddingVertical: 10 }}
                placeholder="Ürün ara..."
                placeholderTextColor={colors.textSecondary}
                value={arama}
                onChangeText={(v) => { setArama(v); setGosterilen(8); }}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
            <View style={{ flexDirection: 'row', borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
              {(['toplam', 'ivme'] as const).map((m) => (
                <TouchableOpacity key={m} testID={`weekly-trend-mode-${m}`} onPress={() => setMod(m)}
                  style={{ paddingHorizontal: 10, minHeight: 44, justifyContent: 'center', backgroundColor: mod === m ? colors.primary : colors.background }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: mod === m ? '#FFF' : colors.textSecondary }}>{m === 'toplam' ? 'En Çok' : 'Yükselen'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {liste.slice(0, gosterilen).map((u, i) => {
            const mx = Math.max(...u.GUNLUK, 0.0001);
            const ivme = u.IVME_YUZDE;
            const ivmeRenk = ivme == null ? colors.textSecondary : ivme >= 20 ? colors.success : ivme <= -20 ? colors.error : colors.textSecondary;
            return (
              <View key={`${u.STOK_ID ?? u.STOK_ADI}-${i}`} style={{ marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, padding: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }} numberOfLines={2}>{u.STOK_ADI}</Text>
                    <Text style={{ fontSize: 10, color: colors.textSecondary, marginTop: 2 }}>
                      günde ort. {fmtMiktar(u.GUN_ORT)} {(u.BIRIM_ADI || 'adet').toLocaleLowerCase('tr-TR')} · ₺{fmtTL(u.TUTAR)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 15, fontWeight: '900', color: colors.primary }}>{fmtMiktar(u.TOPLAM)}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                      {ivme != null && <Ionicons name={ivme >= 0 ? 'arrow-up' : 'arrow-down'} size={10} color={ivmeRenk} />}
                      <Text style={{ fontSize: 10, fontWeight: '800', color: ivmeRenk }}>{ivme == null ? 'yeni' : `${ivme > 0 ? '+' : ''}${ivme.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}%`}</Text>
                    </View>
                  </View>
                </View>
                {/* 7 günlük mini çubuklar */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 34, marginTop: 8 }}>
                  {u.GUNLUK.map((v, gi) => (
                    <View key={gi} style={{ flex: 1, alignItems: 'center' }}>
                      <Text style={{ fontSize: 8, color: colors.textSecondary }}>{v > 0 ? fmtMiktar(v) : ''}</Text>
                      <View style={{ width: '80%', height: Math.max(2, Math.round((v / mx) * 20)), borderRadius: 2, backgroundColor: gi === 6 ? colors.primary : colors.primary + '55' }} />
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
          {liste.length > gosterilen && (
            <TouchableOpacity testID="weekly-trend-more" onPress={() => setGosterilen((g) => g + 8)} activeOpacity={0.6}
              style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: colors.primary + '12', minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}>Daha fazla göster ({liste.length - gosterilen} ürün daha)</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}
