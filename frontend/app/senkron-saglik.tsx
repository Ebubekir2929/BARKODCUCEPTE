// v22 — Senkron Sağlığı: müşteri (şube) başına POS bağlantısı, veri tazeliği,
// hatalar, yarım yüklemeler, bekleyen istekler ve arama indeksi durumu.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeStore } from '../src/store/themeStore';
import { useAuthStore } from '../src/store/authStore';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

type Durum = 'iyi' | 'uyari' | 'kritik' | 'yok';
interface Saglik {
  genel: Durum;
  pos: { firma: string | null; aktif: boolean; son_gorulme: string | null; yas_sn: number | null; durum: Durum };
  veri_setleri: { key: string; etiket: string; satir: number; guncelleme: string | null; yas_sn: number | null; durum: Durum }[];
  hatalar: { sayi: number; sayi_ust_sinir?: boolean; pencere_saat: number; son: { islem: string; veri_seti: string | null; hata: string | null; zaman: string | null }[] };
  islem_1s: { sayi: number; son: string | null };
  yarim_yuklemeler: { upload_id: string; veri_seti: string; gelen: number; toplam: number; yas_sn: number | null; durum: 'suruyor' | 'takili' }[];
  bekleyen_istekler: { sayi: number; en_eski_yas_sn: number | null; durum: Durum };
  arama_indeksi: { asama?: string; islenen?: number; toplam?: number; sayfa?: number; satir?: number };
}

const yasMetni = (sn: number | null | undefined) => {
  if (sn == null) return 'hiç';
  if (sn < 60) return `${sn} sn önce`;
  if (sn < 3600) return `${Math.floor(sn / 60)} dk önce`;
  if (sn < 86400) return `${Math.floor(sn / 3600)} sa önce`;
  return `${Math.floor(sn / 86400)} gün önce`;
};

export default function SenkronSaglikScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useThemeStore();
  const { user, isAuthenticated, isLoading } = useAuthStore();
  const tenants = user?.tenants || [];
  // Doğrudan URL ile gelinip oturum yoksa girişe yönlendir
  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/(auth)/login' as any);
  }, [isLoading, isAuthenticated]);
  const [secili, setSecili] = useState<string | null>(tenants[0]?.tenant_id || null);
  // Doğrudan açılışta kullanıcı deposu sonradan dolabilir → ilk şubeyi o zaman seç
  useEffect(() => {
    if (!secili && tenants.length > 0) setSecili(tenants[0].tenant_id);
  }, [tenants.length, secili]);
  const [veri, setVeri] = useState<Record<string, Saglik>>({});
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const renk = (d: Durum | string | undefined) =>
    d === 'iyi' ? colors.success : d === 'uyari' ? colors.warning : d === 'kritik' ? colors.error : colors.textSecondary;
  const etiket = (d: Durum | string | undefined) =>
    d === 'iyi' ? 'Sağlıklı' : d === 'uyari' ? 'Dikkat' : d === 'kritik' ? 'Sorun var' : 'Veri yok';

  const yukle = useCallback(async (tid: string) => {
    setYukleniyor(true); setHata(null);
    try {
      const { token } = useAuthStore.getState();
      const r = await fetch(`${API_URL}/api/senkron/saglik?tenant_id=${tid}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.detail || 'Okunamadı');
      setVeri((v) => ({ ...v, [tid]: j.data }));
    } catch (e: any) {
      setHata(e?.message || 'Sağlık bilgisi alınamadı');
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => { if (secili) yukle(secili); }, [secili, yukle]);

  const s = secili ? veri[secili] : undefined;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8} testID="senkron-geri">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Senkron Sağlığı</Text>
        <TouchableOpacity onPress={() => secili && yukle(secili)} style={styles.backBtn} hitSlop={8} testID="senkron-yenile">
          <Ionicons name="refresh" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {tenants.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.tenantRow}>
          {tenants.map((t: any) => {
            const aktif = t.tenant_id === secili;
            const d = veri[t.tenant_id]?.genel;
            return (
              <TouchableOpacity
                key={t.tenant_id}
                testID={`senkron-tenant-${t.tenant_id}`}
                onPress={() => setSecili(t.tenant_id)}
                style={[styles.tenantChip, { backgroundColor: aktif ? colors.primary : colors.card, borderColor: aktif ? colors.primary : colors.border }]}
              >
                {d && <View style={[styles.dot, { backgroundColor: renk(d) }]} />}
                <Text style={{ color: aktif ? '#FFF' : colors.text, fontWeight: '700', fontSize: 13 }}>{t.name || t.tenant_id.slice(0, 8)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
        refreshControl={<RefreshControl refreshing={yukleniyor} onRefresh={() => secili && yukle(secili)} tintColor={colors.primary} />}
      >
        {hata && <Text style={{ color: colors.error }}>{hata}</Text>}
        {tenants.length === 0 && !yukleniyor && (
          <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 40 }}>Bağlı şube bulunamadı.</Text>
        )}
        {!s && yukleniyor && <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />}
        {s && (
          <>
            {/* Genel durum */}
            <View style={[styles.card, { backgroundColor: renk(s.genel) + '18', borderColor: renk(s.genel) + '55' }]} testID="senkron-genel">
              <Ionicons name={s.genel === 'iyi' ? 'checkmark-circle' : s.genel === 'uyari' ? 'alert-circle' : 'close-circle'} size={34} color={renk(s.genel)} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: renk(s.genel) }}>{etiket(s.genel)}</Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                  {s.pos.firma || ''} · son 1 saatte {s.islem_1s.sayi} işlem
                </Text>
              </View>
            </View>

            {/* POS bağlantısı */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="desktop-outline" size={22} color={renk(s.pos.durum)} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>POS bağlantısı</Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>Son kalp atışı: {yasMetni(s.pos.yas_sn)}</Text>
              </View>
              <Text style={{ fontWeight: '800', color: renk(s.pos.durum), fontSize: 12 }}>{etiket(s.pos.durum)}</Text>
            </View>

            {/* Veri setleri */}
            <View style={[styles.block, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 8 }]}>Veri tazeliği</Text>
              {s.veri_setleri.map((v) => (
                <View key={v.key} style={styles.row}>
                  <View style={[styles.dot, { backgroundColor: renk(v.durum) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{v.etiket}</Text>
                    <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                      {v.satir.toLocaleString('tr-TR')} kayıt · {yasMetni(v.yas_sn)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Yarım yüklemeler */}
            {s.yarim_yuklemeler.length > 0 && (
              <View style={[styles.block, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 8 }]}>Sayfalı yüklemeler</Text>
                {s.yarim_yuklemeler.map((y) => (
                  <View key={y.upload_id} style={styles.row}>
                    <View style={[styles.dot, { backgroundColor: y.durum === 'suruyor' ? colors.primary : colors.warning }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>
                        {y.veri_seti} · {y.gelen}/{y.toplam || '?'} parça
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                        {y.durum === 'suruyor' ? 'Sürüyor' : 'Takılı kalmış'} · {yasMetni(y.yas_sn)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Bekleyen istekler + arama indeksi */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="hourglass-outline" size={22} color={renk(s.bekleyen_istekler.durum)} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Bekleyen rapor istekleri</Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                  {s.bekleyen_istekler.sayi === 0 ? 'Bekleyen yok' : `${s.bekleyen_istekler.sayi} istek · en eski ${yasMetni(s.bekleyen_istekler.en_eski_yas_sn)}`}
                </Text>
              </View>
            </View>
            {s.arama_indeksi?.asama && s.arama_indeksi.asama !== 'yok' && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="search-outline" size={22} color={s.arama_indeksi.asama === 'hazir' ? colors.success : colors.warning} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>Hızlı ürün arama indeksi</Text>
                  <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                    {s.arama_indeksi.asama === 'hazir'
                      ? `Hazır · ${s.arama_indeksi.sayfa || 0} sayfa`
                      : s.arama_indeksi.asama === 'kuruluyor'
                        ? `Kuruluyor · ${s.arama_indeksi.islenen || 0}/${s.arama_indeksi.toplam || 0} sayfa`
                        : s.arama_indeksi.asama}
                  </Text>
                </View>
              </View>
            )}

            {/* Hatalar */}
            <View style={[styles.block, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 8 }]}>
                Son {s.hatalar.pencere_saat} saat hatalar · {s.hatalar.sayi}{s.hatalar.sayi_ust_sinir ? '+' : ''}
              </Text>
              {s.hatalar.son.length === 0 ? (
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>Hata yok 👍</Text>
              ) : s.hatalar.son.map((h, i) => (
                <View key={i} style={{ paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>
                    {h.islem}{h.veri_seti ? ` · ${h.veri_seti}` : ''}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.textSecondary }} numberOfLines={2}>{h.hata || '—'}</Text>
                  <Text style={{ fontSize: 10, color: colors.textSecondary }}>{h.zaman?.replace('T', ' ')}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  backBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800' },
  tenantRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  tenantChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 40, borderRadius: 20, borderWidth: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  block: { padding: 14, borderRadius: 14, borderWidth: 1 },
  cardTitle: { fontSize: 14, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
