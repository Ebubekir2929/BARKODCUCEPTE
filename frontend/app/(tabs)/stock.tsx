import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  FlatList,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';
import { useDataSourceStore } from '../../src/store/dataSourceStore';
import { ActiveSourceIndicator } from '../../src/components/DataSourceSelector';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export default function StockScreen() {
  const { colors } = useThemeStore();
  const { user } = useAuthStore();
  const { activeSource } = useDataSourceStore();

  // Compute active tenant ID
  const activeTenantId = useMemo(() => {
    if (!user?.tenants || user.tenants.length === 0) return '';
    const keys = ['data1', 'data2', 'data3'];
    const idx = keys.indexOf(activeSource);
    if (idx >= 0 && idx < user.tenants.length) return user.tenants[idx].tenant_id || '';
    return user.tenants[0]?.tenant_id || '';
  }, [user?.tenants, activeSource]);

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [priceNames, setPriceNames] = useState<any[]>([]);
  const [selectedPriceName, setSelectedPriceName] = useState<string>('');
  const [stockList, setStockList] = useState<any[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [showPriceModal, setShowPriceModal] = useState(false);

  // Detail modal
  const [selectedStock, setSelectedStock] = useState<any | null>(null);
  const [detailMiktar, setDetailMiktar] = useState<any[]>([]);
  const [detailExtre, setDetailExtre] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'miktar' | 'extre'>('miktar');

  // Fetch price names on mount
  useEffect(() => {
    if (!activeTenantId) return;
    const fetchPriceNames = async () => {
      setLoading(true);
      try {
        const { token } = useAuthStore.getState();
        const resp = await fetch(`${API_URL}/api/data/stock-price-names`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ tenant_id: activeTenantId }),
        });
        const data = await resp.json();
        if (data.ok && data.data) {
          setPriceNames(data.data);
          // Auto-select first
          if (data.data.length > 0 && !selectedPriceName) {
            const first = data.data[0];
            setSelectedPriceName(String(first.ID || first.AD || ''));
          }
        }
      } catch (err) {
        console.error('Price names error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchPriceNames();
  }, [activeTenantId]);

  // Fetch stock list when price name selected
  useEffect(() => {
    if (!activeTenantId || !selectedPriceName) return;
    const fetchStockList = async () => {
      setStockLoading(true);
      setStockList([]);
      try {
        const { token } = useAuthStore.getState();
        const resp = await fetch(`${API_URL}/api/data/stock-list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ tenant_id: activeTenantId, fiyat_ad: selectedPriceName }),
        });
        const data = await resp.json();
        if (data.ok && data.data) {
          setStockList(data.data);
        }
      } catch (err) {
        console.error('Stock list error:', err);
      } finally {
        setStockLoading(false);
      }
    };
    fetchStockList();
  }, [activeTenantId, selectedPriceName]);

  // Open stock detail
  const openStockDetail = useCallback(async (stock: any) => {
    setSelectedStock(stock);
    setDetailMiktar([]);
    setDetailExtre([]);
    setDetailLoading(true);
    setDetailTab('miktar');

    const stockId = stock.ID || stock.STOK_ID;
    if (!stockId || !activeTenantId) {
      setDetailLoading(false);
      return;
    }

    try {
      const { token } = useAuthStore.getState();
      const resp = await fetch(`${API_URL}/api/data/stock-detail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: activeTenantId, stock_id: stockId }),
      });
      const data = await resp.json();
      if (data.ok) {
        setDetailMiktar(data.miktar || []);
        setDetailExtre(data.extre || []);
      }
    } catch (err) {
      console.error('Stock detail error:', err);
    } finally {
      setDetailLoading(false);
    }
  }, [activeTenantId]);

  // Filter stock list
  const filteredStocks = useMemo(() => {
    if (!searchQuery) return stockList;
    const q = searchQuery.toLowerCase();
    return stockList.filter((s: any) =>
      (s.AD || s.STOK_ADI || '').toLowerCase().includes(q) ||
      (s.KOD || s.STOK_KODU || '').toLowerCase().includes(q) ||
      (s.BARKOD || '').includes(q)
    );
  }, [stockList, searchQuery]);

  const selectedPriceLabel = useMemo(() => {
    const found = priceNames.find((p: any) => String(p.ID) === selectedPriceName || String(p.AD) === selectedPriceName);
    return found ? (found.AD || `Fiyat #${found.ID}`) : 'Fiyat Adı Seç';
  }, [priceNames, selectedPriceName]);

  // Render stock item
  const renderStockItem = useCallback(({ item }: { item: any }) => {
    const name = item.AD || item.STOK_ADI || 'Ürün';
    const code = item.KOD || item.STOK_KODU || '';
    const barcode = item.BARKOD || '';
    const price = parseFloat(item.FIYAT || '0');
    const priceIncl = parseFloat(item.DAHIL_FIYAT || '0');

    return (
      <TouchableOpacity
        style={[styles.stockCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => openStockDetail(item)}
        activeOpacity={0.7}
      >
        <View style={styles.stockCardTop}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.stockName, { color: colors.text }]} numberOfLines={2}>{name}</Text>
            <Text style={[styles.stockCode, { color: colors.textSecondary }]}>{code}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.stockPrice, { color: colors.primary }]}>₺{priceIncl > 0 ? priceIncl.toFixed(2) : price.toFixed(2)}</Text>
            {priceIncl > 0 && price > 0 && priceIncl !== price && (
              <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>KDV Hariç: ₺{price.toFixed(2)}</Text>
            )}
          </View>
        </View>
        {barcode ? (
          <View style={[styles.barcodeRow, { borderTopColor: colors.border }]}>
            <Ionicons name="barcode-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.barcodeText, { color: colors.textSecondary }]}>{barcode}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </View>
        ) : null}
      </TouchableOpacity>
    );
  }, [colors, openStockDetail]);

  // No tenant
  if (!activeTenantId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <ActiveSourceIndicator />
        <View style={styles.emptyContainer}>
          <Ionicons name="cube-outline" size={48} color={colors.textSecondary} />
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
        <Text style={[styles.headerTitle, { color: colors.text }]}>Stok Yönetimi</Text>
      </View>

      {/* Price Name Selector */}
      <TouchableOpacity
        style={[styles.priceSelector, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => setShowPriceModal(true)}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <Ionicons name="pricetag-outline" size={18} color={colors.primary} />
          <Text style={[{ fontSize: 14, fontWeight: '600', color: colors.text, flex: 1 }]} numberOfLines={1}>
            {loading ? 'Yükleniyor...' : selectedPriceLabel}
          </Text>
        </View>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </TouchableOpacity>

      {/* Search */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="search" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchText, { color: colors.text }]}
            placeholder="Barkod, kod veya ürün adı ara..."
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
          {stockLoading ? 'POS\'tan yükleniyor...' : `${filteredStocks.length} ürün`}
        </Text>
      </View>

      {/* Loading or List */}
      {stockLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            POS'tan stok listesi alınıyor...
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredStocks}
          renderItem={renderStockItem}
          keyExtractor={(item, idx) => String(item.ID || item.STOK_ID || idx)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="cube-outline" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Stok bulunamadı</Text>
            </View>
          }
        />
      )}

      {/* Price Name Selection Modal */}
      <Modal visible={showPriceModal} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Fiyat Adı Seç</Text>
              <TouchableOpacity onPress={() => setShowPriceModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }} contentContainerStyle={{ paddingBottom: 30 }}>
              {priceNames.map((pn: any, idx: number) => {
                const isSelected = String(pn.ID) === selectedPriceName || String(pn.AD) === selectedPriceName;
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.priceOption, { backgroundColor: isSelected ? colors.primary + '15' : colors.card, borderColor: isSelected ? colors.primary : colors.border }]}
                    onPress={() => {
                      setSelectedPriceName(String(pn.ID || pn.AD || ''));
                      setShowPriceModal(false);
                    }}
                  >
                    <Text style={[{ fontSize: 15, fontWeight: isSelected ? '700' : '500', color: isSelected ? colors.primary : colors.text }]}>
                      {pn.AD || `Fiyat #${pn.ID}`}
                    </Text>
                    {isSelected && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Stock Detail Modal */}
      <Modal visible={!!selectedStock} animationType="slide" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>
                {selectedStock?.AD || selectedStock?.STOK_ADI || 'Stok Detayı'}
              </Text>
              <TouchableOpacity onPress={() => { setSelectedStock(null); setDetailMiktar([]); setDetailExtre([]); }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Stock Info Header */}
            {selectedStock && (
              <View style={[{ padding: 16, backgroundColor: colors.primary + '08', borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                <Text style={[{ fontSize: 13, color: colors.textSecondary }]}>{selectedStock.KOD || selectedStock.STOK_KODU || ''}</Text>
                <Text style={[{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }]}>Barkod: {selectedStock.BARKOD || '-'}</Text>
                <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
                  <View>
                    <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>Fiyat</Text>
                    <Text style={[{ fontSize: 16, fontWeight: '700', color: colors.primary }]}>₺{parseFloat(selectedStock.FIYAT || '0').toFixed(2)}</Text>
                  </View>
                  {parseFloat(selectedStock.DAHIL_FIYAT || '0') > 0 && (
                    <View>
                      <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>KDV Dahil</Text>
                      <Text style={[{ fontSize: 16, fontWeight: '700', color: colors.success }]}>₺{parseFloat(selectedStock.DAHIL_FIYAT || '0').toFixed(2)}</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Tabs */}
            <View style={[{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.tab, detailTab === 'miktar' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
                onPress={() => setDetailTab('miktar')}
              >
                <Text style={[{ fontSize: 14, fontWeight: '600', color: detailTab === 'miktar' ? colors.primary : colors.textSecondary }]}>Miktar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, detailTab === 'extre' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
                onPress={() => setDetailTab('extre')}
              >
                <Text style={[{ fontSize: 14, fontWeight: '600', color: detailTab === 'extre' ? colors.primary : colors.textSecondary }]}>Ekstre</Text>
              </TouchableOpacity>
            </View>

            {/* Content */}
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}>
              {detailLoading ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={[{ color: colors.textSecondary, marginTop: 12 }]}>POS'tan veri alınıyor...</Text>
                </View>
              ) : detailTab === 'miktar' ? (
                /* Miktar Tab */
                detailMiktar.length > 0 ? (
                  <View style={{ padding: 16 }}>
                    {detailMiktar.map((loc: any, idx: number) => (
                      <View key={idx} style={[styles.miktarCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[{ fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 8 }]}>{loc.AD || 'Lokasyon'}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          <View style={styles.miktarItem}>
                            <Text style={[styles.miktarLabel, { color: colors.textSecondary }]}>Mevcut</Text>
                            <Text style={[styles.miktarValue, { color: colors.text }]}>{parseFloat(loc.MIKTAR || '0').toFixed(2)}</Text>
                          </View>
                          <View style={styles.miktarItem}>
                            <Text style={[styles.miktarLabel, { color: colors.textSecondary }]}>Giriş</Text>
                            <Text style={[styles.miktarValue, { color: colors.success }]}>{parseFloat(loc.MIKTAR_GIRIS || '0').toFixed(2)}</Text>
                          </View>
                          <View style={styles.miktarItem}>
                            <Text style={[styles.miktarLabel, { color: colors.textSecondary }]}>Çıkış</Text>
                            <Text style={[styles.miktarValue, { color: colors.error }]}>{parseFloat(loc.MIKTAR_CIKIS || '0').toFixed(2)}</Text>
                          </View>
                          <View style={styles.miktarItem}>
                            <Text style={[styles.miktarLabel, { color: colors.textSecondary }]}>Satış</Text>
                            <Text style={[styles.miktarValue, { color: colors.primary }]}>{parseFloat(loc.SATIS || '0').toFixed(2)}</Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                    <Text style={[{ color: colors.textSecondary }]}>Miktar bilgisi bulunamadı</Text>
                  </View>
                )
              ) : (
                /* Ekstre Tab */
                detailExtre.length > 0 ? (
                  <View style={{ padding: 12 }}>
                    {detailExtre.map((row: any, idx: number) => (
                      <View key={idx} style={[styles.extreRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text style={[{ fontSize: 12, fontWeight: '600', color: colors.text }]}>{row.TARIH || ''}</Text>
                          <Text style={[{ fontSize: 11, color: colors.textSecondary }]}>{row.FIS_TURU || ''}</Text>
                        </View>
                        <Text style={[{ fontSize: 12, color: colors.textSecondary, marginBottom: 4 }]} numberOfLines={1}>
                          {row.CARI_AD || row.ACIKLAMA || row.BELGENO || '-'}
                        </Text>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <View style={{ flexDirection: 'row', gap: 12 }}>
                            {parseFloat(row.MIKTAR_GIRIS || '0') > 0 && (
                              <Text style={[{ fontSize: 12, color: colors.success }]}>+{parseFloat(row.MIKTAR_GIRIS).toFixed(2)}</Text>
                            )}
                            {parseFloat(row.MIKTAR_CIKIS || '0') > 0 && (
                              <Text style={[{ fontSize: 12, color: colors.error }]}>-{parseFloat(row.MIKTAR_CIKIS).toFixed(2)}</Text>
                            )}
                          </View>
                          <Text style={[{ fontSize: 12, fontWeight: '700', color: colors.text }]}>
                            Bakiye: {parseFloat(row.BAKIYE || '0').toFixed(2)}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                    <Text style={[{ color: colors.textSecondary }]}>Ekstre bilgisi bulunamadı</Text>
                  </View>
                )
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
  priceSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginTop: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
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
  stockCard: { borderRadius: 12, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
  stockCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 12, gap: 12 },
  stockName: { fontSize: 14, fontWeight: '600' },
  stockCode: { fontSize: 12, marginTop: 2 },
  stockPrice: { fontSize: 16, fontWeight: '700' },
  barcodeRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, gap: 6 },
  barcodeText: { flex: 1, fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%', flex: 1 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  modalTitle: { fontSize: 18, fontWeight: '700', flex: 1 },
  priceOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  miktarCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  miktarItem: { minWidth: 80 },
  miktarLabel: { fontSize: 11 },
  miktarValue: { fontSize: 15, fontWeight: '700' },
  extreRow: { borderRadius: 10, borderWidth: 1, padding: 10, marginBottom: 6 },
});
