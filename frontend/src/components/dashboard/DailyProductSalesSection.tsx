/**
 * Günlük Ürün Satışları — dashboard bölümü (2026-09 v18).
 * Seçilen günde her üründen KAÇ ADET satıldığını gösterir (saatlik satış
 * detayından toplanır). Dashboard tarih filtresine bağlıdır; arama ve
 * Adet/Tutar sıralaması vardır. "Daha fazla göster" ile 10'arlı yüklenir.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';

interface Urun {
  STOK_ID?: number | string;
  STOK_ADI: string;
  BIRIM_ADI?: string;
  MIKTAR: number;
  TUTAR: number;
  SAAT_SAYISI?: number;
  SAATLER?: string[];
  LOKASYONLAR?: string[];
}

interface Props {
  tenantId: string | null;
  tarih: string; // YYYY-MM-DD — dashboard filtresinden gelir
  lokasyonId?: string | null;
  colors: any;
  style?: StyleProp<ViewStyle>;
}

const fmtTL = (v: any) => (parseFloat(String(v ?? '0')) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMiktar = (v: number) => (v || 0).toLocaleString('tr-TR', { maximumFractionDigits: 3 });

export function DailyProductSalesSection({ tenantId, tarih, lokasyonId, colors, style }: Props) {
  const [urunler, setUrunler] = useState<Urun[] | null>(null);
  const [toplamMiktar, setToplamMiktar] = useState(0);
  const [toplamTutar, setToplamTutar] = useState(0);
  const [loading, setLoading] = useState(false);
  const [gosterilen, setGosterilen] = useState(10);
  const [arama, setArama] = useState('');
  const [siralama, setSiralama] = useState<'adet' | 'tutar'>('adet');

  const filtreli = useMemo(() => {
    if (!urunler) return null;
    const q = arama.trim().toLocaleLowerCase('tr-TR');
    const liste = q
      ? urunler.filter((u) => (u.STOK_ADI || '').toLocaleLowerCase('tr-TR').includes(q) || String(u.STOK_ID || '').includes(q))
      : urunler.slice();
    liste.sort((a, b) => (siralama === 'adet' ? b.MIKTAR - a.MIKTAR : b.TUTAR - a.TUTAR));
    return liste;
  }, [urunler, arama, siralama]);

  useEffect(() => {
    if (!tenantId || !tarih) return;
    let iptal = false;
    setLoading(true);
    setGosterilen(10);
    setArama('');
    (async () => {
      try {
        const { token } = useAuthStore.getState();
        const lok = lokasyonId ? `&lokasyon_id=${encodeURIComponent(lokasyonId)}` : '';
        const res = await fetch(
          `${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/api/data/gunluk-urun-satis?tenant_id=${tenantId}&tarih=${tarih}${lok}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const j = await res.json();
        if (!iptal && j?.ok) {
          setUrunler(Array.isArray(j.data) ? j.data : []);
          setToplamMiktar(j.toplam_miktar || 0);
          setToplamTutar(j.toplam_tutar || 0);
        } else if (!iptal) {
          setUrunler([]);
        }
      } catch {
        if (!iptal) setUrunler([]);
      } finally {
        if (!iptal) setLoading(false);
      }
    })();
    return () => { iptal = true; };
  }, [tenantId, tarih, lokasyonId]);

  const [y, m, d] = tarih.split('-');
  const tarihTR = `${d}.${m}.${y}`;
  const enCok = filtreli && filtreli.length > 0 ? (siralama === 'adet' ? filtreli[0].MIKTAR : filtreli[0].TUTAR) : 0;

  return (
    <View style={style} testID="daily-product-sales">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <View style={{
          width: 36, height: 36, borderRadius: 10,
          backgroundColor: colors.primary + '18',
          justifyContent: 'center', alignItems: 'center',
        }}>
          <Ionicons name="cube" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>Günlük Ürün Satışları</Text>
          <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
            {tarihTR} · Üründen kaç adet satıldı
          </Text>
        </View>
        {urunler !== null && !loading && (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 15, fontWeight: '900', color: colors.primary }}>{fmtMiktar(toplamMiktar)} adet</Text>
            <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textSecondary }}>
              {urunler.length} ürün · ₺{fmtTL(toplamTutar)}
            </Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : !urunler || urunler.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 16 }}>
          <Ionicons name="cube-outline" size={28} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, marginTop: 6, fontSize: 13 }}>Bu tarihte ürün satışı yok</Text>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <View style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
              borderWidth: 1, borderColor: colors.border, borderRadius: 12,
              paddingHorizontal: 12, minHeight: 44, backgroundColor: colors.background,
            }}>
              <Ionicons name="search" size={16} color={colors.textSecondary} />
              <TextInput
                testID="daily-product-search"
                style={{ flex: 1, fontSize: 13, color: colors.text, paddingVertical: 10 }}
                placeholder="Ürün adı veya kodu ara..."
                placeholderTextColor={colors.textSecondary}
                value={arama}
                onChangeText={(v) => { setArama(v); setGosterilen(10); }}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {arama.length > 0 && (
                <TouchableOpacity onPress={() => setArama('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
            {/* Sıralama: Adet / Tutar */}
            <View style={{ flexDirection: 'row', borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
              {(['adet', 'tutar'] as const).map((s) => (
                <TouchableOpacity
                  key={s}
                  testID={`daily-product-sort-${s}`}
                  onPress={() => { setSiralama(s); setGosterilen(10); }}
                  style={{
                    paddingHorizontal: 10, minHeight: 44, justifyContent: 'center',
                    backgroundColor: siralama === s ? colors.primary : colors.background,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '800', color: siralama === s ? '#FFF' : colors.textSecondary }}>
                    {s === 'adet' ? 'Adet' : 'Tutar'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          {arama.trim().length > 0 && (
            <Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 8 }}>
              {(filtreli || []).length} ürün bulundu
            </Text>
          )}
          {(filtreli || []).length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 14 }}>
              <Ionicons name="search-outline" size={24} color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, marginTop: 6, fontSize: 13 }}>Aramayla eşleşen ürün yok</Text>
            </View>
          ) : (filtreli || []).slice(0, gosterilen).map((u, i) => {
            const deger = siralama === 'adet' ? u.MIKTAR : u.TUTAR;
            const oran = enCok > 0 ? Math.max(0.04, Math.min(1, deger / enCok)) : 0;
            return (
              <View
                key={`${u.STOK_ID ?? u.STOK_ADI}-${i}`}
                style={{
                  marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
                  backgroundColor: colors.background, padding: 12, overflow: 'hidden',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{
                    width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: i < 3 ? colors.primary + '20' : colors.border,
                  }}>
                    <Text style={{ fontSize: 11, fontWeight: '900', color: i < 3 ? colors.primary : colors.textSecondary }}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }} numberOfLines={2}>{u.STOK_ADI}</Text>
                    <Text style={{ fontSize: 10, color: colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
                      {u.SAAT_SAYISI ? `${u.SAAT_SAYISI} farklı saatte` : ''}
                      {u.LOKASYONLAR && u.LOKASYONLAR.length > 1 ? ` · ${u.LOKASYONLAR.length} lokasyon` : (u.LOKASYONLAR?.[0] ? ` · ${u.LOKASYONLAR[0]}` : '')}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 15, fontWeight: '900', color: colors.primary }}>
                      {fmtMiktar(u.MIKTAR)} <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textSecondary }}>{(u.BIRIM_ADI || 'adet').toLocaleLowerCase('tr-TR')}</Text>
                    </Text>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textSecondary }}>₺{fmtTL(u.TUTAR)}</Text>
                  </View>
                </View>
                {/* Göreli çubuk */}
                <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 10, overflow: 'hidden' }}>
                  <View style={{ width: `${Math.round(oran * 100)}%`, height: 4, backgroundColor: colors.primary, borderRadius: 2 }} />
                </View>
              </View>
            );
          })}
          {(filtreli || []).length > gosterilen && (
            <TouchableOpacity
              testID="daily-product-more"
              style={{
                alignItems: 'center', paddingVertical: 12, borderRadius: 12,
                backgroundColor: colors.primary + '12', minHeight: 44, justifyContent: 'center',
              }}
              onPress={() => setGosterilen((g) => g + 10)}
              activeOpacity={0.6}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}>
                Daha fazla göster ({(filtreli || []).length - gosterilen} ürün daha)
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}
