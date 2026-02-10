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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import {
  productsData,
  getProductLocationStocks,
  getProductMovements,
} from '../../src/data/mockData';
import { Product, ProductLocationStock, ProductMovement } from '../../src/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';

const CACHE_KEY = 'cached_products';

interface StockFilters {
  group: string | null;
  profitType: 'all' | 'profit' | 'loss';
  quantityType: 'all' | 'low' | 'medium' | 'high';
  kdvType: 'all' | '1' | '10' | '20';
}

export default function StockScreen() {
  const { colors } = useThemeStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<StockFilters>({
    group: null,
    profitType: 'all',
    quantityType: 'all',
    kdvType: 'all',
  });
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productLocations, setProductLocations] = useState<ProductLocationStock[]>([]);
  const [productMovements, setProductMovements] = useState<ProductMovement[]>([]);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [permission, requestPermission] = useCameraPermissions();

  useEffect(() => {
    const loadProducts = async () => {
      try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (cached) {
          setProducts(JSON.parse(cached));
        } else {
          setProducts(productsData);
          await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(productsData));
        }
      } catch (error) {
        setProducts(productsData);
      } finally {
        setLoading(false);
      }
    };
    loadProducts();
  }, []);

  const groups = useMemo(() => {
    const uniqueGroups = [...new Set(products.map((p) => p.group))];
    return uniqueGroups;
  }, [products]);

  const filteredProducts = useMemo(() => {
    let filtered = products;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.barcode.includes(query)
      );
    }

    if (filters.group) {
      filtered = filtered.filter((p) => p.group === filters.group);
    }

    if (filters.profitType === 'profit') {
      filtered = filtered.filter((p) => p.profit >= 0);
    } else if (filters.profitType === 'loss') {
      filtered = filtered.filter((p) => p.profit < 0);
    }

    if (filters.quantityType === 'low') {
      filtered = filtered.filter((p) => p.quantity < 50);
    } else if (filters.quantityType === 'medium') {
      filtered = filtered.filter((p) => p.quantity >= 50 && p.quantity < 200);
    } else if (filters.quantityType === 'high') {
      filtered = filtered.filter((p) => p.quantity >= 200);
    }

    if (filters.kdvType !== 'all') {
      filtered = filtered.filter((p) => p.kdv === parseInt(filters.kdvType));
    }

    return filtered;
  }, [products, searchQuery, filters]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.group) count++;
    if (filters.profitType !== 'all') count++;
    if (filters.quantityType !== 'all') count++;
    if (filters.kdvType !== 'all') count++;
    return count;
  }, [filters]);

  const handleProductPress = useCallback((product: Product) => {
    setSelectedProduct(product);
    setProductLocations(getProductLocationStocks(product.id));
    setProductMovements(getProductMovements(product.id));
  }, []);

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    setShowScanner(false);
    setSearchQuery(data);
    const found = products.find(p => p.barcode === data);
    if (found) {
      handleProductPress(found);
    } else {
      Alert.alert('Ürün Bulunamadı', `"${data}" barkodlu ürün bulunamadı.`);
    }
  };

  const openScanner = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('İzin Gerekli', 'Barkod tarama için kamera izni gereklidir.');
        return;
      }
    }
    setShowScanner(true);
  };

  const resetFilters = () => {
    setFilters({
      group: null,
      profitType: 'all',
      quantityType: 'all',
      kdvType: 'all',
    });
  };

  const renderProduct = useCallback(
    ({ item }: { item: Product }) => (
      <TouchableOpacity
        style={[styles.productCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => handleProductPress(item)}
      >
        <View style={styles.productHeader}>
          <View style={styles.productInfo}>
            <Text style={[styles.productName, { color: colors.text }]}>{item.name}</Text>
            <Text style={[styles.productBarcode, { color: colors.textSecondary }]}>
              {item.barcode}
            </Text>
          </View>
          <View style={[styles.groupBadge, { backgroundColor: colors.primary + '20' }]}>
            <Text style={[styles.groupText, { color: colors.primary }]}>{item.group}</Text>
          </View>
        </View>

        <View style={styles.productDetails}>
          <View style={styles.detailColumn}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>KDV</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>%{item.kdv}</Text>
          </View>
          <View style={styles.detailColumn}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Alış</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>
              ₺{item.purchasePrice.toFixed(2)}
            </Text>
          </View>
          <View style={styles.detailColumn}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Satış</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>
              ₺{item.salesPrice.toFixed(2)}
            </Text>
          </View>
          <View style={styles.detailColumn}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Miktar</Text>
            <Text style={[styles.detailValue, { color: item.quantity < 50 ? colors.warning : colors.text }]}>{item.quantity}</Text>
          </View>
        </View>

        <View style={[styles.profitRow, { borderTopColor: colors.border }]}>
          <Text style={[styles.profitLabel, { color: colors.textSecondary }]}>Kar/Zarar:</Text>
          <Text
            style={[
              styles.profitValue,
              { color: item.profit >= 0 ? colors.success : colors.error },
            ]}
          >
            {item.profit >= 0 ? '+' : ''}₺{item.profit.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
          </Text>
        </View>
      </TouchableOpacity>
    ),
    [colors, handleProductPress]
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Stoklar yükleniyor...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Stok Yönetimi</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.scanButton, { backgroundColor: colors.success + '20' }]}
            onPress={openScanner}
          >
            <Ionicons name="barcode-outline" size={22} color={colors.success} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setShowFilterModal(true)}
          >
            <Ionicons name="filter" size={20} color={colors.primary} />
            {activeFilterCount > 0 && (
              <View style={[styles.filterBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="search" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchText, { color: colors.text }]}
            placeholder="Barkod veya ürün adı ara..."
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

      {/* Active Filters */}
      {activeFilterCount > 0 && (
        <View style={styles.activeFiltersRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeFiltersContent}>
            {filters.group && (
              <View style={[styles.activeFilter, { backgroundColor: colors.primary + '20' }]}>
                <Text style={[styles.activeFilterText, { color: colors.primary }]}>{filters.group}</Text>
                <TouchableOpacity onPress={() => setFilters(prev => ({ ...prev, group: null }))}>
                  <Ionicons name="close" size={14} color={colors.primary} />
                </TouchableOpacity>
              </View>
            )}
            {filters.profitType !== 'all' && (
              <View style={[styles.activeFilter, { backgroundColor: filters.profitType === 'profit' ? colors.success + '20' : colors.error + '20' }]}>
                <Text style={[styles.activeFilterText, { color: filters.profitType === 'profit' ? colors.success : colors.error }]}>
                  {filters.profitType === 'profit' ? 'Karlı' : 'Zararlı'}
                </Text>
                <TouchableOpacity onPress={() => setFilters(prev => ({ ...prev, profitType: 'all' }))}>
                  <Ionicons name="close" size={14} color={filters.profitType === 'profit' ? colors.success : colors.error} />
                </TouchableOpacity>
              </View>
            )}
            {filters.quantityType !== 'all' && (
              <View style={[styles.activeFilter, { backgroundColor: colors.warning + '20' }]}>
                <Text style={[styles.activeFilterText, { color: colors.warning }]}>
                  {filters.quantityType === 'low' ? 'Düşük Stok' : filters.quantityType === 'medium' ? 'Orta Stok' : 'Yüksek Stok'}
                </Text>
                <TouchableOpacity onPress={() => setFilters(prev => ({ ...prev, quantityType: 'all' }))}>
                  <Ionicons name="close" size={14} color={colors.warning} />
                </TouchableOpacity>
              </View>
            )}
            {filters.kdvType !== 'all' && (
              <View style={[styles.activeFilter, { backgroundColor: colors.info + '20' }]}>
                <Text style={[styles.activeFilterText, { color: colors.info }]}>KDV %{filters.kdvType}</Text>
                <TouchableOpacity onPress={() => setFilters(prev => ({ ...prev, kdvType: 'all' }))}>
                  <Ionicons name="close" size={14} color={colors.info} />
                </TouchableOpacity>
              </View>
            )}
            <TouchableOpacity
              style={[styles.clearAllBtn, { borderColor: colors.error }]}
              onPress={resetFilters}
            >
              <Text style={[styles.clearAllText, { color: colors.error }]}>Temizle</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {/* Product Count */}
      <View style={styles.countRow}>
        <Text style={[styles.countText, { color: colors.textSecondary }]}>
          {filteredProducts.length} ürün listeleniyor
        </Text>
      </View>

      {/* Product List */}
      <FlatList
        data={filteredProducts}
        renderItem={renderProduct}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={10}
        removeClippedSubviews={true}
      />

      {/* Filter Modal */}
      <Modal visible={showFilterModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Filtreler</Text>
              <TouchableOpacity onPress={() => setShowFilterModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              {/* Group Filter */}
              <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Grup</Text>
              <View style={styles.filterOptions}>
                <TouchableOpacity
                  style={[
                    styles.filterOption,
                    { borderColor: colors.border },
                    filters.group === null && { backgroundColor: colors.primary + '20', borderColor: colors.primary },
                  ]}
                  onPress={() => setFilters(prev => ({ ...prev, group: null }))}
                >
                  <Text style={[styles.filterOptionText, { color: filters.group === null ? colors.primary : colors.text }]}>
                    Tümü
                  </Text>
                </TouchableOpacity>
                {groups.map((group) => (
                  <TouchableOpacity
                    key={group}
                    style={[
                      styles.filterOption,
                      { borderColor: colors.border },
                      filters.group === group && { backgroundColor: colors.primary + '20', borderColor: colors.primary },
                    ]}
                    onPress={() => setFilters(prev => ({ ...prev, group }))}
                  >
                    <Text style={[styles.filterOptionText, { color: filters.group === group ? colors.primary : colors.text }]}>
                      {group}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Profit Filter */}
              <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Kar/Zarar</Text>
              <View style={styles.filterOptions}>
                {(['all', 'profit', 'loss'] as const).map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.filterOption,
                      { borderColor: colors.border },
                      filters.profitType === type && { 
                        backgroundColor: type === 'profit' ? colors.success + '20' : type === 'loss' ? colors.error + '20' : colors.primary + '20',
                        borderColor: type === 'profit' ? colors.success : type === 'loss' ? colors.error : colors.primary,
                      },
                    ]}
                    onPress={() => setFilters(prev => ({ ...prev, profitType: type }))}
                  >
                    <Ionicons
                      name={type === 'profit' ? 'trending-up' : type === 'loss' ? 'trending-down' : 'swap-horizontal'}
                      size={16}
                      color={
                        filters.profitType === type
                          ? type === 'profit' ? colors.success : type === 'loss' ? colors.error : colors.primary
                          : colors.textSecondary
                      }
                    />
                    <Text style={[styles.filterOptionText, { 
                      color: filters.profitType === type 
                        ? type === 'profit' ? colors.success : type === 'loss' ? colors.error : colors.primary
                        : colors.text 
                    }]}>
                      {type === 'all' ? 'Tümü' : type === 'profit' ? 'Karlı' : 'Zararlı'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Quantity Filter */}
              <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Stok Miktarı</Text>
              <View style={styles.filterOptions}>
                {(['all', 'low', 'medium', 'high'] as const).map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.filterOption,
                      { borderColor: colors.border },
                      filters.quantityType === type && { backgroundColor: colors.warning + '20', borderColor: colors.warning },
                    ]}
                    onPress={() => setFilters(prev => ({ ...prev, quantityType: type }))}
                  >
                    <Text style={[styles.filterOptionText, { color: filters.quantityType === type ? colors.warning : colors.text }]}>
                      {type === 'all' ? 'Tümü' : type === 'low' ? '< 50' : type === 'medium' ? '50-200' : '> 200'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* KDV Filter */}
              <Text style={[styles.filterSectionTitle, { color: colors.text }]}>KDV Oranı</Text>
              <View style={styles.filterOptions}>
                {(['all', '1', '10', '20'] as const).map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.filterOption,
                      { borderColor: colors.border },
                      filters.kdvType === type && { backgroundColor: colors.info + '20', borderColor: colors.info },
                    ]}
                    onPress={() => setFilters(prev => ({ ...prev, kdvType: type }))}
                  >
                    <Text style={[styles.filterOptionText, { color: filters.kdvType === type ? colors.info : colors.text }]}>
                      {type === 'all' ? 'Tümü' : `%${type}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <View style={[styles.modalFooter, { borderTopColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.resetBtn, { borderColor: colors.border }]}
                onPress={() => {
                  resetFilters();
                  setShowFilterModal(false);
                }}
              >
                <Text style={[styles.resetBtnText, { color: colors.text }]}>Sıfırla</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.applyBtn, { backgroundColor: colors.primary }]}
                onPress={() => setShowFilterModal(false)}
              >
                <Text style={styles.applyBtnText}>Uygula</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Barcode Scanner Modal */}
      <Modal visible={showScanner} animationType="slide">
        <View style={[styles.scannerContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.scannerHeader, { backgroundColor: colors.surface }]}>
            <TouchableOpacity onPress={() => setShowScanner(false)} style={styles.scannerCloseBtn}>
              <Ionicons name="close" size={28} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.scannerTitle, { color: colors.text }]}>Barkod Tara</Text>
            <View style={{ width: 28 }} />
          </View>
          <CameraView
            style={styles.scanner}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'],
            }}
            onBarcodeScanned={handleBarCodeScanned}
          />
          <View style={styles.scannerOverlay}>
            <View style={[styles.scannerFrame, { borderColor: colors.primary }]} />
            <Text style={[styles.scannerHint, { color: '#FFF' }]}>
              Barkodu çerçevenin içine hizalayın
            </Text>
          </View>
        </View>
      </Modal>

      {/* Product Detail Modal */}
      <Modal visible={!!selectedProduct} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, maxHeight: '85%' }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>
                {selectedProduct?.name}
              </Text>
              <TouchableOpacity onPress={() => setSelectedProduct(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
              {/* Location Stocks */}
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Lokasyon Dağılımı</Text>
              {productLocations.map((loc) => (
                <View
                  key={loc.branchId}
                  style={[styles.locationItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={styles.locationInfo}>
                    <Ionicons name="storefront-outline" size={18} color={colors.primary} />
                    <Text style={[styles.locationName, { color: colors.text }]}>{loc.branchName}</Text>
                  </View>
                  <View style={[styles.quantityBadge, { backgroundColor: colors.success + '20' }]}>
                    <Text style={[styles.quantityText, { color: colors.success }]}>{loc.quantity} adet</Text>
                  </View>
                </View>
              ))}

              {/* Movements */}
              <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 20 }]}>
                Stok Hareketleri
              </Text>
              {productMovements.map((mov) => (
                <View
                  key={mov.id}
                  style={[styles.movementItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={styles.movementHeader}>
                    <View
                      style={[
                        styles.movementType,
                        {
                          backgroundColor:
                            mov.type === 'sale'
                              ? colors.error + '20'
                              : mov.type === 'purchase'
                              ? colors.success + '20'
                              : colors.warning + '20',
                        },
                      ]}
                    >
                      <Ionicons
                        name={
                          mov.type === 'sale'
                            ? 'cart-outline'
                            : mov.type === 'purchase'
                            ? 'cube-outline'
                            : mov.type === 'transfer'
                            ? 'swap-horizontal'
                            : 'create-outline'
                        }
                        size={14}
                        color={
                          mov.type === 'sale'
                            ? colors.error
                            : mov.type === 'purchase'
                            ? colors.success
                            : colors.warning
                        }
                      />
                      <Text
                        style={[
                          styles.movementTypeText,
                          {
                            color:
                              mov.type === 'sale'
                                ? colors.error
                                : mov.type === 'purchase'
                                ? colors.success
                                : colors.warning,
                          },
                        ]}
                      >
                        {mov.type === 'sale'
                          ? 'Satış'
                          : mov.type === 'purchase'
                          ? 'Alım'
                          : mov.type === 'transfer'
                          ? 'Transfer'
                          : 'Düzeltme'}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.movementQty,
                        { color: mov.quantity > 0 ? colors.success : colors.error },
                      ]}
                    >
                      {mov.quantity > 0 ? '+' : ''}
                      {mov.quantity}
                    </Text>
                  </View>
                  <Text style={[styles.movementDesc, { color: colors.text }]}>{mov.description}</Text>
                  <View style={styles.movementFooter}>
                    <Text style={[styles.movementBranch, { color: colors.textSecondary }]}>
                      {mov.branchName}
                    </Text>
                    <Text style={[styles.movementDate, { color: colors.textSecondary }]}>{mov.date}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  scanButton: {
    padding: 10,
    borderRadius: 12,
  },
  filterButton: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    position: 'relative',
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
  },
  searchContainer: {
    padding: 16,
    paddingBottom: 8,
  },
  searchInput: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  searchText: {
    flex: 1,
    fontSize: 15,
  },
  activeFiltersRow: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  activeFiltersContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activeFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  activeFilterText: {
    fontSize: 12,
    fontWeight: '500',
  },
  clearAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  clearAllText: {
    fontSize: 12,
    fontWeight: '500',
  },
  countRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  countText: {
    fontSize: 13,
  },
  listContent: {
    padding: 16,
    paddingTop: 0,
  },
  productCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  productHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  productInfo: {
    flex: 1,
    marginRight: 12,
  },
  productName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  productBarcode: {
    fontSize: 13,
  },
  groupBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  groupText: {
    fontSize: 11,
    fontWeight: '600',
  },
  productDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  detailColumn: {
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  profitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
  },
  profitLabel: {
    fontSize: 13,
  },
  profitValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
    marginRight: 12,
  },
  modalBody: {
    padding: 20,
    paddingBottom: 40,
  },
  filterSectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  filterOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  filterOptionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    gap: 12,
  },
  resetBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  resetBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  applyBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  applyBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  scannerContainer: {
    flex: 1,
  },
  scannerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: 50,
  },
  scannerCloseBtn: {
    padding: 4,
  },
  scannerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  scanner: {
    flex: 1,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    marginTop: 90,
  },
  scannerFrame: {
    width: 280,
    height: 180,
    borderWidth: 3,
    borderRadius: 16,
  },
  scannerHint: {
    marginTop: 24,
    fontSize: 14,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  locationItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  locationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  locationName: {
    fontSize: 14,
    fontWeight: '500',
  },
  quantityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  quantityText: {
    fontSize: 13,
    fontWeight: '600',
  },
  movementItem: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  movementHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  movementType: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  movementTypeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  movementQty: {
    fontSize: 16,
    fontWeight: '700',
  },
  movementDesc: {
    fontSize: 14,
    marginBottom: 8,
  },
  movementFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  movementBranch: {
    fontSize: 12,
  },
  movementDate: {
    fontSize: 12,
  },
});
