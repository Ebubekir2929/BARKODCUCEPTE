/**
 * finans-islem.tsx — Cari Finans İşlemleri (Faz 1) — 2026-07
 *
 * Tahsilat / Ödeme / Çek / Senet kayıtları MySQL `mobil_islem_kuyrugu`na
 * yazılır; POS istemcisi ERP12'ye (SEQUENS_VER + FINANS/FINANS_DETAY) aktarır.
 * Çek/senette vade, çek no, vergi no ve çek resmi (kamera/galeri) alınır.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Image, Platform, Linking, FlatList,
} from 'react-native';
import { KeyboardAwareScrollView, KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useThemeStore } from '../src/store/themeStore';
import { useAuthStore } from '../src/store/authStore';
import { useDataSourceStore } from '../src/store/dataSourceStore';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// Backend ISLEM_TURLERI ile birebir aynı (kod → yön/çek-senet bilgisi)
const TURLER = [
  { kod: 1, ad: 'Nakit Tahsilat', icon: 'cash-outline', renk: '#10B981', cekSenet: false, kasaEtiket: 'Kasa' },
  { kod: 15, ad: 'Pos Kartı ile Tahsilat', icon: 'card-outline', renk: '#10B981', cekSenet: false, kasaEtiket: 'Banka/Pos' },
  { kod: 7, ad: 'Havale Alma', icon: 'arrow-down-circle-outline', renk: '#10B981', cekSenet: false, kasaEtiket: 'Banka' },
  { kod: 2, ad: 'Nakit Ödeme', icon: 'wallet-outline', renk: '#EF4444', cekSenet: false, kasaEtiket: 'Kasa' },
  { kod: 8, ad: 'Havale Yollama', icon: 'arrow-up-circle-outline', renk: '#EF4444', cekSenet: false, kasaEtiket: 'Banka' },
  { kod: 21, ad: 'Çek Girişi', icon: 'document-outline', renk: '#3B82F6', cekSenet: true, kasaEtiket: 'Çek Kasası' },
  { kod: 17, ad: 'Çek Çıkışı', icon: 'document-outline', renk: '#F59E0B', cekSenet: true, kasaEtiket: 'Çek Kasası' },
  { kod: 35, ad: 'Senet Girişi', icon: 'reader-outline', renk: '#3B82F6', cekSenet: true, kasaEtiket: 'Senet Kasası' },
  { kod: 31, ad: 'Senet Çıkışı', icon: 'reader-outline', renk: '#F59E0B', cekSenet: true, kasaEtiket: 'Senet Kasası' },
];

const DURUM_RENK: Record<string, string> = { bekliyor: '#F59E0B', aktarildi: '#10B981', hata: '#EF4444' };
const DURUM_AD: Record<string, string> = { bekliyor: 'Bekliyor', aktarildi: 'Aktarıldı', hata: 'Hata' };

export default function FinansIslemScreen() {
  const { colors } = useThemeStore();
  const { user } = useAuthStore();
  const { activeSource } = useDataSourceStore();
  const params = useLocalSearchParams<{ cariId?: string; cariAd?: string }>();

  const activeTenantId = useMemo(() => {
    if (!user?.tenants || user.tenants.length === 0) return '';
    const match = /^data(\d+)$/.exec(activeSource || '');
    const idx = match ? parseInt(match[1], 10) - 1 : -1;
    if (idx >= 0 && idx < user.tenants.length) return user.tenants[idx].tenant_id || '';
    return user.tenants[0]?.tenant_id || '';
  }, [user?.tenants, activeSource]);

  const [tur, setTur] = useState(TURLER[0]);
  const [cari, setCari] = useState<{ id: number; ad: string } | null>(
    params.cariId ? { id: Number(params.cariId), ad: String(params.cariAd || '') } : null,
  );
  const [kasa, setKasa] = useState<{ kart_id: number; ad: string } | null>(null);
  const [tutar, setTutar] = useState('');
  const [aciklama, setAciklama] = useState('');
  const [vade, setVade] = useState('');
  const [cekNo, setCekNo] = useState('');
  const [vergiNo, setVergiNo] = useState('');
  const [resim, setResim] = useState<string | null>(null); // base64

  const [kasalar, setKasalar] = useState<any[]>([]);
  const [cariler, setCariler] = useState<any[]>([]);
  const [cariAra, setCariAra] = useState('');
  const [showCariSecim, setShowCariSecim] = useState(false);
  const [showKasaSecim, setShowKasaSecim] = useState(false);
  const [showKasaEkle, setShowKasaEkle] = useState(false);
  const [yeniKasaId, setYeniKasaId] = useState('');
  const [yeniKasaAd, setYeniKasaAd] = useState('');

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [islemler, setIslemler] = useState<any[]>([]);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const authHeaders = () => {
    const { token } = useAuthStore.getState();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` };
  };

  // POS istemcisinden açılan yetki kontrolü (kapalıysa ekran kilitli)
  const [yetki, setYetki] = useState<boolean | null>(null);
  useEffect(() => {
    let iptal = false;
    if (!activeTenantId) { setYetki(false); return; }
    (async () => {
      try {
        const r = await fetch(`${API_URL}/api/islem/yetkiler?tenant_id=${activeTenantId}`, { headers: authHeaders() });
        const j = await r.json();
        if (!iptal) setYetki(j.ok ? !!j.finans : false);
      } catch { if (!iptal) setYetki(false); }
    })();
    return () => { iptal = true; };
  }, [activeTenantId]);

  const loadKasalar = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/islem/kasalar?tenant_id=${activeTenantId}`, { headers: authHeaders() });
      const j = await r.json();
      if (j.ok) setKasalar(j.data || []);
    } catch {}
  }, [activeTenantId]);

  // 2026-06 — Havale → BANKA_HESAP, Pos → BANKA_POS kartları OTOMATİK gelir
  const [bankalar, setBankalar] = useState<any[]>([]);
  const bankaKaynak = tur.kod === 15 ? 'banka_pos_list' : (tur.kod === 7 || tur.kod === 8) ? 'banka_hesap_list' : '';

  const loadBankalar = useCallback(async (key: string) => {
    try {
      const r = await fetch(`${API_URL}/api/islem/kaynak-liste?tenant_id=${activeTenantId}&key=${key}`, { headers: authHeaders() });
      const j = await r.json();
      if (j.ok && Array.isArray(j.data)) {
        const liste = j.data.map((b: any) => {
          const kartId = Number(b.KART ?? b.KART_ID ?? b.FK_KART ?? b.KASA ?? b.ID) || 0;
          const parcalar = [b.BANKA_ADI, b.HESAP_ADI ?? b.ADI ?? b.AD ?? b.TANIM ?? b.HESAP_NO, b.TIP ?? b.TUR]
            .map((x: any) => (x == null ? '' : String(x).trim()))
            .filter((x: string) => x && x !== '0' && x !== '1');
          return {
            kart_id: kartId,
            ad: parcalar.join(' · ') || `Kart ${kartId}`,
            tip: key === 'banka_pos_list' ? 'BANKA POS' : 'BANKA HESAP',
          };
        }).filter((b: any) => b.kart_id > 0);
        setBankalar(liste);
        return;
      }
    } catch {}
    setBankalar([]);
  }, [activeTenantId]);

  useEffect(() => {
    setKasa(null);
    if (bankaKaynak) loadBankalar(bankaKaynak); else setBankalar([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankaKaynak]);

  const loadIslemler = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/islem/list?tenant_id=${activeTenantId}&limit=30`, { headers: authHeaders() });
      const j = await r.json();
      if (j.ok) setIslemler(j.data || []);
    } catch {}
  }, [activeTenantId]);

  const loadCariler = useCallback(async () => {
    if (cariler.length > 0) return;
    try {
      const r = await fetch(`${API_URL}/api/data/cari-list`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ tenant_id: activeTenantId, page: 1, page_size: 50000 }),
      });
      const j = await r.json();
      if (j.ok && Array.isArray(j.data)) setCariler(j.data);
    } catch {}
  }, [activeTenantId, cariler.length]);

  useEffect(() => {
    if (!activeTenantId) return;
    loadKasalar();
    loadIslemler();
  }, [activeTenantId, loadKasalar, loadIslemler]);

  const filtreliCariler = useMemo(() => {
    const q = cariAra.trim().toLocaleLowerCase('tr-TR');
    if (!q) return cariler.slice(0, 100);
    return cariler.filter((c: any) =>
      String(c.AD || c.CARI_ADI || c.UNVAN || '').toLocaleLowerCase('tr-TR').includes(q)
      || String(c.KOD || c.CARI_KODU || '').toLocaleLowerCase('tr-TR').includes(q),
    ).slice(0, 100);
  }, [cariler, cariAra]);

  // Çek resmi — izin akışı: önce mevcut izni kontrol et, gerekirse iste,
  // kalıcı red durumunda Ayarlar'a yönlendir.
  const resimSec = async (kamera: boolean) => {
    try {
      const perm = kamera
        ? await ImagePicker.getCameraPermissionsAsync()
        : await ImagePicker.getMediaLibraryPermissionsAsync();
      let granted = perm.granted;
      if (!granted && perm.canAskAgain !== false) {
        const req = kamera
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
        granted = req.granted;
      }
      if (!granted) {
        showToast('İzin verilmedi — Ayarlar\'dan izin verebilirsiniz', false);
        if (perm.canAskAgain === false && Platform.OS !== 'web') Linking.openSettings();
        return;
      }
      const result = kamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.4, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.4, base64: true });
      if (!result.canceled && result.assets?.[0]?.base64) {
        setResim(result.assets[0].base64);
      }
    } catch {
      showToast('Resim alınamadı', false);
    }
  };

  const kaydet = async () => {
    if (busy) return;
    const t = parseFloat(tutar.replace(',', '.'));
    if (!cari) return showToast('Cari seçin', false);
    if (!kasa) return showToast(`${tur.kasaEtiket} seçin`, false);
    if (!t || t <= 0) return showToast('Geçerli tutar girin', false);
    if (tur.cekSenet && !/^\d{4}-\d{2}-\d{2}$/.test(vade)) return showToast('Vade tarihi: YYYY-AA-GG', false);
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/islem/create`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          tenant_id: activeTenantId,
          islem_turu: tur.kod,
          cari_id: cari.id, cari_ad: cari.ad,
          kasa_id: kasa.kart_id, kasa_ad: kasa.ad,
          tutar: t,
          aciklama,
          vade_tarihi: tur.cekSenet ? vade : null,
          cek_no: tur.cekSenet ? cekNo : null,
          vergi_no: tur.cekSenet ? vergiNo : null,
          cek_resmi: tur.cekSenet ? resim : null,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.detail || 'Kaydedilemedi');
      showToast(`✓ Kaydedildi (#${j.id}) — POS aktaracak`);
      setTutar(''); setAciklama(''); setVade(''); setCekNo(''); setVergiNo(''); setResim(null);
      loadIslemler();
    } catch (e: any) {
      showToast(String(e?.message || 'Hata'), false);
    } finally {
      setBusy(false);
    }
  };

  const kasaEkle = async () => {
    const id = parseInt(yeniKasaId, 10);
    if (!id || !yeniKasaAd.trim()) return showToast('Kart ID ve ad gerekli', false);
    try {
      const r = await fetch(`${API_URL}/api/islem/kasa-ekle`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ tenant_id: activeTenantId, kart_id: id, ad: yeniKasaAd.trim(), tip: 'K' }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error('Eklenemedi');
      setYeniKasaId(''); setYeniKasaAd(''); setShowKasaEkle(false);
      loadKasalar();
      showToast('Kasa eklendi');
    } catch { showToast('Kasa eklenemedi', false); }
  };

  const inputStyle = [styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }];

  if (yetki !== true) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Finans İşlemi</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
          {yetki === null ? <ActivityIndicator size="large" color={colors.primary} /> : (
            <>
              <Ionicons name="lock-closed-outline" size={56} color={colors.textSecondary} />
              <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>İşleme Yetkiniz Yok</Text>
              <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 19 }}>
                Bu özellik POS istemcisinden{'\n'}(Ayarlar → &quot;Mobil Finans İşlemleri&quot;) açılmalıdır.
              </Text>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Finans İşlemi</Text>
        <TouchableOpacity onPress={() => router.push('/kuyruk-durum')} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="list-circle-outline" size={26} color={colors.text} />
        </TouchableOpacity>
      </View>

      <KeyboardAwareScrollView bottomOffset={24} style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          {/* İşlem türü */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>İŞLEM TÜRÜ</Text>
          <View style={styles.turGrid}>
            {TURLER.map((item) => {
              const secili = tur.kod === item.kod;
              return (
                <TouchableOpacity
                  key={item.kod}
                  onPress={() => setTur(item)}
                  style={[styles.turChip, {
                    backgroundColor: secili ? item.renk + '18' : colors.card,
                    borderColor: secili ? item.renk : colors.border,
                  }]}
                >
                  <Ionicons name={item.icon as any} size={15} color={secili ? item.renk : colors.textSecondary} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: secili ? item.renk : colors.text }}>{item.ad}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Cari seçimi */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>CARİ</Text>
          <TouchableOpacity
            style={[styles.secBtn, { backgroundColor: colors.card, borderColor: cari ? colors.primary : colors.border }]}
            onPress={() => { setShowCariSecim(true); loadCariler(); }}
          >
            <Ionicons name="person-outline" size={18} color={cari ? colors.primary : colors.textSecondary} />
            <Text style={{ flex: 1, color: cari ? colors.text : colors.textSecondary, fontWeight: cari ? '700' : '400' }} numberOfLines={1}>
              {cari ? cari.ad : 'Cari seçin…'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* Kasa seçimi */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>{tur.kasaEtiket.toLocaleUpperCase('tr-TR')}</Text>
          <TouchableOpacity
            style={[styles.secBtn, { backgroundColor: colors.card, borderColor: kasa ? colors.primary : colors.border }]}
            onPress={() => setShowKasaSecim(true)}
          >
            <Ionicons name="business-outline" size={18} color={kasa ? colors.primary : colors.textSecondary} />
            <Text style={{ flex: 1, color: kasa ? colors.text : colors.textSecondary, fontWeight: kasa ? '700' : '400' }} numberOfLines={1}>
              {kasa ? kasa.ad : `${tur.kasaEtiket} seçin…`}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* Tutar + açıklama */}
          <Text style={[styles.label, { color: colors.textSecondary }]}>TUTAR (₺)</Text>
          <TextInput style={inputStyle} value={tutar} onChangeText={setTutar} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={colors.textSecondary} />
          <Text style={[styles.label, { color: colors.textSecondary }]}>AÇIKLAMA</Text>
          <TextInput style={inputStyle} value={aciklama} onChangeText={setAciklama} placeholder="İsteğe bağlı" placeholderTextColor={colors.textSecondary} />

          {/* Çek/Senet alanları */}
          {tur.cekSenet && (
            <View style={[styles.cekBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 8 }}>
                {tur.ad.includes('Çek') ? 'Çek Bilgileri' : 'Senet Bilgileri'}
              </Text>
              <Text style={[styles.label, { color: colors.textSecondary }]}>VADE TARİHİ (YYYY-AA-GG) *</Text>
              <TextInput style={inputStyle} value={vade} onChangeText={setVade} placeholder="2026-08-15" placeholderTextColor={colors.textSecondary} />
              <Text style={[styles.label, { color: colors.textSecondary }]}>{tur.ad.includes('Çek') ? 'ÇEK NO' : 'SENET NO'}</Text>
              <TextInput style={inputStyle} value={cekNo} onChangeText={setCekNo} placeholder="No" placeholderTextColor={colors.textSecondary} />
              <Text style={[styles.label, { color: colors.textSecondary }]}>VERGİ NUMARASI</Text>
              <TextInput style={inputStyle} value={vergiNo} onChangeText={setVergiNo} keyboardType="number-pad" placeholder="Vergi no" placeholderTextColor={colors.textSecondary} />
              <Text style={[styles.label, { color: colors.textSecondary }]}>{tur.ad.includes('Çek') ? 'ÇEK RESMİ' : 'SENET RESMİ'}</Text>
              {resim ? (
                <View style={{ gap: 8 }}>
                  <Image source={{ uri: `data:image/jpeg;base64,${resim}` }} style={{ width: '100%', height: 160, borderRadius: 10 }} resizeMode="cover" />
                  <TouchableOpacity onPress={() => setResim(null)} style={{ alignSelf: 'flex-start' }}>
                    <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 12 }}>Resmi kaldır</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity style={[styles.resimBtn, { borderColor: colors.border }]} onPress={() => resimSec(true)}>
                    <Ionicons name="camera-outline" size={18} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>Fotoğraf Çek</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.resimBtn, { borderColor: colors.border }]} onPress={() => resimSec(false)}>
                    <Ionicons name="image-outline" size={18} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>Galeriden Seç</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* Kaydet */}
          <TouchableOpacity onPress={kaydet} disabled={busy} style={[styles.kaydetBtn, { backgroundColor: tur.renk, opacity: busy ? 0.6 : 1 }]}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />}
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{busy ? 'Kaydediliyor…' : `${tur.ad} Kaydet`}</Text>
          </TouchableOpacity>

          {/* Son işlemler */}
          <Text style={[styles.label, { color: colors.textSecondary, marginTop: 22 }]}>SON İŞLEMLER</Text>
          {islemler.length === 0 ? (
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>Henüz işlem yok</Text>
          ) : islemler.map((it) => (
            <View key={it.id} style={[styles.islemRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }} numberOfLines={1}>
                  {it.islem_turu_ad} — ₺{Number(it.tutar).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                </Text>
                <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }} numberOfLines={1}>
                  {it.kart_borclu_ad || '-'} → {it.kart_alacakli_ad || '-'} · {String(it.created_at || '').slice(0, 16)}
                </Text>
                {it.durum === 'hata' && !!it.hata_mesaji && (
                  <Text style={{ fontSize: 10, color: '#EF4444', marginTop: 2 }} numberOfLines={2}>{it.hata_mesaji}</Text>
                )}
              </View>
              <View style={[styles.durumBadge, { backgroundColor: (DURUM_RENK[it.durum] || '#888') + '18' }]}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: DURUM_RENK[it.durum] || '#888' }}>
                  {DURUM_AD[it.durum] || it.durum}
                </Text>
              </View>
            </View>
          ))}
      </KeyboardAwareScrollView>

      {/* Cari seçim overlay */}
      {showCariSecim && (
        <View style={styles.overlay}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setShowCariSecim(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Cari Seç</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text, marginHorizontal: 16 }]}
              value={cariAra} onChangeText={setCariAra} placeholder="Cari ara…" placeholderTextColor={colors.textSecondary} autoFocus
            />
            {cariler.length === 0 ? (
              <View style={{ padding: 24, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>
            ) : (
              <FlatList
                data={filtreliCariler}
                keyExtractor={(c: any, i: number) => String(c.ID || c.KART || i)}
                style={{ maxHeight: 380 }}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item: c }: any) => (
                  <TouchableOpacity
                    style={[styles.sheetRow, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      const id = Number(c.ID || c.KART || 0);
                      setCari({ id, ad: String(c.AD || c.CARI_ADI || c.UNVAN || id) });
                      setShowCariSecim(false); setCariAra('');
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>{c.AD || c.CARI_ADI || c.UNVAN}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{c.KOD || c.CARI_KODU || ''}</Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
          </KeyboardAvoidingView>
        </View>
      )}

      {/* Kasa seçim overlay */}
      {showKasaSecim && (
        <View style={styles.overlay}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => { setShowKasaSecim(false); setShowKasaEkle(false); }} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>{tur.kasaEtiket} Seç</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {(bankaKaynak && bankalar.length > 0 ? bankalar : kasalar).length === 0 && (
                <Text style={{ color: colors.textSecondary, fontSize: 12, padding: 16 }}>
                  {bankaKaynak
                    ? 'Banka kartları henüz gelmedi (POS client listeyi 10 dk\'da bir gönderir) — kayıtlı kasalardan seçin veya ekleyin.'
                    : 'Kayıtlı kasa kartı yok — aşağıdan ERP12 kart ID\'si ile ekleyin.'}
                </Text>
              )}
              {(bankaKaynak && bankalar.length > 0 ? bankalar : kasalar).map((k) => (
                <TouchableOpacity
                  key={k.kart_id}
                  style={[styles.sheetRow, { borderBottomColor: colors.border }]}
                  onPress={() => { setKasa(k); setShowKasaSecim(false); }}
                >
                  <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }}>{k.ad}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 11 }}>ID: {k.kart_id} · {k.tip}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {showKasaEkle ? (
              <View style={{ paddingHorizontal: 16, gap: 8, marginTop: 8 }}>
                <TextInput style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]} value={yeniKasaId} onChangeText={setYeniKasaId} keyboardType="number-pad" placeholder="ERP12 Kart ID (örn. 75923)" placeholderTextColor={colors.textSecondary} />
                <TextInput style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]} value={yeniKasaAd} onChangeText={setYeniKasaAd} placeholder="Kasa adı (örn. Merkez Kasa)" placeholderTextColor={colors.textSecondary} />
                <TouchableOpacity onPress={kasaEkle} style={[styles.kaydetBtn, { backgroundColor: colors.primary, marginTop: 0 }]}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>Kasayı Ekle</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setShowKasaEkle(true)} style={{ padding: 14, alignItems: 'center' }}>
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>+ Yeni Kasa Kartı Ekle</Text>
              </TouchableOpacity>
            )}
          </View>
          </KeyboardAvoidingView>
        </View>
      )}

      {/* Toast */}
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
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  turGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  turChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5,
  },
  secBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 13, borderRadius: 10, borderWidth: 1.5,
  },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14 },
  cekBox: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 14 },
  resimBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'center',
    padding: 12, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed',
  },
  kaydetBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: 15, borderRadius: 12, marginTop: 20,
  },
  islemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 8,
  },
  durumBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 999, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, paddingVertical: 12, paddingBottom: 28 },
  sheetTitle: { fontSize: 16, fontWeight: '800', paddingHorizontal: 16, marginBottom: 10 },
  sheetRow: { paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1 },
  toast: {
    position: 'absolute', bottom: 30, left: 20, right: 20,
    padding: 14, borderRadius: 12, alignItems: 'center', zIndex: 10000,
  },
});
