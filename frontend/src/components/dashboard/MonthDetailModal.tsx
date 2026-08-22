/**
 * Ay Detayı modalı — 6 ay grafiğinde bir aya dokununca o ayın gün gün
 * satış dökümünü gösterir (2026-08). Gün satırına dokununca dashboard
 * o günün özetine geçer (onDayPress).
 */
import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/authStore';
import { webStyles } from '../../styles/webModalStyles';
import { modalStyles as ms } from './dashboardModalStyles';

interface GunVerisi {
  tarih: string;
  toplam: number;
  nakit: number;
  kart: number;
}

interface Props {
  ay: string | null;           // YYYY-MM — null ise kapalı
  onClose: () => void;
  tenantId: string | null;
  colors: any;
  isDesktop: boolean;
  onDayPress?: (tarih: string) => void;
}

const AY_ADI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const GUN_KISA = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const fmtTL = (v: number) => v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function MonthDetailModal({ ay, onClose, tenantId, colors, isDesktop, onDayPress }: Props) {
  const [data, setData] = useState<GunVerisi[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ay || !tenantId) return;
    let iptal = false;
    setLoading(true);
    setData(null);
    (async () => {
      try {
        const { token } = useAuthStore.getState();
        const res = await fetch(
          `${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/api/data/ay-detay?tenant_id=${tenantId}&ay=${ay}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const j = await res.json();
        if (!iptal && j?.ok && Array.isArray(j.data)) setData(j.data);
      } catch {
        // sessiz
      } finally {
        if (!iptal) setLoading(false);
      }
    })();
    return () => { iptal = true; };
  }, [ay, tenantId]);

  if (!ay) return null;
  const baslik = `${AY_ADI[parseInt(ay.slice(5, 7), 10) - 1]} ${ay.slice(0, 4)}`;
  const toplam = (data || []).reduce((s, d) => s + d.toplam, 0);
  const max = Math.max(...(data || []).map((d) => d.toplam), 1);
  const enIyi = (data || []).reduce((b, d) => (d.toplam > b ? d.toplam : b), 0);

  return (
    <Modal visible={!!ay} animationType={Platform.OS === 'web' && isDesktop ? 'fade' : 'slide'} transparent statusBarTranslucent={Platform.OS === 'android'} onRequestClose={onClose}>
      <View style={[ms.modalOverlay, Platform.OS === 'web' && isDesktop && webStyles.overlayDesktop]}>
        <View style={[ms.modalContent, Platform.OS === 'web' && isDesktop && [webStyles.cardDesktop, { borderColor: colors.border, maxWidth: 560, backgroundColor: colors.surface }]]}>
          <View style={[ms.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }]}>
            <View>
              <Text style={[ms.modalTitle, { color: colors.text }]}>{baslik} — Gün Gün Döküm</Text>
              {data && (
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                  Ay toplamı ₺{fmtTL(toplam)}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView style={[ms.modalBody, { backgroundColor: colors.surface }]} contentContainerStyle={ms.modalBodyContent} nestedScrollEnabled bounces showsVerticalScrollIndicator>
            {loading ? (
              <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={{ color: colors.textSecondary, marginTop: 12, fontSize: 14 }}>Yükleniyor...</Text>
              </View>
            ) : data && data.length > 0 ? (
              data.map((d) => {
                const gun = new Date(d.tarih + 'T12:00:00');
                const vurgulu = d.toplam > 0 && d.toplam === enIyi;
                return (
                  <TouchableOpacity
                    key={d.tarih}
                    style={{
                      padding: 12, borderRadius: 12, marginBottom: 8,
                      backgroundColor: colors.card, borderWidth: 1,
                      borderColor: vurgulu ? colors.primary + '60' : colors.border,
                      minHeight: 44,
                    }}
                    onPress={() => onDayPress && d.toplam >= 0 && onDayPress(d.tarih)}
                    disabled={!onDayPress}
                    activeOpacity={0.6}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{
                          width: 40, alignItems: 'center', paddingVertical: 4, borderRadius: 8,
                          backgroundColor: vurgulu ? colors.primary + '18' : colors.background,
                        }}>
                          <Text style={{ fontSize: 15, fontWeight: '900', color: vurgulu ? colors.primary : colors.text }}>
                            {parseInt(d.tarih.slice(8, 10), 10)}
                          </Text>
                          <Text style={{ fontSize: 9, fontWeight: '700', color: colors.textSecondary }}>
                            {GUN_KISA[gun.getDay()]}
                          </Text>
                        </View>
                        {vurgulu && <Ionicons name="trophy" size={14} color={colors.primary} />}
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ fontSize: 15, fontWeight: '800', color: d.toplam > 0 ? colors.primary : colors.textSecondary }}>
                          ₺{fmtTL(d.toplam)}
                        </Text>
                        {(d.nakit > 0 || d.kart > 0) && (
                          <Text style={{ fontSize: 10, color: colors.textSecondary, marginTop: 2 }}>
                            Nakit ₺{fmtTL(d.nakit)} · Kart ₺{fmtTL(d.kart)}
                          </Text>
                        )}
                      </View>
                    </View>
                    {/* Oran barı */}
                    <View style={{ height: 3, backgroundColor: colors.border, borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                      <View style={{
                        width: `${Math.max((d.toplam / max) * 100, d.toplam > 0 ? 2 : 0)}%`,
                        height: '100%',
                        backgroundColor: vurgulu ? colors.primary : colors.primary + '70',
                        borderRadius: 2,
                      }} />
                    </View>
                  </TouchableOpacity>
                );
              })
            ) : (
              <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                <Ionicons name="document-outline" size={32} color={colors.textSecondary} />
                <Text style={{ color: colors.textSecondary, marginTop: 8, fontSize: 14 }}>Bu ay için veri yok</Text>
              </View>
            )}
            {!!onDayPress && !loading && data && data.length > 0 && (
              <Text style={{ fontSize: 10, color: colors.textSecondary, opacity: 0.7, marginTop: 4 }}>
                Bir güne dokunarak o günün dashboard özetine geçebilirsiniz
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
