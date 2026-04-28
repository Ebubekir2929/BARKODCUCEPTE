import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// === Garson (POS) + Personel (ERP12) Satışları ===
// Yeni proc dönüşü: SATIR_TIPI (DETAY/LOKASYON_TOPLAM/GENEL_TOPLAM)
//   + ACIK_FIS_TUTARI, KAPANAN_SATIS_TUTARI, TOPLAM_TUTAR
//   + PERAKENDE_FIS_SAYISI, ERP12_FIS_SAYISI, ACIK_FIS_SAYISI, KAPANAN_FIS_SAYISI
//   + TOPLAM_MIKTAR
// Garson = POS (PERAKENDE) tarafında satış yapan
// Personel = ERP12 tarafında fiş kesen
export const WaiterSalesSection: React.FC<{ data: any[] }> = ({ data }) => {
  const { colors } = useThemeStore();
  const [tab, setTab] = useState<'garson' | 'personel'>('garson');
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!data || data.length === 0) return null;

  const fmtTL = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtMiktar = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  // Filter rows based on selected tab
  // - Garson: row has PERAKENDE_FIS_SAYISI > 0 (POS sales)
  // - Personel: row has ERP12_FIS_SAYISI > 0 (ERP12 sales)
  const allDetay = data.filter((r: any) => (r.SATIR_TIPI || 'DETAY') === 'DETAY');
  const garsonRows = allDetay.filter((r: any) => parseInt(r.PERAKENDE_FIS_SAYISI || '0') > 0);
  const personelRows = allDetay.filter((r: any) => parseInt(r.ERP12_FIS_SAYISI || '0') > 0);

  const detayRows = tab === 'garson' ? garsonRows : personelRows;

  // Group by location
  const byLocation: Record<string, any[]> = {};
  detayRows.forEach((r: any) => {
    const loc = r.LOKASYON_AD || 'Bilinmeyen';
    if (!byLocation[loc]) byLocation[loc] = [];
    byLocation[loc].push(r);
  });

  // Compute totals per tab
  const totals = detayRows.reduce(
    (acc, r: any) => {
      const fisAdet = tab === 'garson' ? parseInt(r.PERAKENDE_FIS_SAYISI || '0') : parseInt(r.ERP12_FIS_SAYISI || '0');
      const acik = tab === 'garson' ? parseFloat(r.ACIK_FIS_TUTARI || '0') : 0;
      const kapanan = parseFloat(r.KAPANAN_SATIS_TUTARI || '0');
      const acikSay = tab === 'garson' ? parseInt(r.ACIK_FIS_SAYISI || '0') : 0;
      const kapananSay = tab === 'garson' ? parseInt(r.KAPANAN_FIS_SAYISI || '0') : fisAdet;
      const miktar = parseFloat(r.TOPLAM_MIKTAR || '0');
      acc.fis += fisAdet;
      acik && (acc.acik += acik);
      acc.kapanan += kapanan;
      acc.acikSay += acikSay;
      acc.kapananSay += kapananSay;
      acc.miktar += miktar;
      return acc;
    },
    { fis: 0, acik: 0, kapanan: 0, acikSay: 0, kapananSay: 0, miktar: 0 }
  );
  const totalTutar = totals.acik + totals.kapanan;

  const tabColor = tab === 'garson' ? '#10B981' : '#8B5CF6';

  return (
    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.sectionHeader, { paddingBottom: 8 }]}>
        <Text style={[styles.sectionTitle, { color: colors.text, flex: 1 }]} numberOfLines={1}>Garson / Personel Satışları</Text>
      </View>

      {/* Tab Switcher */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        <TouchableOpacity
          onPress={() => { setTab('garson'); setExpanded(null); }}
          style={{
            flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
            backgroundColor: tab === 'garson' ? '#10B981' : colors.background,
            borderWidth: 1, borderColor: tab === 'garson' ? '#10B981' : colors.border,
          }}
        >
          <Text style={{ color: tab === 'garson' ? '#FFF' : colors.text, fontWeight: '700', fontSize: 12 }}>
            🍽️ Garson (POS) · {garsonRows.length}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { setTab('personel'); setExpanded(null); }}
          style={{
            flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
            backgroundColor: tab === 'personel' ? '#8B5CF6' : colors.background,
            borderWidth: 1, borderColor: tab === 'personel' ? '#8B5CF6' : colors.border,
          }}
        >
          <Text style={{ color: tab === 'personel' ? '#FFF' : colors.text, fontWeight: '700', fontSize: 12 }}>
            👔 Personel (ERP12) · {personelRows.length}
          </Text>
        </TouchableOpacity>
      </View>

      {detayRows.length === 0 ? (
        <View style={{ padding: 16, alignItems: 'center' }}>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {tab === 'garson' ? 'POS garson satışı yok' : 'ERP12 personel satışı yok'}
          </Text>
        </View>
      ) : (
        <>
          {/* Tab özet — kişi+toplam buraya inline geldi (üstte yer kazanma) */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: tabColor + '22', borderWidth: 1, borderColor: tabColor + '55' }}>
              <Ionicons name="people-outline" size={11} color={tabColor} />
              <Text style={{ fontSize: 11, fontWeight: '800', color: tabColor }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {detayRows.length} kişi · ₺{fmtTL(totalTutar)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: tabColor + '15' }}>
              <Ionicons name="receipt-outline" size={11} color={tabColor} />
              <Text style={{ fontSize: 11, fontWeight: '700', color: tabColor }}>{totals.fis} fiş</Text>
            </View>
            {tab === 'garson' && totals.acikSay > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: '#F59E0B15' }}>
                <Ionicons name="time-outline" size={11} color="#F59E0B" />
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#F59E0B' }}>{totals.acikSay} açık · ₺{fmtTL(totals.acik)}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: '#10B98115' }}>
              <Ionicons name="checkmark-circle-outline" size={11} color="#10B981" />
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#10B981' }}>{totals.kapananSay} kapanan · ₺{fmtTL(totals.kapanan)}</Text>
            </View>
            {totals.miktar > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.primary + '15' }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.primary }}>{fmtMiktar(totals.miktar)} ürün</Text>
              </View>
            )}
          </View>

          {Object.entries(byLocation).map(([loc, kisiler]) => {
            const locTutar = kisiler.reduce((s: number, r: any) => {
              const a = tab === 'garson' ? parseFloat(r.ACIK_FIS_TUTARI || '0') : 0;
              const k = parseFloat(r.KAPANAN_SATIS_TUTARI || '0');
              return s + a + k;
            }, 0);
            const locFis = kisiler.reduce((s: number, r: any) =>
              s + (tab === 'garson' ? parseInt(r.PERAKENDE_FIS_SAYISI || '0') : parseInt(r.ERP12_FIS_SAYISI || '0')), 0);
            return (
              <View key={loc}>
                <TouchableOpacity
                  style={[styles.groupHeader, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setExpanded(expanded === loc ? null : loc)}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, paddingRight: 8 }}>
                    <Ionicons name={tab === 'garson' ? 'restaurant-outline' : 'briefcase-outline'} size={18} color={tabColor} />
                    <Text style={[styles.groupName, { color: colors.text, flexShrink: 1 }]} numberOfLines={1}>{loc}</Text>
                    <View style={[styles.countBadge, { backgroundColor: tabColor + '15' }]}>
                      <Text style={[styles.countText, { color: tabColor }]}>{kisiler.length}</Text>
                    </View>
                    <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: tabColor + '15' }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: tabColor }} numberOfLines={1}>{locFis} fiş</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 140 }}>
                    <Text style={[styles.groupTotal, { color: colors.text, fontWeight: '700' }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                      ₺{fmtTL(locTutar)}
                    </Text>
                    <Ionicons name={expanded === loc ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
                  </View>
                </TouchableOpacity>

                {expanded === loc && kisiler.map((g: any, idx: number) => {
                  const fisAdet = tab === 'garson' ? parseInt(g.PERAKENDE_FIS_SAYISI || '0') : parseInt(g.ERP12_FIS_SAYISI || '0');
                  const acikTutar = tab === 'garson' ? parseFloat(g.ACIK_FIS_TUTARI || '0') : 0;
                  const acikAdet = tab === 'garson' ? parseInt(g.ACIK_FIS_SAYISI || '0') : 0;
                  const kapananTutar = parseFloat(g.KAPANAN_SATIS_TUTARI || '0');
                  const kapananAdet = tab === 'garson' ? parseInt(g.KAPANAN_FIS_SAYISI || '0') : fisAdet;
                  const miktar = parseFloat(g.TOPLAM_MIKTAR || '0');
                  const totalTuar = acikTutar + kapananTutar;
                  return (
                    <View key={idx} style={[styles.itemCard, { backgroundColor: colors.background, borderColor: colors.border, marginLeft: 12 }]}>
                      <View style={styles.itemRow}>
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>{g.GARSON_AD || (tab === 'garson' ? 'Garson' : 'Personel')}</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                            <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: tabColor + '15' }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: tabColor }}>{fisAdet} fiş</Text>
                            </View>
                            {tab === 'garson' && acikAdet > 0 && (
                              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: '#F59E0B15' }}>
                                <Text style={{ fontSize: 10, fontWeight: '700', color: '#F59E0B' }}>
                                  {acikAdet} açık ₺{fmtTL(acikTutar)}
                                </Text>
                              </View>
                            )}
                            {kapananAdet > 0 && (
                              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: '#10B98115' }}>
                                <Text style={{ fontSize: 10, fontWeight: '700', color: '#10B981' }}>
                                  {kapananAdet} kapanan
                                </Text>
                              </View>
                            )}
                            {miktar > 0 && (
                              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: colors.warning + '15' }}>
                                <Text style={{ fontSize: 10, fontWeight: '700', color: colors.warning }}>
                                  {fmtMiktar(miktar)} ürün
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>
                        <Text style={[styles.itemAmount, { color: tabColor, maxWidth: 120 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                          ₺{fmtTL(totalTuar)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </>
      )}
    </View>
  );
};

// === İptal Fişleri Bölümü ===
export const CancellationSection: React.FC<{ ozet: any[]; detay: any[]; tenantId: string }> = ({ ozet, detay, tenantId }) => {
  const { colors } = useThemeStore();
  const [selectedIptal, setSelectedIptal] = useState<any | null>(null);
  const [iptalItems, setIptalItems] = useState<any[]>([]);
  const [iptalLoading, setIptalLoading] = useState(false);

  if ((!ozet || ozet.length === 0) && (!detay || detay.length === 0)) return null;

  const totalFisTutar = (ozet || []).reduce((s: number, r: any) => s + parseFloat(r.FIS_IPTAL_TUTAR || '0'), 0);
  const totalSatirTutar = (ozet || []).reduce((s: number, r: any) => s + parseFloat(r.SATIR_IPTAL_TUTAR || '0'), 0);

  const fetchIptalDetail = useCallback(async (iptalId: string, item: any) => {
    setSelectedIptal(item);
    setIptalItems([]);
    setIptalLoading(true);
    
    try {
      const { token } = useAuthStore.getState();
      const response = await fetch(`${API_URL}/api/data/iptal-detail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId, iptal_id: iptalId }),
      });
      const data = await response.json();
      if (data.ok && data.data) setIptalItems(data.data);
    } catch (err) {
      console.error('Iptal detail error:', err);
    } finally {
      setIptalLoading(false);
    }
  }, [tenantId]);

  return (
    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>İptal Fişleri</Text>
        {totalFisTutar > 0 && (
          <View style={[styles.badge, { backgroundColor: '#EF4444' + '15' }]}>
            <Text style={[styles.badgeText, { color: '#EF4444' }]}>₺{totalFisTutar.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</Text>
          </View>
        )}
      </View>

      {/* İptal Listesi */}
      {(detay || []).filter((d: any) => d.IPTAL_ID).map((item: any, idx: number) => (
        <TouchableOpacity
          key={idx}
          style={[styles.itemCard, { backgroundColor: colors.background, borderColor: colors.border }]}
          onPress={() => fetchIptalDetail(String(item.IPTAL_ID), item)}
        >
          <View style={styles.itemRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemName, { color: colors.text }]}>{item.PERSONEL_AD || 'Personel'}</Text>
              <Text style={[styles.itemSub, { color: colors.textSecondary }]}>
                {item.LOKASYON || ''} · {item.IPTAL_TIPI || 'İptal'} · {item.DETAY_SATIR_SAYISI || 0} satır
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.itemAmount, { color: '#EF4444' }]}>₺{parseFloat(item.TUTAR || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </View>
          </View>
        </TouchableOpacity>
      ))}

      {/* İptal Detay Modal */}
      <Modal visible={!!selectedIptal} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>İptal Detayı</Text>
              <TouchableOpacity onPress={() => { setSelectedIptal(null); setIptalItems([]); }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }} contentContainerStyle={{ paddingBottom: 30 }}>
              {selectedIptal && (
                <View style={[styles.detailInfo, { backgroundColor: '#EF4444' + '10' }]}>
                  <Ionicons name="close-circle" size={28} color="#EF4444" />
                  <Text style={[{ fontSize: 16, fontWeight: '700', color: colors.text }]}>{selectedIptal.PERSONEL_AD || 'İptal'}</Text>
                  <Text style={[{ fontSize: 13, color: colors.textSecondary }]}>{selectedIptal.LOKASYON} · {selectedIptal.IPTAL_TIPI}</Text>
                  <Text style={[{ fontSize: 20, fontWeight: '800', color: '#EF4444', marginTop: 4 }]}>₺{parseFloat(selectedIptal.TUTAR || '0').toFixed(2)}</Text>
                </View>
              )}

              {iptalLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>POS'tan veri alınıyor...</Text>
                </View>
              ) : iptalItems.length > 0 ? (
                <View style={[{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginTop: 12 }]}>
                  <View style={[{ flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: colors.background }]}>
                    <Text style={[{ flex: 3, fontSize: 12, fontWeight: '700', color: colors.textSecondary }]}>Ürün</Text>
                    <Text style={[{ flex: 1, fontSize: 12, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' }]}>Miktar</Text>
                    <Text style={[{ flex: 1.5, fontSize: 12, fontWeight: '700', color: colors.textSecondary, textAlign: 'right' }]}>Tutar</Text>
                  </View>
                  {iptalItems.map((item: any, idx: number) => (
                    <View key={idx} style={[{ flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.border }]}>
                      <View style={{ flex: 3 }}>
                        <Text style={[{ fontSize: 14, fontWeight: '600', color: colors.text }]}>{item.STOK_ADI || 'Ürün'}</Text>
                        <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>Masa: {item.MASA || '-'} · {item.SAAT || ''}</Text>
                      </View>
                      <Text style={[{ flex: 1, fontSize: 14, color: colors.text, textAlign: 'center' }]}>{parseFloat(item.MIKTAR || '0').toFixed(0)}</Text>
                      <Text style={[{ flex: 1.5, fontSize: 14, fontWeight: '700', color: '#EF4444', textAlign: 'right' }]}>₺{parseFloat(item.SATIR_TUTAR || '0').toFixed(2)}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 20, marginTop: 12 }}>
                  <Text style={[{ color: colors.textSecondary }]}>Detay bilgisi bulunamadı</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

// === Lokasyon Bazlı Saatlik Satış Grafiği (Dikey Bar Chart) ===
// Yeni: GET_HOURLY_STOCK_DETAIL proc'undan veri alır (post-discount KDV_DAHIL_TOPLAM_TUTAR)
// böylece 'Lokasyon Özeti' ile tutarlı totaller olur ve ERP12 + iskonto da dahil edilir.
export const HourlyLocationSection: React.FC<{
  data: any[];
  tenantId: string;
  filterDate?: string;
  filterEndDate?: string;
  branchTotalsByName?: Record<string, number>;
}> = ({ data, tenantId, filterDate, filterEndDate, branchTotalsByName }) => {
  const { colors } = useThemeStore();
  const [detailData, setDetailData] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [expandedLoc, setExpandedLoc] = useState<string | null>(null);
  // Derived data from /hourly-detail-full (preferred over `data` prop)
  const [derivedData, setDerivedData] = useState<any[] | null>(null);

  // Fetch full hourly stock detail and aggregate by (LOKASYON, SAAT_ADI)
  useEffect(() => {
    if (!tenantId || !filterDate) return;
    let cancelled = false;
    (async () => {
      try {
        const { token } = useAuthStore.getState();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 60000);
        const resp = await fetch(`${API_URL}/api/data/hourly-detail-full`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          signal: ctrl.signal,
          body: JSON.stringify({
            tenant_id: tenantId,
            date: filterDate,
            edate: filterEndDate || filterDate,
            lokasyon_id: null,
          }),
        });
        clearTimeout(timer);
        if (!resp.ok) return;
        const j = await resp.json();
        const byHour: Record<string, any[]> = j?.by_hour || {};
        const aggMap: Record<string, any> = {};
        Object.entries(byHour).forEach(([hour, rows]) => {
          rows.forEach((r: any) => {
            const loc = r.LOKASYON || 'Bilinmeyen';
            const locId = r.LOKASYON_ID || null;
            const key = `${loc}__${hour}`;
            if (!aggMap[key]) {
              aggMap[key] = {
                LOKASYON: loc,
                LOKASYON_ID: locId,
                SAAT_ADI: hour,
                TOPLAM: 0,
                BRUT_TOPLAM: 0,
                ISKONTO: 0,
                PERAKENDE_TOPLAM: 0,
                ERP12_TOPLAM: 0,
                SATIR_SAYISI: 0,
              };
            }
            aggMap[key].TOPLAM += parseFloat(r.KDV_DAHIL_TOPLAM_TUTAR || '0');
            aggMap[key].BRUT_TOPLAM += parseFloat(r.BRUT_KDV_DAHIL_TOPLAM_TUTAR || '0');
            aggMap[key].ISKONTO += parseFloat(r.GENEL_ISKONTO_TUTARI || '0');
            aggMap[key].PERAKENDE_TOPLAM += parseFloat(r.PERAKENDE_KDV_DAHIL_TOPLAM_TUTAR || '0');
            aggMap[key].ERP12_TOPLAM += parseFloat(r.ERP12_KDV_DAHIL_TOPLAM_TUTAR || '0');
            aggMap[key].SATIR_SAYISI += parseInt(r.SATIR_SAYISI || '0');
          });
        });
        if (!cancelled) setDerivedData(Object.values(aggMap));
      } catch {
        // silently fall back to prop data
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId, filterDate, filterEndDate]);

  const effectiveData = derivedData ?? data;
  if (!effectiveData || effectiveData.length === 0) return null;

  // Group by LOKASYON
  const byLocation: Record<string, any[]> = {};
  effectiveData.forEach((r: any) => {
    const loc = r.LOKASYON || 'Bilinmeyen';
    if (!byLocation[loc]) byLocation[loc] = [];
    byLocation[loc].push(r);
  });

  const getLocTotal = (loc: string, rows: any[]): number => {
    if (branchTotalsByName && branchTotalsByName[loc] != null) {
      return branchTotalsByName[loc];
    }
    return rows.reduce((s: number, r: any) => s + parseFloat(r.TOPLAM || '0'), 0);
  };
  const totalAmount = Object.entries(byLocation).reduce(
    (s, [loc, rows]) => s + getLocTotal(loc, rows),
    0
  );

  const fetchDetail = useCallback(async (hourLabel: string, lokasyonId: any, lokasyonName: string, hourAmount: number) => {
    setSelectedItem({ hourLabel, lokasyonName, hourAmount });
    setDetailData([]);
    setDetailLoading(true);
    
    try {
      const { token } = useAuthStore.getState();
      const response = await fetch(`${API_URL}/api/data/hourly-detail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          tenant_id: tenantId,
          hour_label: hourLabel,
          lokasyon_id: lokasyonId || null,
          ...(filterDate ? { date: filterDate } : {}),
        }),
      });
      const result = await response.json();
      if (result.ok && result.data) setDetailData(result.data);
    } catch (err) {
      console.error('Hourly detail error:', err);
    } finally {
      setDetailLoading(false);
    }
  }, [tenantId, filterDate]);

  return (
    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Lokasyon Saatlik Satışlar</Text>
        <View style={[styles.badge, { backgroundColor: colors.primary + '15' }]}>
          <Text style={[styles.badgeText, { color: colors.primary }]}>₺{totalAmount.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>
        </View>
      </View>

      {Object.entries(byLocation).map(([locName, hours]) => {
        const locTotal = getLocTotal(locName, hours);
        const locMax = Math.max(...hours.map((r: any) => parseFloat(r.TOPLAM || '0')), 1);
        const isExpanded = expandedLoc === locName;
        
        return (
          <View key={locName}>
            <TouchableOpacity
              style={[styles.groupHeader, { backgroundColor: isExpanded ? colors.primary + '08' : colors.background, borderColor: colors.border }]}
              onPress={() => setExpandedLoc(isExpanded ? null : locName)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="location-outline" size={18} color={colors.primary} />
                <Text style={[styles.groupName, { color: colors.text }]}>{locName}</Text>
                <View style={[styles.countBadge, { backgroundColor: colors.primary + '15' }]}>
                  <Text style={[styles.countText, { color: colors.primary }]}>{hours.length} saat</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[styles.groupTotal, { color: colors.textSecondary }]}>
                  ₺{locTotal.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </Text>
                <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>

            {isExpanded && (
              <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 4, paddingBottom: 2 }}>
                  <Ionicons name="swap-horizontal" size={11} color={colors.textSecondary} />
                  <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '600', fontStyle: 'italic' }}>
                    ← Yana kaydırın →
                  </Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingVertical: 8, gap: 4, minHeight: 180 }}>
                    {hours.map((hour: any, idx: number) => {
                      const amount = parseFloat(hour.TOPLAM || '0');
                      const barHeight = Math.max((amount / locMax) * 130, 4);
                      return (
                        <TouchableOpacity
                          key={idx}
                          style={{ alignItems: 'center', width: 42 }}
                          onPress={() => fetchDetail(hour.SAAT_ADI || '', hour.LOKASYON_ID || null, locName, amount)}
                        >
                          <Text style={{ fontSize: 9, color: colors.textSecondary, marginBottom: 2 }}>
                            {amount >= 1000 ? `${(amount / 1000).toFixed(0)}K` : amount.toFixed(0)}
                          </Text>
                          <View style={{ width: 24, height: barHeight, borderRadius: 6, backgroundColor: colors.primary + '70' }} />
                          <Text style={{ fontSize: 9, color: colors.textSecondary, marginTop: 3 }}>
                            {(hour.SAAT_ADI || '').slice(0, 5)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
                <Text style={{ fontSize: 11, color: colors.textSecondary, textAlign: 'center', marginTop: 4 }}>
                  Saate dokunarak ürün detayı görüntüleyin
                </Text>
              </View>
            )}
          </View>
        );
      })}

      {/* Detail Modal */}
      <Modal visible={!!selectedItem} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Saatlik Ürün Detayı</Text>
              <TouchableOpacity onPress={() => { setSelectedItem(null); setDetailData([]); }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }} contentContainerStyle={{ paddingBottom: 30 }}>
              {selectedItem && (
                <View style={[styles.detailInfo, { backgroundColor: colors.primary + '10' }]}>
                  <Ionicons name="time" size={28} color={colors.primary} />
                  <Text style={[{ fontSize: 16, fontWeight: '700', color: colors.text }]}>{selectedItem.hourLabel}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Text style={[{ fontSize: 13, color: colors.textSecondary }]}>{selectedItem.lokasyonName}</Text>
                    {typeof selectedItem.hourAmount === 'number' && selectedItem.hourAmount > 0 && (
                      <View style={{ backgroundColor: colors.primary + '15', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>
                          ₺{selectedItem.hourAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {detailLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>POS'tan veri alınıyor...</Text>
                </View>
              ) : detailData.length > 0 ? (
                <View style={[{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginTop: 12 }]}>
                  <View style={[{ flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: colors.background }]}>
                    <Text style={[{ flex: 2.4, fontSize: 12, fontWeight: '700', color: colors.textSecondary }]}>Ürün</Text>
                    <Text style={[{ flex: 0.8, fontSize: 12, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' }]}>Miktar</Text>
                    <Text style={[{ flex: 1.8, fontSize: 12, fontWeight: '700', color: colors.textSecondary, textAlign: 'right' }]}>Tutar</Text>
                  </View>
                  {detailData.map((item: any, idx: number) => {
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
                            <Text style={[{ fontSize: 14, fontWeight: '600', color: colors.text }]} numberOfLines={1}>{item.STOK_ADI || 'Ürün'}</Text>
                            <Text style={[{ fontSize: 11, color: colors.textSecondary }]} numberOfLines={1}>{item.LOKASYON || ''}</Text>
                          </View>
                          <View style={{ flex: 0.8, alignItems: 'center' }}>
                            <Text style={[{ fontSize: 14, color: colors.text }]}>
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
                              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: '#F59E0B20' }}>
                                <Text style={{ fontSize: 10, color: '#F59E0B', fontWeight: '700' }}>İsk: -₺{fmtTL(iskonto)}</Text>
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
                                <Text style={{ fontSize: 10, color: '#8B5CF6', fontWeight: '700' }}>E12: ₺{fmtTL(erp12)}</Text>
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })}
                  {/* Total row */}
                  <View style={[{ flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12, borderTopWidth: 2, borderTopColor: colors.border, backgroundColor: colors.background, alignItems: 'center' }]}>
                    <Text style={[{ flex: 3.2, fontSize: 14, fontWeight: '800', color: colors.text, textAlign: 'right', paddingRight: 12 }]}>Toplam</Text>
                    <Text
                      style={[{ flex: 1.8, fontSize: 15, fontWeight: '800', color: colors.primary, textAlign: 'right' }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                    >
                      ₺{detailData.reduce((sum: number, item: any) => sum + parseFloat(item.KDV_DAHIL_TOPLAM_TUTAR || item.TOPLAM_TUTAR || '0'), 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 20, marginTop: 12 }}>
                  <Text style={[{ color: colors.textSecondary }]}>Detay bilgisi bulunamadı</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { borderRadius: 16, borderWidth: 1, marginHorizontal: 16, marginBottom: 12, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 0 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, marginBottom: 6, marginTop: 6, marginHorizontal: 12 },
  groupName: { fontSize: 14, fontWeight: '700' },
  countBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  countText: { fontSize: 12, fontWeight: '700' },
  groupTotal: { fontSize: 13, fontWeight: '600' },
  itemCard: { borderRadius: 10, borderWidth: 1, marginBottom: 6, marginHorizontal: 12, overflow: 'hidden' },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  itemName: { fontSize: 14, fontWeight: '600' },
  itemSub: { fontSize: 12, marginTop: 2 },
  itemAmount: { fontSize: 15, fontWeight: '700' },
  hourlyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: 1, gap: 8 },
  barTrack: { height: 10, borderRadius: 5, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 5 },
  detailInfo: { alignItems: 'center', padding: 16, borderRadius: 12, gap: 4, marginBottom: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1 },
  modalTitle: { fontSize: 18, fontWeight: '700' },
});
