/**
 * Kart Tipi (Nakit/Kart/Açık Hesap/Toplam) lokasyon dağılımı modalı —
 * dashboard.tsx'ten çıkarıldı (2026-08 refactor). Görsel/işlev birebir aynı.
 */
import React from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity, Pressable,
  Platform, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { webStyles } from '../../styles/webModalStyles';
import { AcikHesapKisiDetail } from '../AcikHesapKisiDetail';
import { modalStyles as ms } from './dashboardModalStyles';

interface Props {
  selectedCardType: string | null;
  onClose: () => void;
  sourceData: any;
  totals: Record<string, number>;
  colors: any;
  isDesktop: boolean;
  t: (k: any) => string;
  activeTenantId: string | null;
  sdate: string;
  edate: string;
  getCardTypeLabel: (k: string) => string;
  getCardTypeColor: (k: string) => string;
}

export function CardTypeLocationModal({
  selectedCardType, onClose, sourceData, totals, colors, isDesktop, t,
  activeTenantId, sdate, edate, getCardTypeLabel, getCardTypeColor,
}: Props) {
  return (
    <Modal visible={!!selectedCardType} animationType={Platform.OS === 'web' && isDesktop ? 'fade' : 'slide'} transparent statusBarTranslucent={Platform.OS === 'android'} onRequestClose={onClose}>
      <View style={[ms.modalOverlay, Platform.OS === 'web' && isDesktop && webStyles.overlayDesktop]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[
          ms.modalContent,
          ...(Platform.OS === 'web' && isDesktop ? [webStyles.cardDesktop, { borderColor: colors.border, maxWidth: 560, backgroundColor: colors.surface, alignSelf: 'center' as const }] : []),
        ]}>
          <View style={[ms.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }]}>
            <Text style={[ms.modalTitle, { color: colors.text }]}>
              {getCardTypeLabel(selectedCardType || '')} - {t('location_dist_suffix')}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={[ms.modalBody, { backgroundColor: colors.surface }]}
            contentContainerStyle={ms.modalBodyContent}
            nestedScrollEnabled
            bounces
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
            {(sourceData?.branchSales || []).map((branch: any) => {
              const value = selectedCardType === 'cash' ? branch.sales.cash
                : selectedCardType === 'card' ? branch.sales.card
                : selectedCardType === 'openAccount' ? branch.sales.openAccount
                : branch.sales.total;
              const percentage = (value / totals[selectedCardType || 'total']) * 100;
              return (
                <View key={branch.branchId} style={[st.locationModalItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={st.locationModalInfo}>
                    <View style={[st.locationModalIcon, { backgroundColor: getCardTypeColor(selectedCardType || '') + '20' }]}>
                      <Ionicons name="storefront" size={18} color={getCardTypeColor(selectedCardType || '')} />
                    </View>
                    <View>
                      <Text style={[st.locationModalName, { color: colors.text }]}>{branch.branchName}</Text>
                      <Text style={[st.locationModalPercent, { color: colors.textSecondary }]}>
                        %{percentage.toFixed(1)} pay
                      </Text>
                    </View>
                  </View>
                  <Text style={[st.locationModalValue, { color: getCardTypeColor(selectedCardType || '') }]}>
                    ₺{value.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
              );
            })}
            <View style={[st.totalRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[st.totalLabel, { color: colors.text }]}>{t('total_short')}</Text>
              <Text style={[st.totalValue, { color: getCardTypeColor(selectedCardType || '') }]}>
                ₺{totals[selectedCardType || 'total'].toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              </Text>
            </View>

            {/* ERP12 vs Perakende Breakdown for cash/card */}
            {(selectedCardType === 'cash' || selectedCardType === 'card') && sourceData?.financialBreakdown && (() => {
              const fb = sourceData.financialBreakdown;
              const breakdown = selectedCardType === 'cash' ? fb.nakit : fb.krediKarti;
              const ckColor = getCardTypeColor(selectedCardType);
              if (breakdown.total === 0) return null;
              const perakendePct = breakdown.total > 0 ? (breakdown.perakende / breakdown.total) * 100 : 0;
              const erp12Pct = breakdown.total > 0 ? (breakdown.erp12 / breakdown.total) * 100 : 0;
              return (
                <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 10 }}>
                    Satış Türü Kırılımı
                  </Text>
                  {/* Perakende */}
                  <View style={{ marginBottom: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' }} />
                        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>Perakende</Text>
                        <Text style={{ fontSize: 11, color: colors.textSecondary }}>%{perakendePct.toFixed(1)}</Text>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: '#10B981' }}>
                        ₺{breakdown.perakende.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                      </Text>
                    </View>
                    <View style={{ height: 4, backgroundColor: '#10B98122', borderRadius: 2 }}>
                      <View style={{ width: `${Math.max(perakendePct, 1)}%`, height: '100%', backgroundColor: '#10B981', borderRadius: 2 }} />
                    </View>
                  </View>
                  {/* Fiş Fatura Satışı (eski adı: ERP12) */}
                  <View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#8B5CF6' }} />
                        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>Fiş Fatura Satışı</Text>
                        <Text style={{ fontSize: 11, color: colors.textSecondary }}>%{erp12Pct.toFixed(1)}</Text>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: '#8B5CF6' }}>
                        ₺{breakdown.erp12.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                      </Text>
                    </View>
                    <View style={{ height: 4, backgroundColor: '#8B5CF622', borderRadius: 2 }}>
                      <View style={{ width: `${Math.max(erp12Pct, 1)}%`, height: '100%', backgroundColor: '#8B5CF6', borderRadius: 2 }} />
                    </View>
                  </View>

                  {/* Fiş Sayısı + İskonto özet chips */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: ckColor + '15' }}>
                      <Ionicons name="receipt-outline" size={11} color={ckColor} />
                      <Text style={{ fontSize: 11, fontWeight: '700', color: ckColor }}>{fb.fisSayisi.total} fiş</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#10B98115' }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#10B981' }}>Perakende: {fb.fisSayisi.perakende}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#8B5CF615' }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#8B5CF6' }}>Fiş Fatura: {fb.fisSayisi.erp12}</Text>
                    </View>
                  </View>
                  {fb.iskonto.total > 0 && (
                    <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: colors.warning + '12', borderWidth: 1, borderColor: colors.warning + '30' }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <Ionicons name="pricetag-outline" size={13} color={colors.warning} />
                          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.warning }}>Toplam İskonto</Text>
                        </View>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: colors.warning }}>
                          ₺{fb.iskonto.total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 11, color: '#10B981' }}>
                          P: ₺{fb.iskonto.perakende.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                        </Text>
                        <Text style={{ fontSize: 11, color: '#8B5CF6' }}>
                          E: ₺{fb.iskonto.erp12.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              );
            })()}
            {/* Açık Hesap için müşteri detayı */}
            {selectedCardType === 'openAccount' && activeTenantId && (
              <AcikHesapKisiDetail
                visible
                tenantId={activeTenantId}
                sdate={sdate}
                edate={edate}
              />
            )}

            {/* Geçen hafta karşılaştırma */}
            {(() => {
              const lw = sourceData?.weeklyComparison?.lastWeek;
              const lwValue = selectedCardType === 'cash' ? (lw?.cash || 0) : selectedCardType === 'card' ? (lw?.card || 0) : selectedCardType === 'openAccount' ? (lw?.openAccount || 0) : (lw?.total || 0);
              const currentValue = totals[selectedCardType || 'total'];
              const diff = currentValue - lwValue;
              const pct = lwValue > 0 ? ((diff / lwValue) * 100) : 0;
              return lwValue > 0 ? (
                <View>
                  <View style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, marginTop: 8, borderRadius: 12, backgroundColor: diff >= 0 ? colors.success + '10' : colors.error + '10' }]}>
                    <View>
                      <Text style={[{ fontSize: 12, color: colors.textSecondary }]}>{t('last_week_label')}</Text>
                      <Text style={[{ fontSize: 16, fontWeight: '700', color: colors.text }]}>₺{lwValue.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[{ fontSize: 12, color: colors.textSecondary }]}>{t('diff_label')}</Text>
                      <Text style={[{ fontSize: 14, fontWeight: '700', color: diff >= 0 ? colors.success : colors.error }]}>
                        {diff >= 0 ? '+' : ''}₺{diff.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
                      </Text>
                    </View>
                  </View>
                  {/* Lokasyon dağılımı - geçen hafta */}
                  {lw?.locations && Object.keys(lw.locations).length > 0 && (
                    <View style={[{ marginTop: 8, borderRadius: 12, padding: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}>
                      <Text style={[{ fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginBottom: 6 }]}>{t('last_week_location_dist')}</Text>
                      {Object.entries(lw.locations as Record<string, any>).map(([locName, locData]: [string, any]) => {
                        const locVal = selectedCardType === 'cash' ? locData.cash : selectedCardType === 'card' ? locData.card : selectedCardType === 'openAccount' ? locData.openAccount : locData.total;
                        return locVal > 0 ? (
                          <View key={locName} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                            <Text style={[{ fontSize: 12, color: colors.text }]}>{locName}</Text>
                            <Text style={[{ fontSize: 12, fontWeight: '600', color: colors.textSecondary }]}>₺{locVal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</Text>
                          </View>
                        ) : null;
                      })}
                    </View>
                  )}
                </View>
              ) : null;
            })()}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  locationModalItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  locationModalInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  locationModalIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  locationModalName: {
    fontSize: 15,
    fontWeight: '600',
  },
  locationModalPercent: {
    fontSize: 12,
  },
  locationModalValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '800',
  },
});
