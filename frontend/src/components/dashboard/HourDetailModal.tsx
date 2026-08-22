/**
 * Saat Detayı modalı — dashboard.tsx'ten çıkarıldı (2026-08 refactor).
 * Seçilen saatin özet, iskonto/KDV kırılımı ve ürün detayını gösterir.
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
  selectedHour: { hour: string; amount: number } | null;
  hourDetailRows: any[];
  hourDetailLoading: boolean;
  colors: any;
  isDesktop: boolean;
  t: (k: any) => string;
}

export function HourDetailModal({
  visible, onClose, selectedHour, hourDetailRows, hourDetailLoading, colors, isDesktop, t,
}: Props) {
  return (
    <Modal visible={visible} animationType={Platform.OS === 'web' && isDesktop ? 'fade' : 'slide'} transparent statusBarTranslucent={Platform.OS === 'android'} onRequestClose={onClose}>
      <View style={[ms.modalOverlay, Platform.OS === 'web' && isDesktop && webStyles.overlayDesktop]}>
        <View style={[ms.modalContent, Platform.OS === 'web' && isDesktop && [webStyles.cardDesktop, { borderColor: colors.border, maxWidth: 720, backgroundColor: colors.surface }]]}>
          <View style={[ms.modalHeader, { borderBottomColor: colors.border, backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }]}>
            <Text style={[ms.modalTitle, { color: colors.text }]}>
              {selectedHour?.hour} Satış Detayı
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          {selectedHour && (
            <ScrollView style={[ms.modalBody, { backgroundColor: colors.surface }]} contentContainerStyle={ms.modalBodyContent} nestedScrollEnabled bounces showsVerticalScrollIndicator>
              {/* Compact Hour Summary — Toplam: filtrelenmiş ürün satırlarından
                  hesapla (aggregate parent şişmelerini önle). Ürün fetch
                  tamamlanmadan önce chart'tan gelen selectedHour.amount
                  kullanılır (loading state). */}
              <View style={[st.hourDetailCompact, { backgroundColor: colors.primary + '10', borderColor: colors.border }]}>
                <View style={st.hourDetailCompactLeft}>
                  <Ionicons name="time-outline" size={28} color={colors.primary} />
                  <View>
                    <Text style={[st.hourDetailTime, { color: colors.text, fontSize: 18 }]}>{selectedHour.hour}</Text>
                    <Text style={[st.hourDetailTx, { color: colors.textSecondary }]}>{t('all_locations_label')}</Text>
                  </View>
                </View>
                <Text style={[st.hourDetailAmount, { color: colors.primary }]}>
                  ₺{(() => {
                    const rowsTotal = hourDetailRows.reduce(
                      (s: number, p: any) => s + parseFloat(p.KDV_DAHIL_TOPLAM_TUTAR || p.TOPLAM_TUTAR || '0'),
                      0,
                    );
                    const displayAmt = rowsTotal > 0 ? rowsTotal : selectedHour.amount;
                    return displayAmt.toLocaleString('tr-TR', { minimumFractionDigits: 2 });
                  })()}
                </Text>
              </View>

              {/* İskonto Bilgisi */}
              {(() => {
                // Sum from procedure fields (GENEL_ISKONTO_TUTARI is post-aggregated discount per row)
                const totalIskonto = hourDetailRows.reduce((s: number, p: any) =>
                  s + parseFloat(p.GENEL_ISKONTO_TUTARI || p.ISKONTO_TUTARI || p.TOPLAM_ISKONTO || '0'), 0);
                const perakendeIskonto = hourDetailRows.reduce((s: number, p: any) =>
                  s + parseFloat(p.PERAKENDE_GENEL_ISKONTO_TUTARI || p.PERAKENDE_ISKONTO_TUTARI || p.PERAKENDE_ISKONTO || '0'), 0);
                const erp12Iskonto = hourDetailRows.reduce((s: number, p: any) =>
                  s + parseFloat(p.ERP12_GENEL_ISKONTO_TUTARI || p.ERP12_ISKONTO_TUTARI || p.ERP12_ISKONTO || '0'), 0);
                // Total KDV
                const totalKdv = hourDetailRows.reduce((s: number, p: any) =>
                  s + parseFloat(p.KDV_TUTARI || p.TOPLAM_KDV || '0'), 0);
                const perakendeKdv = hourDetailRows.reduce((s: number, p: any) =>
                  s + parseFloat(p.PERAKENDE_KDV_TUTARI || p.PERAKENDE_KDV || '0'), 0);
                const erp12Kdv = hourDetailRows.reduce((s: number, p: any) =>
                  s + parseFloat(p.ERP12_KDV_TUTARI || p.ERP12_KDV || '0'), 0);
                if (totalIskonto <= 0 && totalKdv <= 0) return null;
                const fmt = (v: number) => v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {totalIskonto > 0 && (
                      <View style={{ flexBasis: '48%', flexGrow: 1, padding: 10, borderRadius: 10, backgroundColor: colors.warning + '12', borderWidth: 1, borderColor: colors.warning + '30' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Ionicons name="pricetag-outline" size={11} color={colors.warning} />
                          <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '600' }}>Toplam İskonto</Text>
                        </View>
                        <Text style={{ color: colors.warning, fontSize: 14, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                          -₺{fmt(totalIskonto)}
                        </Text>
                        {(perakendeIskonto > 0 || erp12Iskonto > 0) && (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                            {perakendeIskonto > 0 && (
                              <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: '#10B98120' }}>
                                <Text style={{ fontSize: 9, color: '#10B981', fontWeight: '700' }}>P: ₺{fmt(perakendeIskonto)}</Text>
                              </View>
                            )}
                            {erp12Iskonto > 0 && (
                              <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: '#8B5CF620' }}>
                                <Text style={{ fontSize: 9, color: '#8B5CF6', fontWeight: '700' }}>FF: ₺{fmt(erp12Iskonto)}</Text>
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                    )}
                    {totalKdv > 0 && (
                      <View style={{ flexBasis: '48%', flexGrow: 1, padding: 10, borderRadius: 10, backgroundColor: colors.primary + '12', borderWidth: 1, borderColor: colors.primary + '30' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Ionicons name="receipt-outline" size={11} color={colors.primary} />
                          <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '600' }}>Toplam KDV</Text>
                        </View>
                        <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                          ₺{fmt(totalKdv)}
                        </Text>
                        {(perakendeKdv > 0 || erp12Kdv > 0) && (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                            {perakendeKdv > 0 && (
                              <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: '#10B98120' }}>
                                <Text style={{ fontSize: 9, color: '#10B981', fontWeight: '700' }}>P: ₺{fmt(perakendeKdv)}</Text>
                              </View>
                            )}
                            {erp12Kdv > 0 && (
                              <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: '#8B5CF620' }}>
                                <Text style={{ fontSize: 9, color: '#8B5CF6', fontWeight: '700' }}>FF: ₺{fmt(erp12Kdv)}</Text>
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                );
              })()}

              {/* KDV Oranı Bazında Kırılım (Matrah + KDV) */}
              {(() => {
                // Group products by KDV rate, sum matrah and KDV per rate.
                // Matrah is computed from available fields with smart fallbacks:
                //   - Prefer KDV_HARIC_TOPLAM_TUTAR / KDV_HARIC_NET_TUTAR / MATRAH if POS sends them
                //   - Otherwise = KDV_DAHIL_TOPLAM_TUTAR - KDV_TUTARI
                const groups: Record<string, { rate: number; matrah: number; kdv: number; total: number; count: number }> = {};
                let totalMatrah = 0;
                let totalKdvAll = 0;
                for (const p of hourDetailRows as any[]) {
                  const dahil = parseFloat(p.KDV_DAHIL_TOPLAM_TUTAR || p.TOPLAM_TUTAR || '0');
                  const kdv = parseFloat(p.KDV_TUTARI || p.TOPLAM_KDV || '0');
                  let matrah = parseFloat(
                    p.KDV_HARIC_TOPLAM_TUTAR || p.KDV_HARIC_NET_TUTAR || p.MATRAH || p.NET_TUTAR || '0'
                  );
                  if (matrah <= 0) matrah = Math.max(dahil - kdv, 0);
                  if (dahil <= 0 && kdv <= 0 && matrah <= 0) continue;
                  // Try KDV_ORANI field; if missing, infer from kdv/matrah ratio
                  let rateRaw: any = p.KDV_ORANI ?? p.KDV_RATE ?? p.KDV_YUZDESI ?? p.VERGI_ORANI;
                  let rate: number;
                  if (rateRaw !== undefined && rateRaw !== null && rateRaw !== '') {
                    rate = parseFloat(String(rateRaw).replace(',', '.'));
                  } else if (matrah > 0 && kdv > 0) {
                    rate = (kdv / matrah) * 100;
                    // Snap to common Turkish KDV rates: 0, 1, 8, 10, 18, 20
                    const candidates = [0, 1, 8, 10, 18, 20];
                    let best = candidates[0]; let bestDiff = Math.abs(rate - candidates[0]);
                    for (const c of candidates) {
                      const d = Math.abs(rate - c);
                      if (d < bestDiff) { best = c; bestDiff = d; }
                    }
                    if (bestDiff <= 1.5) rate = best;
                    else rate = Math.round(rate);
                  } else {
                    rate = 0;
                  }
                  if (isNaN(rate) || rate < 0) rate = 0;
                  const key = String(rate);
                  if (!groups[key]) groups[key] = { rate, matrah: 0, kdv: 0, total: 0, count: 0 };
                  groups[key].matrah += matrah;
                  groups[key].kdv += kdv;
                  groups[key].total += (matrah + kdv);
                  groups[key].count += 1;
                  totalMatrah += matrah;
                  totalKdvAll += kdv;
                }
                const list = Object.values(groups).sort((a, b) => a.rate - b.rate);
                if (list.length === 0 || (totalMatrah <= 0 && totalKdvAll <= 0)) return null;
                const fmt = (v: number) => v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const grandTotal = totalMatrah + totalKdvAll;
                return (
                  <View style={{ marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                      <Ionicons name="calculator-outline" size={14} color={colors.primary} />
                      <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text }}>
                        KDV Oranı Bazında Kırılım
                      </Text>
                    </View>
                    {/* Header row */}
                    <View style={{ flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <Text style={{ flex: 0.7, fontSize: 10, fontWeight: '700', color: colors.textSecondary }}>Oran</Text>
                      <Text style={{ flex: 1.4, fontSize: 10, fontWeight: '700', color: colors.textSecondary, textAlign: 'right' }}>Matrah</Text>
                      <Text style={{ flex: 1.2, fontSize: 10, fontWeight: '700', color: colors.textSecondary, textAlign: 'right' }}>KDV</Text>
                      <Text style={{ flex: 1.4, fontSize: 10, fontWeight: '700', color: colors.textSecondary, textAlign: 'right' }}>Toplam</Text>
                    </View>
                    {/* Rate rows */}
                    {list.map((g) => (
                      <View
                        key={g.rate}
                        style={{ flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: 'center' }}
                      >
                        <View style={{ flex: 0.7, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <View style={{ backgroundColor: colors.primary + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 }}>
                            <Text style={{ fontSize: 11, fontWeight: '800', color: colors.primary }}>%{g.rate}</Text>
                          </View>
                        </View>
                        <Text style={{ flex: 1.4, fontSize: 12, fontWeight: '700', color: colors.text, textAlign: 'right' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                          ₺{fmt(g.matrah)}
                        </Text>
                        <Text style={{ flex: 1.2, fontSize: 12, fontWeight: '700', color: colors.warning, textAlign: 'right' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                          ₺{fmt(g.kdv)}
                        </Text>
                        <Text style={{ flex: 1.4, fontSize: 12, fontWeight: '800', color: colors.primary, textAlign: 'right' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                          ₺{fmt(g.total)}
                        </Text>
                      </View>
                    ))}
                    {/* Total row */}
                    <View style={{ flexDirection: 'row', paddingTop: 10, alignItems: 'center' }}>
                      <Text style={{ flex: 0.7, fontSize: 11, fontWeight: '800', color: colors.text }}>Toplam</Text>
                      <Text style={{ flex: 1.4, fontSize: 12, fontWeight: '800', color: colors.text, textAlign: 'right' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                        ₺{fmt(totalMatrah)}
                      </Text>
                      <Text style={{ flex: 1.2, fontSize: 12, fontWeight: '800', color: colors.warning, textAlign: 'right' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                        ₺{fmt(totalKdvAll)}
                      </Text>
                      <Text style={{ flex: 1.4, fontSize: 13, fontWeight: '900', color: colors.primary, textAlign: 'right' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                        ₺{fmt(grandTotal)}
                      </Text>
                    </View>
                  </View>
                );
              })()}

              {/* POS Product Detail */}
              <Text style={[{ fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 16, marginBottom: 8 }]}>{t('product_detail')}</Text>

              {hourDetailLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={[{ color: colors.textSecondary, marginTop: 12, fontSize: 14 }]}>{"POS'tan veri alınıyor..."}</Text>
                </View>
              ) : hourDetailRows.length > 0 ? (
                <View style={[{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }]}>
                  <View style={[{ flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: colors.background }]}>
                    <Text style={[{ flex: 2.4, fontSize: 12, fontWeight: '700', color: colors.textSecondary }]}>{t('product')}</Text>
                    <Text style={[{ flex: 0.8, fontSize: 12, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' }]}>{t('quantity_short')}</Text>
                    <Text style={[{ flex: 1.8, fontSize: 12, fontWeight: '700', color: colors.textSecondary, textAlign: 'right' }]}>{t('amount_col')}</Text>
                  </View>
                  {/* 2026-06-12 — hourDetailRows already filtered (memo in parent)
                      Aggregate parent satırları filtre dışı → sum'lar doğru olur */}
                  {hourDetailRows.map((item: any, idx: number) => {
                    const tutar = parseFloat(item.KDV_DAHIL_TOPLAM_TUTAR || item.TOPLAM_TUTAR || '0');
                    const brut = parseFloat(item.BRUT_KDV_DAHIL_TOPLAM_TUTAR || '0');
                    const iskonto = parseFloat(item.GENEL_ISKONTO_TUTARI || item.ISKONTO_TUTARI || '0');
                    const kdv = parseFloat(item.KDV_TUTARI || item.TOPLAM_KDV || '0');
                    const perakende = parseFloat(item.PERAKENDE_KDV_DAHIL_TOPLAM_TUTAR || '0');
                    const erp12 = parseFloat(item.ERP12_KDV_DAHIL_TOPLAM_TUTAR || '0');
                    const birimFiyat = parseFloat(item.BIRIM_FIYAT || item.ORTALAMA_FIYAT || '0');
                    const fmtTL = (v: number) => v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    return (
                      <View key={idx} style={[{ paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.border }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <View style={{ flex: 2.4, paddingRight: 6 }}>
                            <Text style={[{ fontSize: 14, fontWeight: '600', color: colors.text }]} numberOfLines={1}>{item.STOK_ADI || t('product')}</Text>
                            <Text style={[{ fontSize: 11, color: colors.textSecondary }]} numberOfLines={1}>{item.LOKASYON || ''}</Text>
                          </View>
                          <View style={{ flex: 0.8, alignItems: 'center' }}>
                            <Text style={[{ fontSize: 14, fontWeight: '600', color: colors.text }]}>
                              {parseFloat(item.TOPLAM_MIKTAR || '0').toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
                            </Text>
                            {!!(item.BIRIM_ADI || '').trim() && (
                              <Text style={{ fontSize: 9, color: colors.textSecondary, fontWeight: '700' }} numberOfLines={1}>
                                {item.BIRIM_ADI}
                              </Text>
                            )}
                          </View>
                          <Text
                            style={[{ flex: 1.8, fontSize: 13, fontWeight: '700', color: colors.primary, textAlign: 'right' }]}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.7}
                          >
                            ₺{fmtTL(tutar)}
                          </Text>
                        </View>
                        {(brut > 0 || iskonto > 0 || kdv > 0 || perakende > 0 || erp12 > 0 || birimFiyat > 0) && (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                            {birimFiyat > 0 && (
                              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}>
                                <Text style={{ fontSize: 10, color: colors.textSecondary, fontWeight: '600' }}>BF: ₺{fmtTL(birimFiyat)}</Text>
                              </View>
                            )}
                            {brut > 0 && brut !== tutar && (
                              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.textSecondary + '15' }}>
                                <Text style={{ fontSize: 10, color: colors.textSecondary, fontWeight: '700' }}>Brüt: ₺{fmtTL(brut)}</Text>
                              </View>
                            )}
                            {iskonto > 0 && (
                              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.warning + '20' }}>
                                <Text style={{ fontSize: 10, color: colors.warning, fontWeight: '700' }}>İsk: -₺{fmtTL(iskonto)}</Text>
                              </View>
                            )}
                            {kdv > 0 && (
                              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.primary + '15' }}>
                                <Text style={{ fontSize: 10, color: colors.primary, fontWeight: '700' }}>KDV: ₺{fmtTL(kdv)}</Text>
                              </View>
                            )}
                            {perakende > 0 && (
                              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: '#10B98120' }}>
                                <Text style={{ fontSize: 10, color: '#10B981', fontWeight: '700' }}>P: ₺{fmtTL(perakende)}</Text>
                              </View>
                            )}
                            {erp12 > 0 && (
                              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: '#8B5CF620' }}>
                                <Text style={{ fontSize: 10, color: '#8B5CF6', fontWeight: '700' }}>FF: ₺{fmtTL(erp12)}</Text>
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })}
                  {/* Total row */}
                  <View style={[{ flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12, borderTopWidth: 2, borderTopColor: colors.border, backgroundColor: colors.background, alignItems: 'center' }]}>
                    <Text style={[{ flex: 3.2, fontSize: 14, fontWeight: '800', color: colors.text, textAlign: 'right', paddingRight: 12 }]}>{t('total_short')}</Text>
                    <Text
                      style={[{ flex: 1.8, fontSize: 15, fontWeight: '800', color: colors.primary, textAlign: 'right' }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                    >
                      ₺{hourDetailRows.reduce((sum: number, item: any) => sum + parseFloat(item.KDV_DAHIL_TOPLAM_TUTAR || item.TOPLAM_TUTAR || '0'), 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                  <Ionicons name="document-outline" size={32} color={colors.textSecondary} />
                  <Text style={[{ color: colors.textSecondary, marginTop: 8, fontSize: 14 }]}>{t('no_product_detail')}</Text>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  hourDetailCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  hourDetailCompactLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hourDetailTime: {
    fontSize: 28,
    fontWeight: '800',
    marginTop: 12,
  },
  hourDetailAmount: {
    fontSize: 24,
    fontWeight: '700',
    marginTop: 8,
  },
  hourDetailTx: {
    fontSize: 14,
    marginTop: 8,
  },
});
