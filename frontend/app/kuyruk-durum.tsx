/**
 * kuyruk-durum.tsx — Mobil İşlem Kuyruğu Durumu — 2026-07
 *
 * Uygulamadan gönderilen finans/fiş/sayım kayıtlarının POS aktarım durumunu
 * gösterir: bekliyor ⏳ / aktarıldı ✅ (erp_id) / hata ❌ (mesaj + yeniden dene).
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeStore } from '../src/store/themeStore';
import { useAuthStore } from '../src/store/authStore';
import { useDataSourceStore } from '../src/store/dataSourceStore';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

const GRUPLAR = [
  { key: '', ad: 'Tümü', icon: 'apps-outline' },
  { key: 'finans', ad: 'Finans', icon: 'cash-outline' },
  { key: 'fis', ad: 'Fiş', icon: 'receipt-outline' },
  { key: 'sayim', ad: 'Sayım', icon: 'clipboard-outline' },
];
const DURUMLAR: Record<string, { ad: string; renk: string; icon: string }> = {
  bekliyor: { ad: 'Bekliyor', renk: '#F59E0B', icon: 'time-outline' },
  aktarildi: { ad: 'Aktarıldı', renk: '#10B981', icon: 'checkmark-circle-outline' },
  hata: { ad: 'Hata', renk: '#EF4444', icon: 'alert-circle-outline' },
};

const fmt = (n: number) => '₺' + (n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function KuyrukDurumScreen() {
  const { colors } = useThemeStore();
  const { user } = useAuthStore();
  const { activeSource } = useDataSourceStore();

  const activeTenantId = useMemo(() => {
    if (!user?.tenants || user.tenants.length === 0) return '';
    const m = /^data(\d+)$/.exec(activeSource || '');
    const idx = m ? parseInt(m[1], 10) - 1 : -1;
    if (idx >= 0 && idx < user.tenants.length) return user.tenants[idx].tenant_id || '';
    return user.tenants[0]?.tenant_id || '';
  }, [user?.tenants, activeSource]);

  const [kayitlar, setKayitlar] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [grup, setGrup] = useState('');
  const [durumF, setDurumF] = useState('');
  const [acik, setAcik] = useState<number | null>(null);
  const [retryBusy, setRetryBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };
  const authHeaders = () => {
    const { token } = useAuthStore.getState();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` };
  };

  const yukle = useCallback(async (sessiz = false) => {
    if (!activeTenantId) return;
    if (!sessiz) setLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/islem/list?tenant_id=${activeTenantId}&islem_grubu=&limit=200`, { headers: authHeaders() });
      const j = await r.json();
      if (j.ok && Array.isArray(j.data)) setKayitlar(j.data);
    } catch {}
    setLoading(false);
  }, [activeTenantId]);

  useEffect(() => { yukle(); }, [yukle]);

  const onRefresh = async () => { setRefreshing(true); await yukle(true); setRefreshing(false); };

  const filtreli = useMemo(() => kayitlar.filter((k) =>
    (!grup || k.islem_grubu === grup) && (!durumF || k.durum === durumF),
  ), [kayitlar, grup, durumF]);

  const sayilar = useMemo(() => {
    const s = { bekliyor: 0, aktarildi: 0, hata: 0 };
    for (const k of kayitlar) if (s[k.durum as keyof typeof s] !== undefined) s[k.durum as keyof typeof s]++;
    return s;
  }, [kayitlar]);

  const yenidenDene = async (id: number) => {
    if (retryBusy) return;
    setRetryBusy(id);
    try {
      const r = await fetch(`${API_URL}/api/islem/yeniden-dene`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ tenant_id: activeTenantId, id }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.detail || 'Başarısız');
      setKayitlar((p) => p.map((k) => k.id === id ? { ...k, durum: 'bekliyor', hata_mesaji: null, processed_at: null } : k));
      showToast(`✓ #${id} kuyruğa geri alındı — POS yeniden deneyecek`);
    } catch (e: any) { showToast(String(e?.message || 'Hata'), false); }
    setRetryBusy(null);
  };

  const renderKayit = ({ item: k }: any) => {
    const d = DURUMLAR[k.durum] || DURUMLAR.bekliyor;
    const g = GRUPLAR.find((x) => x.key === k.islem_grubu) || GRUPLAR[0];
    const acikMi = acik === k.id;
    const detay = k.detay || null;
    return (
      <TouchableOpacity activeOpacity={0.75} onPress={() => setAcik(acikMi ? null : k.id)}
        style={[styles.kart, { backgroundColor: colors.card, borderColor: acikMi ? d.renk : colors.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={[styles.grupIkon, { backgroundColor: d.renk + '18' }]}>
            <Ionicons name={g.icon as any} size={18} color={d.renk} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text }} numberOfLines={1}>
              #{k.id} · {k.islem_turu_ad || g.ad}
            </Text>
            <Text style={{ fontSize: 11, color: colors.textSecondary }} numberOfLines={1}>
              {k.islem_grubu === 'sayim'
                ? `${detay?.toplam_kalem || 0} kalem · ${detay?.toplam_miktar ?? k.tutar} adet`
                : `${fmt(k.tutar)}${(k.kart_borclu_ad || k.kart_alacakli_ad) ? ` · ${k.kart_borclu_ad || k.kart_alacakli_ad}` : ''}`}
            </Text>
            <Text style={{ fontSize: 10, color: colors.textSecondary }}>{k.created_at}</Text>
          </View>
          <View style={[styles.durumRozet, { backgroundColor: d.renk + '18' }]}>
            <Ionicons name={d.icon as any} size={13} color={d.renk} />
            <Text style={{ fontSize: 11, fontWeight: '800', color: d.renk }}>{d.ad}</Text>
          </View>
          <Ionicons name={acikMi ? 'chevron-up' : 'chevron-down'} size={15} color={colors.textSecondary} />
        </View>

        {acikMi && (
          <View style={[styles.detayKutu, { borderTopColor: colors.border }]}>
            {k.durum === 'aktarildi' && (
              <Text style={{ fontSize: 12, color: '#10B981', fontWeight: '700' }}>
                ✓ ERP&apos;ye aktarıldı{k.erp_id ? ` — ERP ID: ${k.erp_id}` : ''}{k.processed_at ? ` · ${k.processed_at}` : ''}
              </Text>
            )}
            {k.durum === 'bekliyor' && (
              <Text style={{ fontSize: 12, color: '#F59E0B', fontWeight: '700' }}>⏳ POS istemcisinin çekmesi bekleniyor</Text>
            )}
            {k.durum === 'hata' && (
              <View style={[styles.hataKutu, { backgroundColor: '#EF444412', borderColor: '#EF444440' }]}>
                <Text style={{ fontSize: 11, color: '#EF4444', fontWeight: '700' }}>Hata mesajı:</Text>
                <Text style={{ fontSize: 11, color: colors.text, marginTop: 2 }}>{k.hata_mesaji || 'Bilinmeyen hata'}</Text>
                <TouchableOpacity onPress={() => yenidenDene(k.id)} disabled={retryBusy === k.id}
                  style={[styles.retryBtn, { backgroundColor: '#EF4444', opacity: retryBusy === k.id ? 0.6 : 1 }]}>
                  {retryBusy === k.id ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="refresh" size={14} color="#fff" />}
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>Yeniden Dene</Text>
                </TouchableOpacity>
              </View>
            )}
            {k.aciklama ? <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 6 }}>Açıklama: {k.aciklama}</Text> : null}
            {k.vade_tarihi ? <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>Vade: {k.vade_tarihi}{k.cek_no ? ` · No: ${k.cek_no}` : ''}</Text> : null}
            {Array.isArray(detay?.satirlar) && detay.satirlar.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: colors.textSecondary, marginBottom: 4 }}>SATIRLAR ({detay.satirlar.length})</Text>
                {detay.satirlar.slice(0, 20).map((s: any, i: number) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                    <Text style={{ fontSize: 11, color: colors.text, flex: 1 }} numberOfLines={1}>{s.ad}</Text>
                    <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                      {s.miktar}{s.fiyat != null ? ` × ${fmt(s.fiyat)}` : ' adet'}
                    </Text>
                  </View>
                ))}
                {detay.satirlar.length > 20 && <Text style={{ fontSize: 10, color: colors.textSecondary }}>… +{detay.satirlar.length - 20} satır daha</Text>}
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Kuyruk Durumu</Text>
        <TouchableOpacity onPress={() => yukle()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="refresh" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Durum özeti */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 }}>
        {(Object.keys(DURUMLAR) as (keyof typeof DURUMLAR)[]).map((dk) => {
          const d = DURUMLAR[dk];
          const secili = durumF === dk;
          return (
            <TouchableOpacity key={dk} onPress={() => setDurumF(secili ? '' : dk)}
              style={[styles.ozetKart, { backgroundColor: secili ? d.renk + '20' : colors.card, borderColor: secili ? d.renk : colors.border }]}>
              <Text style={{ fontSize: 18, fontWeight: '900', color: d.renk }}>{sayilar[dk as keyof typeof sayilar]}</Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: secili ? d.renk : colors.textSecondary }}>{d.ad}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Grup filtresi */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
        {GRUPLAR.map((g) => (
          <TouchableOpacity key={g.key} onPress={() => setGrup(g.key)}
            style={[styles.grupChip, { backgroundColor: grup === g.key ? colors.primary + '18' : colors.card, borderColor: grup === g.key ? colors.primary : colors.border }]}>
            <Ionicons name={g.icon as any} size={13} color={grup === g.key ? colors.primary : colors.textSecondary} />
            <Text style={{ fontSize: 11, fontWeight: '700', color: grup === g.key ? colors.primary : colors.text }}>{g.ad}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <FlatList
          data={filtreli}
          keyExtractor={(k: any) => String(k.id)}
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60, gap: 10 }}>
              <Ionicons name="file-tray-outline" size={44} color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Kayıt bulunamadı</Text>
            </View>
          }
          renderItem={renderKayit}
        />
      )}

      {toast && (
        <View style={[styles.toast, { backgroundColor: toast.ok ? '#10B981' : '#EF4444' }]}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{toast.msg}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  ozetKart: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  grupChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  kart: { borderRadius: 12, borderWidth: 1.5, padding: 12, marginBottom: 8 },
  grupIkon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  durumRozet: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  detayKutu: { marginTop: 10, paddingTop: 10, borderTopWidth: 1 },
  hataKutu: { padding: 10, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 10, marginTop: 8 },
  toast: { position: 'absolute', bottom: 30, left: 20, right: 20, padding: 14, borderRadius: 12, alignItems: 'center', zIndex: 10000 },
});
