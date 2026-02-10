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
import { customersData, getCustomerMovements } from '../../src/data/mockData';
import { Customer, CustomerMovement, InvoiceDetail } from '../../src/types';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = 'cached_customers';

export default function CustomersScreen() {
  const { colors } = useThemeStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'debit' | 'credit'>('all');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerMovements, setCustomerMovements] = useState<CustomerMovement[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<CustomerMovement | null>(null);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);

  useEffect(() => {
    const loadCustomers = async () => {
      try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (cached) {
          setCustomers(JSON.parse(cached));
        } else {
          setCustomers(customersData);
          await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(customersData));
        }
      } catch (error) {
        setCustomers(customersData);
      } finally {
        setLoading(false);
      }
    };
    loadCustomers();
  }, []);

  const filteredCustomers = useMemo(() => {
    let filtered = customers;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.phone?.includes(query) ||
          c.email?.toLowerCase().includes(query)
      );
    }

    if (filterType === 'debit') {
      filtered = filtered.filter((c) => c.balance < 0);
    } else if (filterType === 'credit') {
      filtered = filtered.filter((c) => c.balance >= 0);
    }

    return filtered;
  }, [customers, searchQuery, filterType]);

  const totals = useMemo(() => {
    return customers.reduce(
      (acc, c) => ({
        totalDebt: acc.totalDebt + (c.balance < 0 ? Math.abs(c.balance) : 0),
        totalCredit: acc.totalCredit + (c.balance > 0 ? c.balance : 0),
      }),
      { totalDebt: 0, totalCredit: 0 }
    );
  }, [customers]);

  const handleCustomerPress = useCallback((customer: Customer) => {
    setSelectedCustomer(customer);
    setCustomerMovements(getCustomerMovements(customer.id));
  }, []);

  const renderCustomer = useCallback(
    ({ item }: { item: Customer }) => (
      <TouchableOpacity
        style={[styles.customerCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => handleCustomerPress(item)}
      >
        <View style={styles.customerHeader}>
          <View style={[styles.avatar, { backgroundColor: colors.primary + '20' }]}>
            <Text style={[styles.avatarText, { color: colors.primary }]}>
              {item.name.charAt(0)}
            </Text>
          </View>
          <View style={styles.customerInfo}>
            <Text style={[styles.customerName, { color: colors.text }]}>{item.name}</Text>
            {item.phone && (
              <Text style={[styles.customerPhone, { color: colors.textSecondary }]}>{item.phone}</Text>
            )}
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </View>
        <View style={[styles.balanceRow, { borderTopColor: colors.border }]}>
          <Text style={[styles.balanceLabel, { color: colors.textSecondary }]}>Bakiye:</Text>
          <Text
            style={[
              styles.balanceValue,
              { color: item.balance >= 0 ? colors.success : colors.error },
            ]}
          >
            {item.balance >= 0 ? '+' : ''}₺{item.balance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
          </Text>
        </View>
      </TouchableOpacity>
    ),
    [colors, handleCustomerPress]
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Cariler yükleniyor...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Cari Kartlar</Text>
        <TouchableOpacity
          style={[styles.filterButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setShowFilterModal(true)}
        >
          <Ionicons name="filter" size={20} color={colors.primary} />
          {filterType !== 'all' && <View style={[styles.filterDot, { backgroundColor: colors.primary }]} />}
        </TouchableOpacity>
      </View>

      {/* Summary Cards */}
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { backgroundColor: colors.error + '15', borderColor: colors.error + '30' }]}>
          <Ionicons name="trending-down" size={20} color={colors.error} />
          <Text style={[styles.summaryLabel, { color: colors.error }]}>Toplam Borç</Text>
          <Text style={[styles.summaryValue, { color: colors.error }]}>
            ₺{totals.totalDebt.toLocaleString('tr-TR')}
          </Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: colors.success + '15', borderColor: colors.success + '30' }]}>
          <Ionicons name="trending-up" size={20} color={colors.success} />
          <Text style={[styles.summaryLabel, { color: colors.success }]}>Toplam Alacak</Text>
          <Text style={[styles.summaryValue, { color: colors.success }]}>
            ₺{totals.totalCredit.toLocaleString('tr-TR')}
          </Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <View style={[styles.searchInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="search" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchText, { color: colors.text }]}
            placeholder="Cari ara..."
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

      {/* Filter Type */}
      {filterType !== 'all' && (
        <View style={styles.selectedFilterRow}>
          <View
            style={[
              styles.selectedFilter,
              { backgroundColor: filterType === 'debit' ? colors.error + '20' : colors.success + '20' },
            ]}
          >
            <Text
              style={[
                styles.selectedFilterText,
                { color: filterType === 'debit' ? colors.error : colors.success },
              ]}
            >
              {filterType === 'debit' ? 'Borçlu Cariler' : 'Alacaklı Cariler'}
            </Text>
            <TouchableOpacity onPress={() => setFilterType('all')}>
              <Ionicons
                name="close"
                size={16}
                color={filterType === 'debit' ? colors.error : colors.success}
              />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Customer Count */}
      <View style={styles.countRow}>
        <Text style={[styles.countText, { color: colors.textSecondary }]}>
          {filteredCustomers.length} cari listeleniyor
        </Text>
      </View>

      {/* Customer List */}
      <FlatList
        data={filteredCustomers}
        renderItem={renderCustomer}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* Filter Modal */}
      <Modal visible={showFilterModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Filtre</Text>
              <TouchableOpacity onPress={() => setShowFilterModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              {(['all', 'debit', 'credit'] as const).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.filterItem,
                    { borderColor: colors.border },
                    filterType === type && { backgroundColor: colors.primary + '20', borderColor: colors.primary },
                  ]}
                  onPress={() => {
                    setFilterType(type);
                    setShowFilterModal(false);
                  }}
                >
                  <Ionicons
                    name={
                      type === 'all'
                        ? 'people'
                        : type === 'debit'
                        ? 'trending-down'
                        : 'trending-up'
                    }
                    size={20}
                    color={filterType === type ? colors.primary : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.filterItemText,
                      { color: filterType === type ? colors.primary : colors.text },
                    ]}
                  >
                    {type === 'all' ? 'Tüm Cariler' : type === 'debit' ? 'Borçlu Cariler' : 'Alacaklı Cariler'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* Customer Detail Modal */}
      <Modal visible={!!selectedCustomer} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, maxHeight: '85%' }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{selectedCustomer?.name}</Text>
              <TouchableOpacity onPress={() => setSelectedCustomer(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
              {/* Customer Info */}
              {selectedCustomer && (
                <View style={[styles.customerDetail, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.customerDetailRow}>
                    <Ionicons name="call-outline" size={18} color={colors.textSecondary} />
                    <Text style={[styles.customerDetailText, { color: colors.text }]}>
                      {selectedCustomer.phone || '-'}
                    </Text>
                  </View>
                  <View style={styles.customerDetailRow}>
                    <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
                    <Text style={[styles.customerDetailText, { color: colors.text }]}>
                      {selectedCustomer.email || '-'}
                    </Text>
                  </View>
                  <View style={[styles.balanceBig, { borderTopColor: colors.border }]}>
                    <Text style={[styles.balanceBigLabel, { color: colors.textSecondary }]}>Bakiye</Text>
                    <Text
                      style={[
                        styles.balanceBigValue,
                        { color: selectedCustomer.balance >= 0 ? colors.success : colors.error },
                      ]}
                    >
                      {selectedCustomer.balance >= 0 ? '+' : ''}₺
                      {selectedCustomer.balance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                </View>
              )}

              {/* Movements */}
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Hareketler</Text>
              {customerMovements.map((mov) => (
                <TouchableOpacity
                  key={mov.id}
                  style={[styles.movementItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => mov.invoiceDetails && setSelectedInvoice(mov)}
                  disabled={!mov.invoiceDetails}
                >
                  <View style={styles.movementHeader}>
                    <View
                      style={[
                        styles.movementType,
                        {
                          backgroundColor:
                            mov.type === 'invoice'
                              ? colors.error + '20'
                              : mov.type === 'payment'
                              ? colors.success + '20'
                              : colors.warning + '20',
                        },
                      ]}
                    >
                      <Ionicons
                        name={
                          mov.type === 'invoice'
                            ? 'document-text-outline'
                            : mov.type === 'payment'
                            ? 'cash-outline'
                            : 'arrow-undo-outline'
                        }
                        size={14}
                        color={
                          mov.type === 'invoice'
                            ? colors.error
                            : mov.type === 'payment'
                            ? colors.success
                            : colors.warning
                        }
                      />
                      <Text
                        style={[
                          styles.movementTypeText,
                          {
                            color:
                              mov.type === 'invoice'
                                ? colors.error
                                : mov.type === 'payment'
                                ? colors.success
                                : colors.warning,
                          },
                        ]}
                      >
                        {mov.type === 'invoice' ? 'Fatura' : mov.type === 'payment' ? 'Ödeme' : 'İade'}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.movementAmount,
                        { color: mov.amount > 0 ? colors.success : colors.error },
                      ]}
                    >
                      {mov.amount > 0 ? '+' : ''}₺{mov.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <Text style={[styles.movementDesc, { color: colors.text }]}>{mov.description}</Text>
                  <View style={styles.movementFooter}>
                    <Text style={[styles.movementDate, { color: colors.textSecondary }]}>{mov.date}</Text>
                    {mov.invoiceDetails && (
                      <View style={styles.viewDetail}>
                        <Text style={[styles.viewDetailText, { color: colors.primary }]}>Detay</Text>
                        <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Invoice Detail Modal */}
      <Modal visible={!!selectedInvoice} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Fatura Detayı</Text>
              <TouchableOpacity onPress={() => setSelectedInvoice(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            {selectedInvoice && (
              <ScrollView style={styles.modalBody}>
                <View style={[styles.invoiceHeader, { backgroundColor: colors.primary + '15' }]}>
                  <Text style={[styles.invoiceNo, { color: colors.primary }]}>
                    {selectedInvoice.description}
                  </Text>
                  <Text style={[styles.invoiceDate, { color: colors.textSecondary }]}>
                    {selectedInvoice.date}
                  </Text>
                </View>
                <Text style={[styles.itemsTitle, { color: colors.text }]}>Ürünler</Text>
                {selectedInvoice.invoiceDetails?.map((item, index) => (
                  <View
                    key={index}
                    style={[styles.invoiceItem, { borderBottomColor: colors.border }]}
                  >
                    <View style={styles.invoiceItemInfo}>
                      <Text style={[styles.invoiceItemName, { color: colors.text }]}>
                        {item.productName}
                      </Text>
                      <Text style={[styles.invoiceItemQty, { color: colors.textSecondary }]}>
                        {item.quantity} x ₺{item.unitPrice.toFixed(2)}
                      </Text>
                    </View>
                    <Text style={[styles.invoiceItemTotal, { color: colors.text }]}>
                      ₺{item.total.toFixed(2)}
                    </Text>
                  </View>
                ))}
                <View style={[styles.invoiceTotal, { borderTopColor: colors.border }]}>
                  <Text style={[styles.invoiceTotalLabel, { color: colors.text }]}>Toplam</Text>
                  <Text style={[styles.invoiceTotalValue, { color: colors.primary }]}>
                    ₺{Math.abs(selectedInvoice.amount).toFixed(2)}
                  </Text>
                </View>
              </ScrollView>
            )}
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
  summaryRow: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    marginTop: 6,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  searchContainer: {
    paddingHorizontal: 16,
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
    marginTop: 12,
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
    paddingVertical: 12,
  },
  countText: {
    fontSize: 13,
  },
  listContent: {
    padding: 16,
    paddingTop: 0,
  },
  customerCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
  },
  customerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
  },
  customerInfo: {
    flex: 1,
  },
  customerName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  customerPhone: {
    fontSize: 13,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderTopWidth: 1,
  },
  balanceLabel: {
    fontSize: 13,
  },
  balanceValue: {
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
  },
  modalBody: {
    padding: 20,
  },
  modalBodyContent: {
    paddingBottom: 50,
  },
  filterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    gap: 12,
  },
  filterItemText: {
    fontSize: 15,
    fontWeight: '500',
  },
  customerDetail: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  customerDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  customerDetailText: {
    fontSize: 14,
  },
  balanceBig: {
    alignItems: 'center',
    paddingTop: 16,
    marginTop: 6,
    borderTopWidth: 1,
  },
  balanceBigLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  balanceBigValue: {
    fontSize: 24,
    fontWeight: '800',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
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
  movementAmount: {
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
    alignItems: 'center',
  },
  movementDate: {
    fontSize: 12,
  },
  viewDetail: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewDetailText: {
    fontSize: 12,
    fontWeight: '500',
  },
  invoiceHeader: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  invoiceNo: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  invoiceDate: {
    fontSize: 13,
  },
  itemsTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  invoiceItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  invoiceItemInfo: {
    flex: 1,
  },
  invoiceItemName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  invoiceItemQty: {
    fontSize: 12,
  },
  invoiceItemTotal: {
    fontSize: 14,
    fontWeight: '600',
  },
  invoiceTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: 1,
  },
  invoiceTotalLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  invoiceTotalValue: {
    fontSize: 18,
    fontWeight: '700',
  },
});
