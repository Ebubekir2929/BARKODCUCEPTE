/**
 * Lokasyon İptal Fişleri modalı — dashboard.tsx'ten çıkarıldı (2026-08 refactor).
 * Seçilen lokasyonun iptal özetini ve POS'tan çekilen iptal fiş listesini gösterir.
 */
import React from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { webStyles } from '../../styles/webModalStyles';
import { modalStyles as ms } from './dashboardModalStyles';

interface Props {
  visible: boolean;
  onClose: () => void;
  location: string;
  items: any[];
  loading: boolean;
  iptalOzet: any[];
  colors: any;
  isDesktop: boolean;
  t: (k: any) => string;
  onOpenDetail: (iptalId: string) => void;
}

export function LocationIptalModal({
  visible, onClose, location, items, loading, iptalOzet, colors, isDesktop, t, onOpenDetail,
}: Props) {
  return (
    <Modal visible={visible} animationType={Platform.OS === 'web' && isDesktop ? 'fade' : 'slide'} transparent statusBarTranslucent={Platform.OS === 'android'} onRequestClose={onClose}>
      <View style={[ms.modalOverlay, Platform.OS === 'web' && isDesktop && webStyles.overlayDesktop]}>
        <View style={[ms.modalContent, Platform.OS === 'web' && isDesktop && [webStyles.cardDesktopWide, { borderColor: colors.border, maxWidth: 900, backgroundColor: colors.surface }]]}>
          <View style={[ms.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }]}>
            <Text style={[ms.modalTitle, { color: colors.text }]}>
              {location} - İptal Fişleri
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView style={[ms.modalBody, { backgroundColor: colors.surface }]} contentContainerStyle={ms.modalBodyContent} nestedScrollEnabled bounces showsVerticalScrollIndicator>
            {/* Özet */}
            {(() => {
              const locOzetRows = (iptalOzet || []).filter(
                (o: any) => o.LOKASYON && o.LOKASYON === location
              );
              const totalFisTutar = locOzetRows.reduce((s: number, o: any) => s + parseFloat(o.FIS_IPTAL_TUTAR || '0'), 0);
              const totalSatirTutar = locOzetRows.reduce((s: number, o: any) => s + parseFloat(o.SATIR_IPTAL_TUTAR || '0'), 0);
              const totalFisAdet = locOzetRows.reduce((s: number, o: any) => s + parseInt(o.FIS_IPTAL_ADET || '0'), 0);
              const totalSatirAdet = locOzetRows.reduce((s: number, o: any) => s + parseInt(o.SATIR_IPTAL_ADET || '0'), 0);

              return (
                <View style={[st.cancellationSummary, { backgroundColor: colors.error + '15' }]}>
                  <Ionicons name="alert-circle" size={24} color={colors.error} />
                  <View style={st.cancellationSummaryText}>
                    <Text style={[st.cancellationCount, { color: colors.error }]}>
                      {totalFisAdet + totalSatirAdet} İptal ({totalFisAdet} fiş, {totalSatirAdet} satır)
                    </Text>
                    <Text style={[st.cancellationTotal, { color: colors.text }]}>
                      Toplam: ₺{(totalFisTutar + totalSatirTutar).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                </View>
              );
            })()}

            {/* İptal Fiş Listesi - POS'tan çekilmiş */}
            {loading ? (
              <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                <ActivityIndicator size="large" color={colors.error} />
                <Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>{t('loading_cancellations')}</Text>
              </View>
            ) : items.length > 0 ? (
              // Sort by cancellation date DESC (newest first) — user request 2026-05-02
              [...items]
                .sort((a: any, b: any) => {
                  const ta = String(a.TARIH_IPTAL || a.TARIH || '');
                  const tb = String(b.TARIH_IPTAL || b.TARIH || '');
                  return tb.localeCompare(ta);
                })
                .map((item: any, idx: number) => {
                // Format "2026-05-02 14:09:26" → "02.05.2026 14:09"
                const rawDate = String(item.TARIH_IPTAL || item.TARIH || '').trim();
                let prettyDate = rawDate;
                if (rawDate) {
                  const m = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})[\sT]?(\d{2})?:?(\d{2})?/);
                  if (m) {
                    const [, y, mo, d, hh, mm] = m;
                    prettyDate = hh && mm ? `${d}.${mo}.${y} ${hh}:${mm}` : `${d}.${mo}.${y}`;
                  }
                }
                return (
                <TouchableOpacity
                  key={idx}
                  style={[st.receiptCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => onOpenDetail(String(item.IPTAL_ID))}
                >
                  <View style={st.receiptCardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={[st.receiptCardNo, { color: colors.text }]}>{item.PERSONEL_AD || 'Personel'}</Text>
                      <Text style={[st.receiptCardDate, { color: colors.textSecondary }]}>
                        {item.IPTAL_TIPI || 'İptal'} · {item.DETAY_SATIR_SAYISI || 0} satır
                      </Text>
                      {!!prettyDate && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                          <Ionicons name="calendar-outline" size={12} color={colors.primary} />
                          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }} numberOfLines={1}>{prettyDate}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[st.receiptCardAmount, { color: colors.error }]}>
                      ₺{parseFloat(item.TUTAR || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={st.receiptCardFooter}>
                    <Text style={[st.receiptCardReason, { color: colors.textSecondary }]} numberOfLines={1}>
                      {prettyDate}
                    </Text>
                    <View style={st.receiptCardAction}>
                      <Text style={[st.receiptCardActionText, { color: colors.primary }]}>{t('detail_short')}</Text>
                      <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                    </View>
                  </View>
                </TouchableOpacity>
                );
              })
            ) : (
              <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                <Text style={[{ color: colors.textSecondary }]}>{t('no_cancellation_receipts')}</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  cancellationSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    gap: 12,
  },
  cancellationSummaryText: {
    flex: 1,
  },
  cancellationCount: {
    fontSize: 16,
    fontWeight: '700',
  },
  cancellationTotal: {
    fontSize: 14,
    marginTop: 2,
  },
  receiptCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  receiptCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  receiptCardNo: {
    fontSize: 15,
    fontWeight: '600',
  },
  receiptCardDate: {
    fontSize: 12,
    marginTop: 2,
  },
  receiptCardAmount: {
    fontSize: 16,
    fontWeight: '700',
  },
  receiptCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptCardReason: {
    fontSize: 13,
    flex: 1,
    marginRight: 10,
  },
  receiptCardAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  receiptCardActionText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
