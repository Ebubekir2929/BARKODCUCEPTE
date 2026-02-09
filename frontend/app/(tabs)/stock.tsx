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

const CACHE_KEY = 'cached_products';

export default function StockScreen() {
  const { colors } = useThemeStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productLocations, setProductLocations] = useState<ProductLocationStock[]>([]);
  const [productMovements, setProductMovements] = useState<ProductMovement[]>([]);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);

  // Load cached products or use mock data
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

    if (selectedGroup) {
      filtered = filtered.filter((p) => p.group === selectedGroup);
    }

    return filtered;
  }, [products, searchQuery, selectedGroup]);

  const handleProductPress = useCallback((product: Product) => {
    setSelectedProduct(product);
    setProductLocations(getProductLocationStocks(product.id));
    setProductMovements(getProductMovements(product.id));
  }, []);

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
            <Text style={[styles.detailValue, { color: colors.text }]}>{item.quantity}</Text>
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
        <TouchableOpacity
          style={[styles.filterButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setShowFilterModal(true)}
        >
          <Ionicons name="filter" size={20} color={colors.primary} />
          {selectedGroup && <View style={[styles.filterDot, { backgroundColor: colors.primary }]} />}
        </TouchableOpacity>
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

      {/* Selected Group Indicator */}
      {selectedGroup && (
        <View style={styles.selectedFilterRow}>
          <View style={[styles.selectedFilter, { backgroundColor: colors.primary + '20' }]}>
            <Text style={[styles.selectedFilterText, { color: colors.primary }]}>{selectedGroup}</Text>
            <TouchableOpacity onPress={() => setSelectedGroup(null)}>
              <Ionicons name="close" size={16} color={colors.primary} />
            </TouchableOpacity>
          </View>
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
              <Text style={[styles.modalTitle, { color: colors.text }]}>Grup Filtresi</Text>
              <TouchableOpacity onPress={() => setShowFilterModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody}>
              <TouchableOpacity
                style={[
                  styles.filterItem,
                  { borderColor: colors.border },
                  selectedGroup === null && { backgroundColor: colors.primary + '20', borderColor: colors.primary },
                ]}
                onPress={() => {
                  setSelectedGroup(null);
                  setShowFilterModal(false);
                }}
              >
                <Text style={[styles.filterItemText, { color: selectedGroup === null ? colors.primary : colors.text }]}>
                  Tüm Gruplar
                </Text>
              </TouchableOpacity>
              {groups.map((group) => (
                <TouchableOpacity
                  key={group}
                  style={[
                    styles.filterItem,
                    { borderColor: colors.border },
                    selectedGroup === group && { backgroundColor: colors.primary + '20', borderColor: colors.primary },
                  ]}
                  onPress={() => {
                    setSelectedGroup(group);
                    setShowFilterModal(false);
                  }}
                >
                  <Text
                    style={[
                      styles.filterItemText,
                      { color: selectedGroup === group ? colors.primary : colors.text },
                    ]}
                  >
                    {group}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
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
            <ScrollView style={styles.modalBody}>
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
  filterButton: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    position: 'relative',
  },
  filterDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  searchContainer: {
    padding: 16,
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
  selectedFilterRow: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  selectedFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  selectedFilterText: {
    fontSize: 13,
    fontWeight: '500',
  },
  countRow: {
    paddingHorizontal: 16,
    marginBottom: 8,
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
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '70%',
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
  },
  filterItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  filterItemText: {
    fontSize: 15,
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
