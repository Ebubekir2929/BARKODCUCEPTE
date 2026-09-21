/**
 * v22 — Hedef Takibi kartı: aylık satış hedefi + ilerleme çubuğu.
 * GET /api/hedef?tenant_id → hedef, gerçekleşen, oran, tempo (beklenen_oran), günlük gereken.
 * Karta dokun → hedef gir/düzenle (satır içi alan, native <Modal> KULLANILMAZ — iOS donması).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleProp, ViewStyle, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';

interface HedefVeri {
  ay: string;
  hedef: number;
  kaynak_ay: string | null;
  gerceklesen: number;
  oran: number | null;
  kalan: number | null;
  gecen_gun: number;
  kalan_gun: number;
  ay_gun: number;
  gunluk_ortalama: number;
  gunluk_gereken: number | null;
  tahmini_ay_sonu: number | null;
  beklenen_oran: number;
  durum: 'tamamlandi' | 'onde' | 'geride' | null;
}

interface Props {
  tenantId: string | null;
  colors: any;
  style?: StyleProp<ViewStyle>;
}

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const AY_ADI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const ayAdi = (ym: string) => AY_ADI[parseInt(ym.slice(5, 7), 10) - 1] || ym;
const fmtTL = (v: number) => (v || 0).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function TargetProgressCard({ tenantId, colors, style }: Props) {
  const [data, setData] = useState<HedefVeri | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [duzenle, setDuzenle] = useState(false);
  const [girdi, setGirdi] = useState('');
  const [kaydediyor, setKaydediyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    if (!tenantId) return;
    setYukleniyor(true);
    try {
      const { token } = useAuthStore.getState();
      const r = await fetch(`${API_URL}/api/hedef?tenant_id=${tenantId}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (j?.ok && j.data) setData(j.data);
    } catch {
      // sessiz
    } finally {
      setYukleniyor(false);
    }
  }, [tenantId]);

  useEffect(() => { yukle(); }, [yukle]);

  const kaydet = async () => {
    if (!tenantId) return;
    const deger = parseFloat(girdi.replace(/\./g, '').replace(',', '.'));
    if (Number.isNaN(deger) || deger < 0) { setHata('Geçerli bir tutar girin'); return; }
    setKaydediyor(true); setHata(null);
    try {
      const { token } = useAuthStore.getState();
      const r = await fetch(`${API_URL}/api/hedef`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId, hedef: deger }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.detail || 'Kaydedilemedi');
      setDuzenle(false);
      await yukle();
    } catch (e: any) {
      setHata(e?.message || 'Kaydedilemedi');
    } finally {
      setKaydediyor(false);
    }
  };

  if (!tenantId) return null;
  const hedefVar = !!data && data.hedef > 0;
  const oran = data?.oran ?? 0;
  const dolu = Math.max(0, Math.min(100, oran));
  const durumRenk = data?.durum === 'tamamlandi' ? colors.success || '#22C55E'
    : data?.durum === 'onde' ? colors.primary
    : data?.durum === 'geride' ? colors.warning || '#F59E0B'
    : colors.textSecondary;
  const durumMetni = data?.durum === 'tamamlandi' ? 'Hedef tamamlandı 🎉'
    : data?.durum === 'onde' ? 'Tempo hedefin önünde'
    : data?.durum === 'geride' ? 'Tempo hedefin gerisinde' : '';

  return (
    <View style={style} testID="hedef-karti">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="flag-outline" size={18} color={colors.primary} />
          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>
            {data ? `${ayAdi(data.ay)} Hedefi` : 'Aylık Hedef'}
          </Text>
        </View>
        <TouchableOpacity
          testID="hedef-duzenle"
          onPress={() => { setGirdi(hedefVar ? String(Math.round(data!.hedef)) : ''); setDuzenle((d) => !d); setHata(null); }}
          hitSlop={8}
          style={{ minHeight: 36, minWidth: 36, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name={duzenle ? 'close' : hedefVar ? 'create-outline' : 'add-circle-outline'} size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {duzenle && (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <TextInput
            testID="hedef-girdi"
            value={girdi}
            onChangeText={setGirdi}
            keyboardType={Platform.OS === 'web' ? 'default' : 'numeric'}
            placeholder="Aylık satış hedefi (₺)"
            placeholderTextColor={colors.textSecondary}
            returnKeyType="done"
            onSubmitEditing={kaydet}
            style={{
              flex: 1, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
              paddingHorizontal: 12, color: colors.text, backgroundColor: colors.background, fontSize: 15,
            }}
          />
          <TouchableOpacity
            testID="hedef-kaydet"
            onPress={kaydet}
            disabled={kaydediyor}
            style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}
          >
            {kaydediyor ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={{ color: '#FFF', fontWeight: '800' }}>Kaydet</Text>}
          </TouchableOpacity>
        </View>
      )}
      {hata && <Text style={{ color: colors.error, fontSize: 12, marginBottom: 8 }}>{hata}</Text>}

      {yukleniyor && !data ? (
        <ActivityIndicator color={colors.primary} />
      ) : !hedefVar ? (
        <TouchableOpacity onPress={() => { setGirdi(''); setDuzenle(true); }} activeOpacity={0.7} style={{ paddingVertical: 6 }}>
          <Text style={{ fontSize: 13, color: colors.textSecondary }}>
            Henüz hedef yok. Bu ay için bir satış hedefi belirleyin; ilerlemenizi burada gün gün izleyin.
          </Text>
        </TouchableOpacity>
      ) : (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
            <View>
              <Text style={{ fontSize: 22, fontWeight: '900', color: colors.text }}>₺{fmtTL(data!.gerceklesen)}</Text>
              <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                hedef ₺{fmtTL(data!.hedef)}{data!.kaynak_ay ? ` (${ayAdi(data!.kaynak_ay)} hedefi devralındı)` : ''}
              </Text>
            </View>
            <Text style={{ fontSize: 20, fontWeight: '900', color: durumRenk }}>%{oran.toFixed(0)}</Text>
          </View>
          {/* İlerleme çubuğu + takvimsel tempo işareti */}
          <View style={{ height: 12, borderRadius: 6, backgroundColor: colors.border, overflow: 'hidden', position: 'relative' }}>
            <View style={{ width: `${dolu}%`, height: '100%', backgroundColor: durumRenk, borderRadius: 6 }} />
            <View style={{ position: 'absolute', left: `${Math.min(99, data!.beklenen_oran)}%`, top: 0, bottom: 0, width: 2, backgroundColor: colors.text, opacity: 0.5 }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
            <Text style={{ fontSize: 11, color: colors.textSecondary }}>{durumMetni}</Text>
            <Text style={{ fontSize: 11, color: colors.textSecondary }}>{`Ayın %${data!.beklenen_oran.toFixed(0)}'i geçti`}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <View style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: colors.background }}>
              <Text style={{ fontSize: 10, color: colors.textSecondary }}>Kalan</Text>
              <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text }}>₺{fmtTL(data!.kalan || 0)}</Text>
            </View>
            <View style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: colors.background }}>
              <Text style={{ fontSize: 10, color: colors.textSecondary }}>Günlük gereken</Text>
              <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text }}>
                {data!.gunluk_gereken != null ? `₺${fmtTL(data!.gunluk_gereken)}` : '—'}
              </Text>
            </View>
            <View style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: colors.background }}>
              <Text style={{ fontSize: 10, color: colors.textSecondary }}>Ay sonu tahmini</Text>
              <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text }}>
                {data!.tahmini_ay_sonu != null ? `₺${fmtTL(data!.tahmini_ay_sonu)}` : '—'}
              </Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}
