import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Modal,
  ScrollView, FlatList, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';
import { useLanguageStore } from '../../src/store/languageStore';
import { useDataSourceStore } from '../../src/store/dataSourceStore';
import { ActiveSourceIndicator } from '../../src/components/DataSourceSelector';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

const getDefDates = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return { start: `${y}-01-01`, end: `${y}-${m}-${d}` };
};

export default function CustomersScreen() {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { user } = useAuthStore();
  const { activeSource } = useDataSourceStore();

  const activeTenantId = useMemo(() => {
    if (!user?.tenants || user.tenants.length === 0) return '';
    const match = /^data(\d+)$/.exec(activeSource || '');
    const idx = match ? parseInt(match[1], 10) - 1 : -1;
    if (idx >= 0 && idx < user.tenants.length) return user.tenants[idx].tenant_id || '';
    return user.tenants[0]?.tenant_id || '';
  }, [user?.tenants, activeSource]);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'borclu' | 'alacakli'>('all');
  const [cariList, setCariList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Ekstre
  const [selectedCari, setSelectedCari] = useState<any | null>(null);
  const [extreData, setExtreData] = useState<any[]>([]);
  const [extreLoading, setExtreLoading] = useState(false);
  const [extreStart, setExtreStart] = useState(getDefDates().start);
  const [extreEnd, setExtreEnd] = useState(getDefDates().end);

  // Fiş
  const [selectedFis, setSelectedFis] = useState<any | null>(null);
  const [fisDetail, setFisDetail] = useState<any[]>([]);
  const [fisTotals, setFisTotals] = useState<any | null>(null);
  const [fisLoading, setFisLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const showToast = (msg: string) => { setToastMsg(msg); setToastVisible(true); setTimeout(() => setToastVisible(false), 2000); };

  // Fetch cari list
  useEffect(() => {
    if (!activeTenantId) return;
    const fetch_ = async () => {
      setLoading(true);
      try {
        const { token } = useAuthStore.getState();
        const resp = await fetch(`${API_URL}/api/data/cari-list`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ tenant_id: activeTenantId }),
        });
        const data = await resp.json();
        if (data.ok && data.data) setCariList(data.data);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    fetch_();
  }, [activeTenantId]);

  const filteredCaris = useMemo(() => {
    let f = cariList;
    if (searchQuery) { const q = searchQuery.toLowerCase(); f = f.filter((c: any) => (c.AD || c.CARI_ADI || '').toLowerCase().includes(q) || (c.KOD || c.CARI_KODU || '').toLowerCase().includes(q)); }
    if (filterType === 'borclu') f = f.filter((c: any) => parseFloat(c.BAKIYE || '0') > 0);
    if (filterType === 'alacakli') f = f.filter((c: any) => parseFloat(c.BAKIYE || '0') < 0);
    return f;
  }, [cariList, searchQuery, filterType]);

  const summary = useMemo(() => {
    let borc = 0, alacak = 0;
    cariList.forEach((c: any) => { const b = parseFloat(c.BAKIYE || '0'); if (b > 0) borc += b; else alacak += Math.abs(b); });
    return { borc, alacak, bakiye: borc - alacak, borcluCount: cariList.filter((c: any) => parseFloat(c.BAKIYE || '0') > 0).length, alacakliCount: cariList.filter((c: any) => parseFloat(c.BAKIYE || '0') < 0).length };
  }, [cariList]);

  // Ekstre totals
  const extreSummary = useMemo(() => {
    let borc = 0, alacak = 0;
    extreData.forEach((r: any) => { borc += parseFloat(r.BORC || '0'); alacak += parseFloat(r.ALACAK || '0'); });
    const lastBakiye = extreData.length > 0 ? parseFloat(extreData[extreData.length - 1].BAKIYE || '0') : 0;
    return { borc, alacak, bakiye: lastBakiye };
  }, [extreData]);

  // Open ekstre
  const openCariDetail = useCallback(async (cari: any, sDate?: string, eDate?: string) => {
    setSelectedCari(cari); setExtreData([]); setExtreLoading(true);
    const sd = sDate || extreStart; const ed = eDate || extreEnd;
    const cariId = cari.KART || cari.ID;
    if (!cariId || !activeTenantId) { setExtreLoading(false); return; }
    try {
      const { token } = useAuthStore.getState();
      const resp = await fetch(`${API_URL}/api/data/cari-extre`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: activeTenantId, cari_id: cariId, doviz_ad: cari.DOVIZ_AD_ID || 1, tarih_baslangic: sd, tarih_bitis: ed }),
      });
      const data = await resp.json();
      if (data.ok && data.data) {
        // Sort by date ascending (en eski en üstte)
        const sorted = [...data.data].sort((a: any, b: any) => {
          const da = a.TARIH || ''; const db = b.TARIH || '';
          return da.localeCompare(db);
        });
        setExtreData(sorted);
      }
    } catch (err) { console.error(err); }
    finally { setExtreLoading(false); }
  }, [activeTenantId, extreStart, extreEnd]);

  const refreshExtre = () => { if (selectedCari) openCariDetail(selectedCari, extreStart, extreEnd); };

  // Open fiş detail
  const openFisDetail = useCallback(async (row: any) => {
    const fisId = row.BELGE_ID;
    if (!fisId || !activeTenantId) return;
    setSelectedFis(row); setFisDetail([]); setFisTotals(null); setFisLoading(true);
    try {
      const { token } = useAuthStore.getState();
      const resp = await fetch(`${API_URL}/api/data/fis-detail`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: activeTenantId, fis_id: fisId }),
      });
      const data = await resp.json();
      if (data.ok) {
        // New response: {details: [...], totals: [...]}
        setFisDetail(data.details || []);
        setFisTotals(data.totals && data.totals.length > 0 ? data.totals[0] : null);
      }
    } catch (err) { console.error('Fis detail error:', err); }
    finally { setFisLoading(false); }
  }, [activeTenantId]);

  // Export functions
  const exportExtrePdf = async () => {
    if (!selectedCari || extreData.length === 0) return;
    setExportLoading(true);
    const name = selectedCari.AD || selectedCari.CARI_ADI || t('customer');
    const html = `<html><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;font-size:12px;text-align:left}th{background:#f5f5f5}</style></head><body>
    <h2>${name} - Cari Ekstre</h2><p>${extreStart} / ${extreEnd}</p>
    <p>Toplam Borç: ₺${extreSummary.borc.toFixed(2)} | Toplam Alacak: ₺${extreSummary.alacak.toFixed(2)} | Bakiye: ₺${extreSummary.bakiye.toFixed(2)}</p>
    <table><thead><tr><th>Tarih</th><th>Belge No</th><th>Açıklama</th><th>{t('debt')}</th><th>{t('credit')}</th><th>Bakiye</th></tr></thead><tbody>
    ${extreData.map((r: any) => `<tr><td>${r.TARIH || ''}</td><td>${r.BELGENO || ''}</td><td>${r.ACIKLAMA || r.AD || ''}</td><td>${parseFloat(r.BORC || '0').toFixed(2)}</td><td>${parseFloat(r.ALACAK || '0').toFixed(2)}</td><td>${parseFloat(r.BAKIYE || '0').toFixed(2)}</td></tr>`).join('')}
    </tbody></table></body></html>`;
    try {
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: t('statement_pdf') });
      showToast('PDF oluşturuldu');
    } catch (err) { console.error(err); showToast('PDF oluşturulamadı'); }
    finally { setExportLoading(false); }
  };

  const exportExtreCsv = async () => {
    if (!selectedCari || extreData.length === 0) return;
    setExportLoading(true);
    const name = selectedCari.AD || selectedCari.CARI_ADI || t('customer');
    const html = `<html><head><meta charset="utf-8"><style>table{border-collapse:collapse}th,td{border:1px solid #000;padding:4px;font-size:11px}</style></head><body><h3>${name} - Ekstre</h3><table><thead><tr><th>Tarih</th><th>Belge No</th><th>Açıklama</th><th>{t('debt')}</th><th>{t('credit')}</th><th>Bakiye</th></tr></thead><tbody>${extreData.map((r: any) => `<tr><td>${r.TARIH || ''}</td><td>${r.BELGENO || ''}</td><td>${r.ACIKLAMA || r.AD || ''}</td><td>${parseFloat(r.BORC || '0').toFixed(2)}</td><td>${parseFloat(r.ALACAK || '0').toFixed(2)}</td><td>${parseFloat(r.BAKIYE || '0').toFixed(2)}</td></tr>`).join('')}</tbody></table></body></html>`;
    try {
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `${name} Excel` });
      showToast(t('excel_created'));
    } catch (err) { console.error('Excel error:', err); showToast(t('excel_error')); }
    finally { setExportLoading(false); }
  };

  const renderCariItem = useCallback(({ item }: { item: any }) => {
    const name = item.AD || item.CARI_ADI || t('customer');
    const code = item.KOD || item.CARI_KODU || '';
    const bakiye = parseFloat(item.BAKIYE || '0');
    return (
      <TouchableOpacity style={[styles.cariCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => { setExtreStart(getDefDates().start); setExtreEnd(getDefDates().end); openCariDetail(item, getDefDates().start, getDefDates().end); }} activeOpacity={0.7}>
        <View style={styles.cariCardTop}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cariName, { color: colors.text }]} numberOfLines={1}>{name}</Text>
            <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>{code}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.cariBakiye, { color: bakiye >= 0 ? colors.error : colors.success }]}>₺{Math.abs(bakiye).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</Text>
            <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{bakiye >= 0 ? t('debtor') : t('creditor')}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [colors, openCariDetail]);

  if (!activeTenantId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <ActiveSourceIndicator />
        <View style={styles.emptyContainer}><Ionicons name="people-outline" size={48} color={colors.textSecondary} /><Text style={[{ color: colors.textSecondary }]}>Veri kaynağı seçilmedi</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ActiveSourceIndicator />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('customers')}</Text>
      </View>

      {/* Summary */}
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { backgroundColor: colors.error + '10', borderColor: colors.border }]}>
          <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('debt_total')}</Text>
          <Text style={[{ fontSize: 12, fontWeight: '800', color: colors.error }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>₺{summary.borc.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: colors.success + '10', borderColor: colors.border }]}>
          <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('credit_total')}</Text>
          <Text style={[{ fontSize: 12, fontWeight: '800', color: colors.success }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>₺{summary.alacak.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: colors.primary + '10', borderColor: colors.border }]}>
          <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('balance_short')}</Text>
          <Text style={[{ fontSize: 12, fontWeight: '800', color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>₺{Math.abs(summary.bakiye).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>
        </View>
      </View>

      {/* Filter pills */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 6, marginTop: 6 }}>
        {[{ k: 'all' as const, l: t('all'), c: colors.primary }, { k: 'borclu' as const, l: `${t('debtor')} (${summary.borcluCount})`, c: colors.error }, { k: 'alacakli' as const, l: `${t('creditor')} (${summary.alacakliCount})`, c: colors.success }].map(o => (
          <TouchableOpacity key={o.k} style={[styles.pill, { backgroundColor: filterType === o.k ? o.c + '20' : colors.card, borderColor: filterType === o.k ? o.c : colors.border }]} onPress={() => setFilterType(o.k)}>
            <Text style={[{ fontSize: 11, fontWeight: '600', color: filterType === o.k ? o.c : colors.textSecondary }]}>{o.l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput style={[styles.searchText, { color: colors.text }]} placeholder={t('search_customer_ph')} placeholderTextColor={colors.textSecondary} value={searchQuery} onChangeText={setSearchQuery} />
          {searchQuery ? <TouchableOpacity onPress={() => setSearchQuery('')}><Ionicons name="close-circle" size={18} color={colors.textSecondary} /></TouchableOpacity> : null}
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
        <Text style={[{ fontSize: 12, color: colors.textSecondary }]}>{loading ? t('loading') : `${filteredCaris.length} ${t('customer_count')}`}</Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.primary} /><Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>{t('loading_customers')}</Text></View>
      ) : (
        <FlatList data={filteredCaris} renderItem={renderCariItem} keyExtractor={(item, idx) => String(item.KART || item.ID || idx)} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }} showsVerticalScrollIndicator={false}
          ListEmptyComponent={<View style={styles.emptyContainer}><Ionicons name="people-outline" size={48} color={colors.textSecondary} /><Text style={[{ color: colors.textSecondary }]}>{t('no_customers')}</Text></View>}
        />
      )}

      {/* Ekstre Modal */}
      <Modal visible={!!selectedCari} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>{selectedCari?.AD || selectedCari?.CARI_ADI || t('statement')}</Text>
              <TouchableOpacity onPress={() => { setSelectedCari(null); setExtreData([]); }}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
            </View>

            {/* Date filter */}
            <View style={[styles.dateRow, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('start_placeholder')}</Text>
                <TextInput style={[styles.dateInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]} value={extreStart} onChangeText={setExtreStart} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('end_placeholder')}</Text>
                <TextInput style={[styles.dateInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]} value={extreEnd} onChangeText={setExtreEnd} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textSecondary} />
              </View>
              <TouchableOpacity style={[styles.runBtn, { backgroundColor: colors.primary }]} onPress={refreshExtre}>
                <Ionicons name="refresh" size={16} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* Ekstre Summary */}
            <View style={[styles.extreSummary, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1, alignItems: 'center' }}><Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('debt')}</Text><Text style={[{ fontSize: 14, fontWeight: '800', color: colors.error }]}>₺{extreSummary.borc.toFixed(2)}</Text></View>
              <View style={{ flex: 1, alignItems: 'center' }}><Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('credit')}</Text><Text style={[{ fontSize: 14, fontWeight: '800', color: colors.success }]}>₺{extreSummary.alacak.toFixed(2)}</Text></View>
              <View style={{ flex: 1, alignItems: 'center' }}><Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('balance_short')}</Text><Text style={[{ fontSize: 14, fontWeight: '800', color: colors.primary }]}>₺{extreSummary.bakiye.toFixed(2)}</Text></View>
            </View>

            {/* Export buttons */}
            <View style={[{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6, gap: 8 }]}>
              <TouchableOpacity style={[styles.exportBtn, { backgroundColor: colors.error + '15' }]} onPress={exportExtrePdf}>
                <Ionicons name="document-text-outline" size={14} color={colors.error} /><Text style={[{ fontSize: 11, color: colors.error, fontWeight: '600' }]}>PDF</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}>
              {extreLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}><ActivityIndicator size="large" color={colors.primary} /><Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>{t('loading_statement')}</Text></View>
              ) : extreData.length > 0 ? (
                extreData.map((row: any, idx: number) => {
                  const borc = parseFloat(row.BORC || '0');
                  const alacak = parseFloat(row.ALACAK || '0');
                  const bakiye = parseFloat(row.BAKIYE || '0');
                  const hasFis = row.BELGE_ID && String(row.BELGE_ID).trim() !== '' && String(row.BELGE_ID) !== '0' && String(row.BELGE_ID) !== 'null';
                  return (
                    <TouchableOpacity key={idx} style={[styles.extreRow, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => hasFis ? openFisDetail(row) : null} disabled={!hasFis} activeOpacity={hasFis ? 0.7 : 1}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                        <Text style={[{ fontSize: 11, fontWeight: '600', color: colors.text }]}>{row.TARIH || ''}</Text>
                        <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{row.BELGENO || ''}</Text>
                      </View>
                      <Text style={[{ fontSize: 11, color: colors.textSecondary, marginBottom: 4 }]} numberOfLines={1}>{row.ACIKLAMA || row.AD || '-'}</Text>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <View style={{ flexDirection: 'row', gap: 12 }}>
                          {borc > 0 && <Text style={[{ fontSize: 12, fontWeight: '600', color: colors.error }]}>B: ₺{borc.toFixed(2)}</Text>}
                          {alacak > 0 && <Text style={[{ fontSize: 12, fontWeight: '600', color: colors.success }]}>A: ₺{alacak.toFixed(2)}</Text>}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Text style={[{ fontSize: 12, fontWeight: '700', color: colors.text }]}>₺{bakiye.toFixed(2)}</Text>
                          {hasFis && <Ionicons name="chevron-forward" size={12} color={colors.primary} />}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 30 }}><Text style={[{ color: colors.textSecondary }]}>{t('no_statement')}</Text></View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Fiş Detail Modal */}
      <Modal visible={!!selectedFis} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={() => { setSelectedFis(null); setFisDetail([]); setFisTotals(null); }}><Ionicons name="arrow-back" size={24} color={colors.text} /></TouchableOpacity>
              <Text style={[styles.modalTitle, { color: colors.text, flex: 1, textAlign: 'center' }]}>{t('receipt_detail')}</Text>
              <View style={{ width: 24 }} />
            </View>
            {selectedFis && (
              <View style={[{ padding: 12, backgroundColor: colors.primary + '08', borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                <Text style={[{ fontSize: 13, fontWeight: '600', color: colors.text }]}>{selectedFis.BELGENO || ''}</Text>
                <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>{selectedFis.TARIH || ''} · {selectedFis.ACIKLAMA || ''}</Text>
              </View>
            )}
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}>
              {fisLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}><ActivityIndicator size="large" color={colors.primary} /><Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>{t('loading_receipt')}</Text></View>
              ) : fisDetail.length > 0 ? (
                <>
                  {fisDetail.map((item: any, idx: number) => (
                    <View key={idx} style={[styles.fisRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                        <Text style={[{ fontSize: 12, fontWeight: '600', color: colors.text, flex: 1 }]} numberOfLines={1}>{item.STOK || t('product')}</Text>
                        <Text style={[{ fontSize: 12, fontWeight: '700', color: colors.primary }]}>₺{parseFloat(item.DAHIL_TUTAR || item.TUTAR || '0').toFixed(2)}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{item.BIRIM || ''}</Text>
                        <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('quantity_short')}: {parseFloat(item.MIKTAR_FIS || '0').toFixed(2)}</Text>
                        <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{t('price_short')}: ₺{parseFloat(item.DAHIL_FIYAT || item.FIYAT || '0').toFixed(2)}</Text>
                      </View>
                    </View>
                  ))}
                  {fisTotals && (
                    <View style={[styles.fisTotals, { backgroundColor: colors.primary + '10', borderColor: colors.border }]}>
                      <View style={styles.fisTotalRow}><Text style={[{ color: colors.textSecondary }]}>{t('line_total')}</Text><Text style={[{ fontWeight: '600', color: colors.text }]}>₺{parseFloat(fisTotals.SATIR_TOPLAM || '0').toFixed(2)}</Text></View>
                      <View style={styles.fisTotalRow}><Text style={[{ color: colors.textSecondary }]}>KDV</Text><Text style={[{ fontWeight: '600', color: colors.text }]}>₺{parseFloat(fisTotals.KDV_TOPLAM || '0').toFixed(2)}</Text></View>
                      <View style={[styles.fisTotalRow, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 }]}><Text style={[{ fontSize: 15, fontWeight: '800', color: colors.text }]}>{t('grand_total')}</Text><Text style={[{ fontSize: 16, fontWeight: '800', color: colors.primary }]}>₺{parseFloat(fisTotals.GENELTOPLAM || '0').toFixed(2)}</Text></View>
                    </View>
                  )}
                </>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 30 }}><Text style={[{ color: colors.textSecondary }]}>{t('no_receipt_detail')}</Text></View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
      {/* Export Loading Overlay */}
      {exportLoading && (
        <View style={styles.exportOverlay}>
          <View style={[styles.exportBox, { backgroundColor: colors.card }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[{ color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 12 }]}>{t('exporting')}</Text>
          </View>
        </View>
      )}

      {/* Toast */}
      {toastVisible && (
        <View style={[styles.toast, { backgroundColor: colors.text }]}>
          <Ionicons name="checkmark-circle" size={16} color="#fff" />
          <Text style={[{ color: '#fff', fontSize: 13, fontWeight: '600' }]}>{toastMsg}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  headerTitle: { fontSize: 20, fontWeight: '800' },
  summaryRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 8, gap: 6 },
  summaryCard: { flex: 1, borderRadius: 10, borderWidth: 1, padding: 8, alignItems: 'center' },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  searchContainer: { paddingHorizontal: 16, paddingTop: 8 },
  searchInput: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, gap: 6 },
  searchText: { flex: 1, fontSize: 13 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, gap: 12 },
  cariCard: { borderRadius: 10, borderWidth: 1, marginBottom: 6, overflow: 'hidden' },
  cariCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, gap: 10 },
  cariName: { fontSize: 13, fontWeight: '600' },
  cariBakiye: { fontSize: 15, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', flex: 1 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  modalTitle: { fontSize: 17, fontWeight: '700', flex: 1 },
  dateRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderBottomWidth: 1 },
  dateInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 12, marginTop: 2 },
  runBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  extreSummary: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  extreRow: { marginHorizontal: 12, marginTop: 6, borderRadius: 8, borderWidth: 1, padding: 8 },
  fisRow: { marginHorizontal: 12, marginTop: 6, borderRadius: 8, borderWidth: 1, padding: 8 },
  fisTotals: { margin: 12, borderRadius: 10, borderWidth: 1, padding: 12, gap: 4 },
  fisTotalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  exportOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', zIndex: 9998 },
  exportBox: { borderRadius: 16, padding: 30, alignItems: 'center', minWidth: 200 },
  toast: { position: 'absolute', bottom: 90, left: 20, right: 20, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, zIndex: 9999 },
});
