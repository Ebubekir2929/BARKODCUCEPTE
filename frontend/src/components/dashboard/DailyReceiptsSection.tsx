/**
 * Günlük Satılan Fişler — dashboard bölümü (2026-08).
 * Dashboard'ın tarih filtresine bağlıdır: filtre değişince o günün fişleri
 * gelir (geriye dönük bakma = mevcut filtre). Fişe dokununca ürün içeriği
 * akordeon olarak açılır. "Daha fazla göster" ile 10'arlı yüklenir.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';

interface FisDetay {
  STOK_ADI?: string;
  MIKTAR?: number;
  BIRIM_ADI?: string;
  DAHIL_TUTAR?: number;
  KDV_TUTARI?: number;
}

interface Fis {
  FIS_ID: number;
  BELGENO?: string;
  FIS_TARIHI?: string;
  FIS_TURU_AD?: string;
  KESEN_PERSONEL?: string;
  LOKASYON?: string;
  TUTAR?: string | number;
  DETAY_SATIR_SAYISI?: number;
  DETAYLAR: FisDetay[];
}

interface Props {
  tenantId: string | null;
  tarih: string; // YYYY-MM-DD — dashboard filtresinden gelir
  colors: any;
  style?: StyleProp<ViewStyle>;
}

const fmtTL = (v: any) => (parseFloat(String(v ?? '0')) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const saat = (t?: string) => (t && t.length >= 16 ? t.slice(11, 16) : '');

export function DailyReceiptsSection({ tenantId, tarih, colors, style }: Props) {
  const [fisler, setFisler] = useState<Fis[] | null>(null);
  const [toplam, setToplam] = useState(0);
  const [loading, setLoading] = useState(false);
  const [acikFis, setAcikFis] = useState<number | null>(null);
  const [gosterilen, setGosterilen] = useState(10);
  const [arama, setArama] = useState('');

  // Türkçe duyarsız arama: belge no, personel, lokasyon, fiş türü ve ÜRÜN ADI
  const filtreli = useMemo(() => {
    if (!fisler) return null;
    const q = arama.trim().toLocaleLowerCase('tr-TR');
    if (!q) return fisler;
    return fisler.filter((f) => {
      const alanlar = [f.BELGENO, f.KESEN_PERSONEL, f.LOKASYON, f.FIS_TURU_AD, String(f.FIS_ID)];
      if (alanlar.some((a) => (a || '').toLocaleLowerCase('tr-TR').includes(q))) return true;
      return f.DETAYLAR.some((u) => (u.STOK_ADI || '').toLocaleLowerCase('tr-TR').includes(q));
    });
  }, [fisler, arama]);

  useEffect(() => {
    if (!tenantId || !tarih) return;
    let iptal = false;
    setLoading(true);
    setAcikFis(null);
    setGosterilen(10);
    setArama('');
    (async () => {
      try {
        const { token } = useAuthStore.getState();
        const res = await fetch(
          `${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/api/data/gunluk-fisler?tenant_id=${tenantId}&tarih=${tarih}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const j = await res.json();
        if (!iptal && j?.ok) {
          setFisler(Array.isArray(j.data) ? j.data : []);
          setToplam(j.toplam_tutar || 0);
        }
      } catch {
        if (!iptal) setFisler([]);
      } finally {
        if (!iptal) setLoading(false);
      }
    })();
    return () => { iptal = true; };
  }, [tenantId, tarih]);

  const [y, m, d] = tarih.split('-');
  const tarihTR = `${d}.${m}.${y}`;

  return (
    <View style={style}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <View style={{
          width: 36, height: 36, borderRadius: 10,
          backgroundColor: colors.primary + '18',
          justifyContent: 'center', alignItems: 'center',
        }}>
          <Ionicons name="receipt" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>
            Günlük Satılan Fişler
          </Text>
          <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
            {tarihTR} · Tarih filtresiyle geçmiş günlere bakabilirsiniz
          </Text>
        </View>
        {fisler !== null && !loading && (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 15, fontWeight: '900', color: colors.primary }}>₺{fmtTL(toplam)}</Text>
            <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textSecondary }}>{fisler.length} fiş</Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : !fisler || fisler.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 16 }}>
          <Ionicons name="receipt-outline" size={28} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, marginTop: 6, fontSize: 13 }}>Bu tarihte fiş yok</Text>
        </View>
      ) : (
        <>
          {/* Hızlı arama: belge no / personel / ürün adı */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            borderWidth: 1, borderColor: colors.border, borderRadius: 12,
            paddingHorizontal: 12, marginBottom: 10, minHeight: 44,
            backgroundColor: colors.background,
          }}>
            <Ionicons name="search" size={16} color={colors.textSecondary} />
            <TextInput
              style={{ flex: 1, fontSize: 13, color: colors.text, paddingVertical: 10 }}
              placeholder="Belge no, personel veya ürün adı ara..."
              placeholderTextColor={colors.textSecondary}
              value={arama}
              onChangeText={(v) => { setArama(v); setGosterilen(10); setAcikFis(null); }}
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
          {arama.trim().length > 0 && (
            <Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 8 }}>
              {(filtreli || []).length} fiş bulundu
            </Text>
          )}
          {(filtreli || []).length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 14 }}>
              <Ionicons name="search-outline" size={24} color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, marginTop: 6, fontSize: 13 }}>Aramayla eşleşen fiş yok</Text>
            </View>
          ) : (filtreli || []).slice(0, gosterilen).map((f) => {
            const acik = acikFis === f.FIS_ID;
            return (
              <View
                key={f.FIS_ID}
                style={{
                  marginBottom: 8, borderRadius: 12, borderWidth: 1,
                  borderColor: acik ? colors.primary + '50' : colors.border,
                  backgroundColor: colors.background, overflow: 'hidden',
                }}
              >
                <TouchableOpacity
                  style={{ padding: 12, minHeight: 44 }}
                  onPress={() => setAcikFis(acik ? null : f.FIS_ID)}
                  activeOpacity={0.6}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                      <View style={{
                        paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
                        backgroundColor: colors.primary + '15', minWidth: 48, alignItems: 'center',
                      }}>
                        <Text style={{ fontSize: 12, fontWeight: '900', color: colors.primary }}>{saat(f.FIS_TARIHI) || '—'}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }} numberOfLines={1}>
                          {f.KESEN_PERSONEL || 'Personel'} · {f.LOKASYON || ''}
                        </Text>
                        <Text style={{ fontSize: 10, color: colors.textSecondary, marginTop: 1 }} numberOfLines={1}>
                          {f.FIS_TURU_AD || 'Fiş'} · {f.DETAY_SATIR_SAYISI || f.DETAYLAR.length} kalem{f.BELGENO ? ` · ${f.BELGENO}` : ''}
                        </Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: colors.primary }}>₺{fmtTL(f.TUTAR)}</Text>
                      <Ionicons name={acik ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textSecondary} />
                    </View>
                  </View>
                </TouchableOpacity>
                {acik && (
                  <View style={{ paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
                    {f.DETAYLAR.length === 0 ? (
                      <Text style={{ fontSize: 12, color: colors.textSecondary, paddingTop: 10 }}>Ürün detayı yok</Text>
                    ) : f.DETAYLAR.map((u, i) => (
                      <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10 }}>
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.text }} numberOfLines={1}>
                            {u.STOK_ADI || 'Ürün'}
                          </Text>
                          <Text style={{ fontSize: 10, color: colors.textSecondary }}>
                            {(u.MIKTAR ?? 0).toLocaleString('tr-TR', { maximumFractionDigits: 3 })} {u.BIRIM_ADI || ''}
                            {(u.KDV_TUTARI ?? 0) > 0 ? ` · KDV ₺${fmtTL(u.KDV_TUTARI)}` : ''}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text }}>₺{fmtTL(u.DAHIL_TUTAR)}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
          {(filtreli || []).length > gosterilen && (
            <TouchableOpacity
              style={{
                alignItems: 'center', paddingVertical: 12, borderRadius: 12,
                backgroundColor: colors.primary + '12', minHeight: 44, justifyContent: 'center',
              }}
              onPress={() => setGosterilen((g) => g + 10)}
              activeOpacity={0.6}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}>
                Daha fazla göster ({(filtreli || []).length - gosterilen} fiş daha)
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}
