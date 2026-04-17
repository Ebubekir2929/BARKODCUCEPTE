import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';
import { useDataSourceStore } from '../../src/store/dataSourceStore';
import { ActiveSourceIndicator } from '../../src/components/DataSourceSelector';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export default function CustomersScreen() {
  const { colors } = useThemeStore();
  const { user } = useAuthStore();
  const { activeSource } = useDataSourceStore();

  const activeTenantId = useMemo(() => {
    if (!user?.tenants || user.tenants.length === 0) return '';
    const keys = ['data1', 'data2', 'data3'];
    const idx = keys.indexOf(activeSource);
    if (idx >= 0 && idx < user.tenants.length) return user.tenants[idx].tenant_id || '';
    return user.tenants[0]?.tenant_id || '';
  }, [user?.tenants, activeSource]);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'borclu' | 'alacakli'>('all');
  const [cariList, setCariList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Ekstre modal
  const [selectedCari, setSelectedCari] = useState<any | null>(null);
  const [extreData, setExtreData] = useState<any[]>([]);
  const [extreLoading, setExtreLoading] = useState(false);

  // Fiş detail modal
  const [selectedFis, setSelectedFis] = useState<any | null>(null);
  const [fisDetail, setFisDetail] = useState<any[]>([]);
  const [fisTotals, setFisTotals] = useState<any | null>(null);
  const [fisLoading, setFisLoading] = useState(false);

  // Fetch cari list
  useEffect(() => {
    if (!activeTenantId) return;
    const fetchCariList = async () => {
      setLoading(true);
      try {
        const { token } = useAuthStore.getState();
        const resp = await fetch(`${API_URL}/api/data/cari-list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ tenant_id: activeTenantId }),
        });
        const data = await resp.json();
        if (data.ok && data.data) setCariList(data.data);
      } catch (err) {
        console.error('Cari list error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchCariList();
  }, [activeTenantId]);

  // Filter cari list
  const filteredCaris = useMemo(() => {
    let filtered = cariList;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((c: any) =>
        (c.AD || c.CARI_ADI || '').toLowerCase().includes(q) ||
        (c.KOD || c.CARI_KODU || '').toLowerCase().includes(q)
      );
    }
    if (filterType === 'borclu') {
      filtered = filtered.filter((c: any) => parseFloat(c.BAKIYE || '0') > 0);
    } else if (filterType === 'alacakli') {
      filtered = filtered.filter((c: any) => parseFloat(c.BAKIYE || '0') < 0);
    }
    return filtered;
  }, [cariList, searchQuery, filterType]);

  // Summary
  const summary = useMemo(() => {
    const total = cariList.reduce((s: number, c: any) => s + parseFloat(c.BAKIYE || '0'), 0);
    const borclu = cariList.filter((c: any) => parseFloat(c.BAKIYE || '0') > 0).length;
    const alacakli = cariList.filter((c: any) => parseFloat(c.BAKIYE || '0') < 0).length;
    return { total, borclu, alacakli };
  }, [cariList]);

  // Open cari detail (ekstre)
  const openCariDetail = useCallback(async (cari: any) => {
    setSelectedCari(cari);
    setExtreData([]);
    setExtreLoading(true);

    const cariId = cari.KART || cari.ID;
    if (!cariId || !activeTenantId) {
      setExtreLoading(false);
      return;
    }

    try {
      const { token } = useAuthStore.getState();
      const resp = await fetch(`${API_URL}/api/data/cari-extre`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          tenant_id: activeTenantId,
          cari_id: cariId,
          doviz_ad: cari.DOVIZ_AD_ID || 1,
        }),
      });
      const data = await resp.json();
      if (data.ok && data.data) setExtreData(data.data);
    } catch (err) {
      console.error('Cari extre error:', err);
    } finally {
      setExtreLoading(false);
    }
  }, [activeTenantId]);

  // Open fiş detail
  const openFisDetail = useCallback(async (row: any) => {
    const fisId = row.BELGE_ID;
    if (!fisId || !activeTenantId) return;

    setSelectedFis(row);
    setFisDetail([]);
    setFisTotals(null);
    setFisLoading(true);

    try {
      const { token } = useAuthStore.getState();
      const resp = await fetch(`${API_URL}/api/data/fis-detail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: activeTenantId, fis_id: fisId }),
      });
      const data = await resp.json();
      if (data.ok && data.data) {
        const rows = data.data;
        // Last row often has totals
        const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
        if (lastRow && (lastRow.SATIR_TOPLAM !== undefined || lastRow.GENELTOPLAM !== undefined)) {
          setFisTotals(lastRow);
          setFisDetail(rows.slice(0, -1));
        } else {
          setFisDetail(rows);
        }
      }
    } catch (err) {
      console.error('Fis detail error:', err);
    } finally {
      setFisLoading(false);
    }
  }, [activeTenantId]);

  const renderCariItem = useCallback(({ item }: { item: any }) => {
    const name = item.AD || item.CARI_ADI || 'Cari';
    const code = item.KOD || item.CARI_KODU || '';
    const bakiye = parseFloat(item.BAKIYE || '0');
    const doviz = item.DOVIZ_ADI || 'TL';

    return (
      <TouchableOpacity
        style={[styles.cariCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => openCariDetail(item)}
        activeOpacity={0.7}
      >
        <View style={styles.cariCardTop}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cariName, { color: colors.text }]} numberOfLines={1}>{name}</Text>
            <Text style={[styles.cariCode, { color: colors.textSecondary }]}>{code}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.cariBakiye, { color: bakiye >= 0 ? colors.error : colors.success }]}>
              {bakiye >= 0 ? '' : ''}₺{Math.abs(bakiye).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
            </Text>
            <Text style={[{ fontSize: 10, color: colors.textSecondary }]}>{bakiye >= 0 ? 'Borçlu' : 'Alacaklı'} · {doviz}</Text>
          </View>
        </View>
        <View style={[styles.cariCardBottom, { borderTopColor: colors.border }]}>
          <Text style={[{ fontSize: 12, color: colors.primary }]}>Ekstre Görüntüle</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </View>
      </TouchableOpacity>
    );
  }, [colors, openCariDetail]);

  if (!activeTenantId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <ActiveSourceIndicator />
        <View style={styles.emptyContainer}>
          <Ionicons name="people-outline" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Veri kaynağı seçilmedi</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ActiveSourceIndicator />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Cariler</Text>
      </View>

      {/* Summary Cards */}
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Toplam Bakiye</Text>
          <Text style={[styles.summaryValue, { color: summary.total >= 0 ? colors.error : colors.success }]}>
            ₺{Math.abs(summary.total).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.summaryCard, { backgroundColor: filterType === 'borclu' ? colors.error + '15' : colors.card, borderColor: filterType === 'borclu' ? colors.error : colors.border }]}
          onPress={() => setFilterType(filterType === 'borclu' ? 'all' : 'borclu')}
        >
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Borçlu</Text>
          <Text style={[styles.summaryValue, { color: colors.error }]}>{summary.borclu}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.summaryCard, { backgroundColor: filterType === 'alacakli' ? colors.success + '15' : colors.card, borderColor: filterType === 'alacakli' ? colors.success : colors.border }]}
          onPress={() => setFilterType(filterType === 'alacakli' ? 'all' : 'alacakli')}
        >
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Alacaklı</Text>
          <Text style={[styles.summaryValue, { color: colors.success }]}>{summary.alacakli}</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="search" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchText, { color: colors.text }]}
            placeholder="Cari adı veya kodu ara..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Count */}
      <View style={styles.countRow}>
        <Text style={[styles.countText, { color: colors.textSecondary }]}>
          {loading ? 'Yükleniyor...' : `${filteredCaris.length} cari`}
        </Text>
      </View>

      {/* Loading or List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Cari listesi yükleniyor...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredCaris}
          renderItem={renderCariItem}
          keyExtractor={(item, idx) => String(item.KART || item.ID || idx)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={15}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Cari bulunamadı</Text>
            </View>
          }
        />
      )}

      {/* Cari Ekstre Modal */}
      <Modal visible={!!selectedCari} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>
                {selectedCari?.AD || selectedCari?.CARI_ADI || 'Cari Ekstre'}
              </Text>
              <TouchableOpacity onPress={() => { setSelectedCari(null); setExtreData([]); }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {selectedCari && (
              <View style={[{ padding: 12, backgroundColor: colors.primary + '08', borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                <Text style={[{ fontSize: 13, color: colors.textSecondary }]}>{selectedCari.KOD || selectedCari.CARI_KODU || ''}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <Text style={[{ fontSize: 14, fontWeight: '600', color: colors.text }]}>Bakiye:</Text>
                  <Text style={[{ fontSize: 18, fontWeight: '800', color: parseFloat(selectedCari.BAKIYE || '0') >= 0 ? colors.error : colors.success }]}>
                    ₺{Math.abs(parseFloat(selectedCari.BAKIYE || '0')).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
              </View>
            )}

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}>
              {extreLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>Ekstre yükleniyor...</Text>
                </View>
              ) : extreData.length > 0 ? (
                extreData.map((row: any, idx: number) => {
                  const borc = parseFloat(row.BORC || '0');
                  const alacak = parseFloat(row.ALACAK || '0');
                  const bakiye = parseFloat(row.BAKIYE || '0');
                  const hasBelgeId = row.BELGE_ID && row.BELGE_ID !== '0';

                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[styles.extreRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                      onPress={() => hasBelgeId ? openFisDetail(row) : null}
                      disabled={!hasBelgeId}
                      activeOpacity={hasBelgeId ? 0.7 : 1}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                        <Text style={[{ fontSize: 12, fontWeight: '600', color: colors.text }]}>{row.TARIH || ''}</Text>
                        <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>{row.BELGENO || ''}</Text>
                      </View>
                      <Text style={[{ fontSize: 12, color: colors.textSecondary, marginBottom: 6 }]} numberOfLines={1}>
                        {row.ACIKLAMA || row.AD || '-'}
                      </Text>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <View style={{ flexDirection: 'row', gap: 16 }}>
                          {borc > 0 && <Text style={[{ fontSize: 13, fontWeight: '600', color: colors.error }]}>B: ₺{borc.toFixed(2)}</Text>}
                          {alacak > 0 && <Text style={[{ fontSize: 13, fontWeight: '600', color: colors.success }]}>A: ₺{alacak.toFixed(2)}</Text>}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Text style={[{ fontSize: 13, fontWeight: '700', color: colors.text }]}>₺{bakiye.toFixed(2)}</Text>
                          {hasBelgeId && <Ionicons name="chevron-forward" size={14} color={colors.primary} />}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                  <Text style={[{ color: colors.textSecondary }]}>Ekstre bilgisi bulunamadı</Text>
                </View>
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
              <TouchableOpacity onPress={() => { setSelectedFis(null); setFisDetail([]); setFisTotals(null); }}>
                <Ionicons name="arrow-back" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.modalTitle, { color: colors.text, flex: 1, textAlign: 'center' }]}>Fiş Detayı</Text>
              <View style={{ width: 24 }} />
            </View>

            {selectedFis && (
              <View style={[{ padding: 12, backgroundColor: colors.primary + '08', borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                <Text style={[{ fontSize: 13, fontWeight: '600', color: colors.text }]}>{selectedFis.BELGENO || ''}</Text>
                <Text style={[{ fontSize: 12, color: colors.textSecondary }]}>{selectedFis.TARIH || ''} · {selectedFis.ACIKLAMA || ''}</Text>
              </View>
            )}

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}>
              {fisLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>Fiş detayı yükleniyor...</Text>
                </View>
              ) : fisDetail.length > 0 ? (
                <>
                  {fisDetail.map((item: any, idx: number) => (
                    <View key={idx} style={[styles.fisRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                        <Text style={[{ fontSize: 13, fontWeight: '600', color: colors.text, flex: 1 }]} numberOfLines={1}>{item.STOK || 'Ürün'}</Text>
                        <Text style={[{ fontSize: 13, fontWeight: '700', color: colors.primary }]}>₺{parseFloat(item.DAHIL_TUTAR || item.TUTAR || '0').toFixed(2)}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>{item.BIRIM || ''}</Text>
                        <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>Miktar: {parseFloat(item.MIKTAR_FIS || '0').toFixed(2)}</Text>
                        <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>Fiyat: ₺{parseFloat(item.DAHIL_FIYAT || item.FIYAT || '0').toFixed(2)}</Text>
                      </View>
                    </View>
                  ))}
                  {fisTotals && (
                    <View style={[styles.fisTotals, { backgroundColor: colors.primary + '10', borderColor: colors.border }]}>
                      <View style={styles.fisTotalRow}>
                        <Text style={[{ color: colors.textSecondary }]}>Satır Toplam</Text>
                        <Text style={[{ fontWeight: '600', color: colors.text }]}>₺{parseFloat(fisTotals.SATIR_TOPLAM || '0').toFixed(2)}</Text>
                      </View>
                      <View style={styles.fisTotalRow}>
                        <Text style={[{ color: colors.textSecondary }]}>KDV</Text>
                        <Text style={[{ fontWeight: '600', color: colors.text }]}>₺{parseFloat(fisTotals.KDV_TOPLAM || '0').toFixed(2)}</Text>
                      </View>
                      <View style={[styles.fisTotalRow, { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }]}>
                        <Text style={[{ fontSize: 16, fontWeight: '800', color: colors.text }]}>Genel Toplam</Text>
                        <Text style={[{ fontSize: 18, fontWeight: '800', color: colors.primary }]}>₺{parseFloat(fisTotals.GENELTOPLAM || '0').toFixed(2)}</Text>
                      </View>
                    </View>
                  )}
                </>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                  <Text style={[{ color: colors.textSecondary }]}>Fiş detayı bulunamadı</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  headerTitle: { fontSize: 20, fontWeight: '800' },
  summaryRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  summaryCard: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 10, alignItems: 'center' },
  summaryLabel: { fontSize: 11 },
  summaryValue: { fontSize: 16, fontWeight: '800', marginTop: 2 },
  searchContainer: { paddingHorizontal: 16, paddingTop: 10 },
  searchInput: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, gap: 8 },
  searchText: { flex: 1, fontSize: 14 },
  countRow: { paddingHorizontal: 16, paddingVertical: 8 },
  countText: { fontSize: 13 },
  listContent: { paddingHorizontal: 16, paddingBottom: 100 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 15 },
  cariCard: { borderRadius: 12, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
  cariCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, gap: 12 },
  cariName: { fontSize: 14, fontWeight: '600' },
  cariCode: { fontSize: 12, marginTop: 2 },
  cariBakiye: { fontSize: 16, fontWeight: '700' },
  cariCardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%', flex: 1 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  extreRow: { marginHorizontal: 12, marginTop: 8, borderRadius: 10, borderWidth: 1, padding: 10 },
  fisRow: { marginHorizontal: 12, marginTop: 8, borderRadius: 10, borderWidth: 1, padding: 10 },
  fisTotals: { margin: 12, borderRadius: 12, borderWidth: 1, padding: 14, gap: 6 },
  fisTotalRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
