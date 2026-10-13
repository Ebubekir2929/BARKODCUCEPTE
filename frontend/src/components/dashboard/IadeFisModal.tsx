// v24 — İade Fişleri: garson satırındaki iade chip'ine dokununca o günün (aralığın)
// iade fişleri kişi bazında; fişe dokununca ürün satırları açılır.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/themeStore';
import { useAuthStore } from '../../store/authStore';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

type Detay = { STOK_ADI?: string; STOK_KODU?: string; MIKTAR?: number | string; BIRIM_ADI?: string; DAHIL_TUTAR?: number | string; TUTAR?: number | string };
type Fis = {
  FIS_ID: number | string;
  BELGENO?: string;
  FIS_TARIHI?: string;
  FIS_TURU_AD?: string;
  KESEN_PERSONEL?: string;
  LOKASYON?: string;
  TUTAR?: number | string;
  DETAY_SATIR_SAYISI?: number;
  DETAYLAR?: Detay[];
};
type Yanit = { fis_sayisi: number; toplam_tutar: number; kisiler: { personel: string; fis_sayisi: number; tutar: number }[]; data: Fis[] };

type Props = {
  visible: boolean;
  onClose: () => void;
  tenantId: string;
  sdate: string;
  edate: string;
  personel?: string | null; // null → tüm personel
  beklenenTutar?: number; // garson_satis_ozet IADE_TUTARI (karşılaştırma)
};

const fmtTL = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: any) => (typeof v === 'number' ? v : parseFloat(String(v || '0')) || 0);

export default function IadeFisModal({ visible, onClose, tenantId, sdate, edate, personel, beklenenTutar }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useThemeStore();
  const token = useAuthStore((s) => s.token);
  const [veri, setVeri] = useState<Yanit | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [acik, setAcik] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !tenantId || !token) return;
    let iptal = false;
    setYukleniyor(true);
    setHata(null);
    setAcik(null);
    const q = new URLSearchParams({ tenant_id: tenantId, sdate, edate });
    if (personel) q.set('personel', personel);
    fetch(`${API_URL}/api/data/iade-fisler?${q.toString()}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j?.ok) throw new Error(j?.detail || `HTTP ${r.status}`);
        if (!iptal) setVeri(j);
      })
      .catch((e) => !iptal && setHata(e?.message || 'İade fişleri alınamadı'))
      .finally(() => !iptal && setYukleniyor(false));
    return () => {
      iptal = true;
    };
  }, [visible, tenantId, sdate, edate, personel, token]);

  const aralik = sdate === edate ? sdate.split('-').reverse().join('.') : `${sdate.split('-').reverse().join('.')} – ${edate.split('-').reverse().join('.')}`;
  const fark = veri && beklenenTutar != null ? Math.round((beklenenTutar - veri.toplam_tutar) * 100) / 100 : 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 12 }]} testID="iade-fis-modal">
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text }]}>İade Fişleri</Text>
              <Text style={{ fontSize: 12, color: colors.textSecondary }} numberOfLines={1}>
                {personel ? `${personel} · ` : ''}{aralik}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8} testID="iade-fis-kapat">
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          {yukleniyor && <ActivityIndicator color={colors.primary} style={{ marginVertical: 30 }} />}
          {hata && <Text style={{ color: colors.error, padding: 16 }}>{hata}</Text>}

          {!yukleniyor && veri && (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
              <View style={[styles.ozet, { backgroundColor: '#DC262612', borderColor: '#DC262633' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.textSecondary }}>Toplam iade</Text>
                  <Text style={{ fontSize: 20, fontWeight: '900', color: '#DC2626' }}>-₺{fmtTL(veri.toplam_tutar)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 11, color: colors.textSecondary }}>{veri.fis_sayisi} fiş</Text>
                  {beklenenTutar != null && Math.abs(fark) >= 0.01 && (
                    <Text style={{ fontSize: 10, color: colors.warning, marginTop: 2 }} numberOfLines={2}>
                      Özet: ₺{fmtTL(beklenenTutar)} (fark ₺{fmtTL(Math.abs(fark))}, fiş akışında yok)
                    </Text>
                  )}
                </View>
              </View>

              {!personel && veri.kisiler.length > 1 && (
                <View style={[styles.kutu, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.kutuBaslik, { color: colors.text }]}>Kişi bazında</Text>
                  {veri.kisiler.map((k) => (
                    <View key={k.personel} style={styles.kisiSatir}>
                      <Text style={{ flex: 1, fontSize: 13, color: colors.text }} numberOfLines={1}>{k.personel}</Text>
                      <Text style={{ fontSize: 11, color: colors.textSecondary, marginRight: 8 }}>{k.fis_sayisi} fiş</Text>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: '#DC2626' }}>-₺{fmtTL(k.tutar)}</Text>
                    </View>
                  ))}
                </View>
              )}

              {veri.data.length === 0 ? (
                <View style={{ alignItems: 'center', padding: 24 }}>
                  <Ionicons name="receipt-outline" size={30} color={colors.textSecondary} />
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 6, textAlign: 'center' }}>
                    Fiş akışında bu {personel ? 'kişiye ait ' : ''}iade fişi bulunamadı.
                  </Text>
                </View>
              ) : (
                veri.data.map((f) => {
                  const id = String(f.FIS_ID);
                  const acikMi = acik === id;
                  const saat = (f.FIS_TARIHI || '').slice(11, 16);
                  return (
                    <TouchableOpacity
                      key={id}
                      onPress={() => setAcik(acikMi ? null : id)}
                      style={[styles.fis, { backgroundColor: colors.card, borderColor: acikMi ? '#DC262660' : colors.border }]}
                      testID={`iade-fis-${id}`}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={[styles.ikon, { backgroundColor: '#DC262615' }]}>
                          <Ionicons name="return-down-back-outline" size={18} color="#DC2626" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }} numberOfLines={1}>
                            Fiş #{f.BELGENO || id}{saat ? ` · ${saat}` : ''}
                          </Text>
                          <Text style={{ fontSize: 11, color: colors.textSecondary }} numberOfLines={1}>
                            {f.KESEN_PERSONEL || '—'}{f.LOKASYON ? ` · ${f.LOKASYON}` : ''} · {f.DETAY_SATIR_SAYISI ?? f.DETAYLAR?.length ?? 0} kalem
                          </Text>
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: '900', color: '#DC2626' }}>-₺{fmtTL(num(f.TUTAR))}</Text>
                        <Ionicons name={acikMi ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
                      </View>
                      {acikMi && (f.DETAYLAR || []).length > 0 && (
                        <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, gap: 6 }}>
                          {(f.DETAYLAR || []).map((d, i) => (
                            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <Text style={{ flex: 1, fontSize: 12, color: colors.text }} numberOfLines={2}>{d.STOK_ADI || d.STOK_KODU || '—'}</Text>
                              <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                                {num(d.MIKTAR).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} {d.BIRIM_ADI || ''}
                              </Text>
                              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, minWidth: 70, textAlign: 'right' }}>
                                ₺{fmtTL(num(d.DAHIL_TUTAR ?? d.TUTAR))}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#94A3B8', marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  title: { fontSize: 17, fontWeight: '800' },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  ozet: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, borderWidth: 1, gap: 8 },
  kutu: { padding: 12, borderRadius: 12, borderWidth: 1 },
  kutuBaslik: { fontSize: 13, fontWeight: '800', marginBottom: 6 },
  kisiSatir: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  fis: { padding: 12, borderRadius: 12, borderWidth: 1 },
  ikon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
