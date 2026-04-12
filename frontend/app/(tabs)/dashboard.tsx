import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';
import { useLanguageStore } from '../../src/store/languageStore';
import { SummaryCard } from '../../src/components/SummaryCard';
import { FilterModal } from '../../src/components/FilterModal';
import {
  branchSalesData,
  hourlySalesData,
  topSellingProducts,
  leastSellingProducts,
  weeklyComparisonData,
  openTablesData,
} from '../../src/data/mockData';
import { BranchSales, HourlySales, CancelledReceipt, OpenTable } from '../../src/types';

const screenWidth = Dimensions.get('window').width;

export default function DashboardScreen() {
  const { colors } = useThemeStore();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();

  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filters, setFilters] = useState({
    branchId: null as string | null,
    startDate: new Date(),
    endDate: new Date(),
  });
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCardType, setSelectedCardType] = useState<'cash' | 'card' | 'openAccount' | 'total' | null>(null);
  const [selectedHour, setSelectedHour] = useState<HourlySales | null>(null);
  const [showHourDetail, setShowHourDetail] = useState(false);
  const [selectedBranchCancellations, setSelectedBranchCancellations] = useState<{ branch: BranchSales; receipts: CancelledReceipt[] } | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<CancelledReceipt | null>(null);
  const [highlightedHourIndex, setHighlightedHourIndex] = useState<number | null>(null);
  
  // Open Tables state
  const [openTableLocationFilter, setOpenTableLocationFilter] = useState<string>('all');
  const [selectedCustomerTables, setSelectedCustomerTables] = useState<{ customerName: string; tables: OpenTable[] } | null>(null);
  const [selectedOpenTable, setSelectedOpenTable] = useState<OpenTable | null>(null);

  // Calculate totals from all branches
  const totals = useMemo(() => {
    const filteredBranches = filters.branchId
      ? branchSalesData.filter((b) => b.branchId === filters.branchId)
      : branchSalesData;

    return filteredBranches.reduce(
      (acc, branch) => ({
        cash: acc.cash + branch.sales.cash,
        card: acc.card + branch.sales.card,
        openAccount: acc.openAccount + branch.sales.openAccount,
        total: acc.total + branch.sales.total,
      }),
      { cash: 0, card: 0, openAccount: 0, total: 0 }
    );
  }, [filters.branchId]);

  // Best selling hour
  const bestSellingHour = useMemo(() => {
    return hourlySalesData.reduce((max, hour) => hour.amount > max.amount ? hour : max, hourlySalesData[0]);
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  // Calculate percentage changes for each payment type
  const cardChangePercents = useMemo(() => {
    const calcPercent = (current: number, last: number) => 
      last > 0 ? ((current - last) / last) * 100 : 0;
    
    return {
      cash: calcPercent(totals.cash, weeklyComparisonData.lastWeek.cash),
      card: calcPercent(totals.card, weeklyComparisonData.lastWeek.card),
      openAccount: calcPercent(totals.openAccount, weeklyComparisonData.lastWeek.openAccount),
      total: calcPercent(totals.total, weeklyComparisonData.lastWeek.total),
    };
  }, [totals]);

  const maxHourAmount = useMemo(() => Math.max(...hourlySalesData.map(h => h.amount)), []);

  // Open Tables computed values
  const openTableLocations = useMemo(() => {
    const locs = [...new Set(openTablesData.map(t => t.location))];
    return locs;
  }, []);

  const filteredOpenTables = useMemo(() => {
    if (openTableLocationFilter === 'all') return openTablesData;
    return openTablesData.filter(t => t.location === openTableLocationFilter);
  }, [openTableLocationFilter]);

  // Group tables by customer
  const groupedByCustomer = useMemo(() => {
    const groups: Record<string, OpenTable[]> = {};
    filteredOpenTables.forEach(table => {
      if (!groups[table.customerId]) {
        groups[table.customerId] = [];
      }
      groups[table.customerId].push(table);
    });
    return groups;
  }, [filteredOpenTables]);

  const openTableTotals = useMemo(() => {
    return filteredOpenTables.reduce(
      (acc, table) => ({
        amount: acc.amount + table.amount,
        paid: acc.paid + table.paidAmount,
        remaining: acc.remaining + table.remainingAmount,
      }),
      { amount: 0, paid: 0, remaining: 0 }
    );
  }, [filteredOpenTables]);

  const getPaymentStatusColor = (table: OpenTable) => {
    if (table.remainingAmount === 0) return colors.success;
    if (table.paidAmount > 0) return colors.warning;
    return colors.error;
  };

  const getPaymentStatusText = (table: OpenTable) => {
    if (table.remainingAmount === 0) return t('fully_paid');
    if (table.paidAmount > 0) return t('partially_paid');
    return t('not_paid');
  };

  const handleHourPress = (hour: HourlySales, index: number) => {
    setSelectedHour(hour);
    setHighlightedHourIndex(index);
    setShowHourDetail(true);
  };

  const getCardTypeLabel = (type: string) => {
    switch (type) {
      case 'cash': return 'Nakit';
      case 'card': return 'Kredi Kartı';
      case 'openAccount': return 'Açık Hesap';
      case 'total': return 'Toplam';
      default: return '';
    }
  };

  const getCardTypeColor = (type: string) => {
    switch (type) {
      case 'cash': return colors.cash;
      case 'card': return colors.primary;
      case 'openAccount': return colors.openAccount;
      case 'total': return colors.total;
      default: return colors.primary;
    }
  };

  const openCancellations = (branch: BranchSales) => {
    setSelectedBranchCancellations({ branch, receipts: branch.cancellations });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.greeting, { color: colors.textSecondary }]}>Hoş geldiniz,</Text>
          <Text style={[styles.userName, { color: colors.text }]}>{user?.name || 'Kullanıcı'}</Text>
        </View>
        <TouchableOpacity
          style={[styles.filterButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setShowFilterModal(true)}
        >
          <Ionicons name="filter" size={20} color={colors.primary} />
          <Text style={[styles.filterText, { color: colors.primary }]}>Filtre</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Summary Cards */}
        <View style={styles.cardsContainer}>
          <View style={styles.cardRow}>
            <SummaryCard
              title="Nakit"
              amount={totals.cash}
              icon="cash-outline"
              color={colors.cash}
              onPress={() => setSelectedCardType('cash')}
              lastWeekAmount={weeklyComparisonData.lastWeek.cash}
              changePercent={cardChangePercents.cash}
            />
            <SummaryCard
              title="Kredi Kartı"
              amount={totals.card}
              icon="card-outline"
              color={colors.primary}
              onPress={() => setSelectedCardType('card')}
              lastWeekAmount={weeklyComparisonData.lastWeek.card}
              changePercent={cardChangePercents.card}
            />
          </View>
          <View style={styles.cardRow}>
            <SummaryCard
              title="Açık Hesap"
              amount={totals.openAccount}
              icon="wallet-outline"
              color={colors.openAccount}
              onPress={() => setSelectedCardType('openAccount')}
              lastWeekAmount={weeklyComparisonData.lastWeek.openAccount}
              changePercent={cardChangePercents.openAccount}
            />
            <SummaryCard
              title="Toplam"
              amount={totals.total}
              icon="stats-chart"
              color={colors.total}
              onPress={() => setSelectedCardType('total')}
              lastWeekAmount={weeklyComparisonData.lastWeek.total}
              changePercent={cardChangePercents.total}
            />
          </View>
        </View>

        {/* Open Tables Section */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>{t('open_tables')}</Text>
              <View style={[styles.liveBadge, { backgroundColor: colors.error + '20' }]}>
                <View style={[styles.liveDot, { backgroundColor: colors.error }]} />
                <Text style={[styles.liveText, { color: colors.error }]}>{t('open_tables_live')}</Text>
              </View>
            </View>
            <View style={[styles.openTableCount, { backgroundColor: colors.primary + '15' }]}>
              <Text style={[styles.openTableCountText, { color: colors.primary }]}>{filteredOpenTables.length}</Text>
            </View>
          </View>

          {/* Location Filter Chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.locationFilterScroll}>
            <TouchableOpacity
              style={[
                styles.locationChip,
                {
                  backgroundColor: openTableLocationFilter === 'all' ? colors.primary : colors.background,
                  borderColor: openTableLocationFilter === 'all' ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setOpenTableLocationFilter('all')}
            >
              <Text
                style={[
                  styles.locationChipText,
                  { color: openTableLocationFilter === 'all' ? '#fff' : colors.textSecondary },
                ]}
              >
                {t('all_locations')}
              </Text>
            </TouchableOpacity>
            {openTableLocations.map((loc) => (
              <TouchableOpacity
                key={loc}
                style={[
                  styles.locationChip,
                  {
                    backgroundColor: openTableLocationFilter === loc ? colors.primary : colors.background,
                    borderColor: openTableLocationFilter === loc ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setOpenTableLocationFilter(loc)}
              >
                <Text
                  style={[
                    styles.locationChipText,
                    { color: openTableLocationFilter === loc ? '#fff' : colors.textSecondary },
                  ]}
                >
                  {loc}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Open Tables Summary Row */}
          <View style={[styles.openTablesSummary, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={styles.openTablesSummaryItem}>
              <Text style={[styles.openTablesSummaryLabel, { color: colors.textSecondary }]}>{t('total_open_amount')}</Text>
              <Text style={[styles.openTablesSummaryValue, { color: colors.text }]}>
                ₺{openTableTotals.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              </Text>
            </View>
            <View style={[styles.openTablesSummaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.openTablesSummaryItem}>
              <Text style={[styles.openTablesSummaryLabel, { color: colors.textSecondary }]}>{t('total_paid')}</Text>
              <Text style={[styles.openTablesSummaryValue, { color: colors.success }]}>
                ₺{openTableTotals.paid.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              </Text>
            </View>
            <View style={[styles.openTablesSummaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.openTablesSummaryItem}>
              <Text style={[styles.openTablesSummaryLabel, { color: colors.textSecondary }]}>{t('total_remaining')}</Text>
              <Text style={[styles.openTablesSummaryValue, { color: colors.error }]}>
                ₺{openTableTotals.remaining.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              </Text>
            </View>
          </View>

          {/* Open Tables List - Grouped by Customer */}
          {Object.entries(groupedByCustomer).map(([customerId, tables]) => {
            const customerName = tables[0].customerName;
            const customerTotal = tables.reduce((sum, t) => sum + t.amount, 0);
            const customerPaid = tables.reduce((sum, t) => sum + t.paidAmount, 0);
            const hasMultiple = tables.length > 1;

            return (
              <View key={customerId} style={[styles.customerGroup, { borderColor: colors.border }]}>
                {/* Customer Header */}
                <TouchableOpacity
                  style={styles.customerGroupHeader}
                  onPress={() => {
                    if (hasMultiple) {
                      setSelectedCustomerTables({ customerName, tables });
                    }
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                    <View style={[styles.customerAvatar, { backgroundColor: colors.primary + '20' }]}>
                      <Ionicons name="person" size={16} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.customerGroupName, { color: colors.text }]}>{customerName}</Text>
                      {hasMultiple && (
                        <Text style={[styles.customerGroupSub, { color: colors.textSecondary }]}>
                          {tables.length} {t('open_tables').toLowerCase()}
                        </Text>
                      )}
                    </View>
                  </View>
                  {hasMultiple && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={[styles.customerGroupTotal, { color: colors.primary }]}>
                        ₺{customerTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                      </Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.primary} />
                    </View>
                  )}
                </TouchableOpacity>

                {/* Individual Table Cards */}
                {tables.map((table) => (
                  <TouchableOpacity
                    key={table.id}
                    style={[styles.openTableCard, { backgroundColor: colors.background, borderColor: colors.border }]}
                    onPress={() => setSelectedOpenTable(table)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.openTableCardTop}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={[styles.tableIcon, { backgroundColor: getPaymentStatusColor(table) + '15' }]}>
                          <Ionicons name="restaurant-outline" size={16} color={getPaymentStatusColor(table)} />
                        </View>
                        <View>
                          <Text style={[styles.openTableName, { color: colors.text }]}>{table.tableNo}</Text>
                          <Text style={[styles.openTableLocation, { color: colors.textSecondary }]}>
                            <Ionicons name="location-outline" size={11} color={colors.textSecondary} /> {table.location}
                          </Text>
                        </View>
                      </View>
                      <View style={[styles.paymentBadge, { backgroundColor: getPaymentStatusColor(table) + '15' }]}>
                        <Text style={[styles.paymentBadgeText, { color: getPaymentStatusColor(table) }]}>
                          {getPaymentStatusText(table)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.openTableCardBottom}>
                      <View style={styles.openTableStat}>
                        <Text style={[styles.openTableStatLabel, { color: colors.textSecondary }]}>{t('amount_label')}</Text>
                        <Text style={[styles.openTableStatValue, { color: colors.text }]}>
                          ₺{table.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                        </Text>
                      </View>
                      <View style={styles.openTableStat}>
                        <Text style={[styles.openTableStatLabel, { color: colors.textSecondary }]}>{t('paid_amount')}</Text>
                        <Text style={[styles.openTableStatValue, { color: colors.success }]}>
                          ₺{table.paidAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                        </Text>
                      </View>
                      <View style={styles.openTableStat}>
                        <Text style={[styles.openTableStatLabel, { color: colors.textSecondary }]}>{t('remaining_amount')}</Text>
                        <Text style={[styles.openTableStatValue, { color: colors.error }]}>
                          ₺{table.remainingAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                        </Text>
                      </View>
                    </View>

                    {hasMultiple && (
                      <View style={[styles.dataSourceTag, { backgroundColor: colors.info + '12' }]}>
                        <Ionicons name="server-outline" size={10} color={colors.info} />
                        <Text style={[styles.dataSourceText, { color: colors.info }]}>{table.dataSource}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            );
          })}

          {filteredOpenTables.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="restaurant-outline" size={40} color={colors.textSecondary} />
              <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>{t('no_open_tables')}</Text>
            </View>
          )}
        </View>

        {/* Hourly Sales Chart */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Saatlik Satışlar</Text>
            <View style={[styles.bestHourBadge, { backgroundColor: colors.success + '20' }]}>
              <Ionicons name="trophy" size={14} color={colors.success} />
              <Text style={[styles.bestHourText, { color: colors.success }]}>
                En Çok: {bestSellingHour.hour}
              </Text>
            </View>
          </View>

          {/* Bar Chart */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chartScroll}>
            <View style={styles.barChart}>
              {hourlySalesData.map((hour, index) => {
                const barHeight = (hour.amount / maxHourAmount) * 150;
                const isHighlighted = highlightedHourIndex === index;
                const isBest = hour.hour === bestSellingHour.hour;
                return (
                  <TouchableOpacity
                    key={hour.hour}
                    style={styles.barContainer}
                    onPress={() => handleHourPress(hour, index)}
                  >
                    <Text style={[styles.barValue, { color: colors.textSecondary }]}>
                      {(hour.amount / 1000).toFixed(0)}K
                    </Text>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: barHeight,
                          backgroundColor: isHighlighted
                            ? colors.primary
                            : isBest
                            ? colors.success
                            : colors.primary + '60',
                        },
                      ]}
                    />
                    <Text style={[styles.barLabel, { color: isHighlighted ? colors.primary : colors.textSecondary }]}>
                      {hour.hour.slice(0, 2)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <Text style={[styles.chartHint, { color: colors.textSecondary }]}>
            Saate dokunarak detay görüntüleyin
          </Text>
        </View>

        {/* Top Selling Products */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>En Çok Satan Ürünler</Text>
          {topSellingProducts.slice(0, 5).map((product, index) => (
            <View key={product.id} style={[styles.productItem, { borderBottomColor: colors.border }]}>
              <View style={[styles.productRank, { backgroundColor: colors.success + '20' }]}>
                <Text style={[styles.productRankText, { color: colors.success }]}>{index + 1}</Text>
              </View>
              <View style={styles.productInfo}>
                <Text style={[styles.productName, { color: colors.text }]}>{product.name}</Text>
                <Text style={[styles.productQty, { color: colors.textSecondary }]}>
                  {product.quantity} adet satıldı
                </Text>
              </View>
              <Text style={[styles.productRevenue, { color: colors.success }]}>
                ₺{product.revenue.toLocaleString('tr-TR')}
              </Text>
            </View>
          ))}
        </View>

        {/* Least Selling Products */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>En Az Satan Ürünler</Text>
          {leastSellingProducts.slice(0, 5).map((product, index) => (
            <View key={product.id} style={[styles.productItem, { borderBottomColor: colors.border }]}>
              <View style={[styles.productRank, { backgroundColor: colors.error + '20' }]}>
                <Text style={[styles.productRankText, { color: colors.error }]}>{index + 1}</Text>
              </View>
              <View style={styles.productInfo}>
                <Text style={[styles.productName, { color: colors.text }]}>{product.name}</Text>
                <Text style={[styles.productQty, { color: colors.textSecondary }]}>
                  {product.quantity} adet satıldı
                </Text>
              </View>
              <Text style={[styles.productRevenue, { color: colors.error }]}>
                ₺{product.revenue.toLocaleString('tr-TR')}
              </Text>
            </View>
          ))}
        </View>

        {/* Location Summary */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Lokasyon Özeti</Text>
          {branchSalesData.map((branch, index) => (
            <View 
              key={branch.branchId} 
              style={[
                styles.locationCard, 
                { borderBottomColor: colors.border },
                index === branchSalesData.length - 1 && { borderBottomWidth: 0 }
              ]}
            >
              <Text style={[styles.locationName, { color: colors.text }]}>{branch.branchName}</Text>
              <View style={styles.locationDetails}>
                <View style={styles.locationRow}>
                  <View style={styles.locationStat}>
                    <Ionicons name="cash-outline" size={14} color={colors.cash} />
                    <Text style={[styles.locationLabel, { color: colors.textSecondary }]}>Nakit</Text>
                    <Text style={[styles.locationValue, { color: colors.text }]}>
                      ₺{branch.sales.cash.toLocaleString('tr-TR')}
                    </Text>
                  </View>
                  <View style={styles.locationStat}>
                    <Ionicons name="card-outline" size={14} color={colors.primary} />
                    <Text style={[styles.locationLabel, { color: colors.textSecondary }]}>Kart</Text>
                    <Text style={[styles.locationValue, { color: colors.text }]}>
                      ₺{branch.sales.card.toLocaleString('tr-TR')}
                    </Text>
                  </View>
                </View>
                <View style={styles.locationRow}>
                  <View style={styles.locationStat}>
                    <Ionicons name="wallet-outline" size={14} color={colors.openAccount} />
                    <Text style={[styles.locationLabel, { color: colors.textSecondary }]}>Açık</Text>
                    <Text style={[styles.locationValue, { color: colors.text }]}>
                      ₺{branch.sales.openAccount.toLocaleString('tr-TR')}
                    </Text>
                  </View>
                  <View style={styles.locationStat}>
                    <Ionicons name="stats-chart" size={14} color={colors.total} />
                    <Text style={[styles.locationLabel, { color: colors.textSecondary }]}>Toplam</Text>
                    <Text style={[styles.locationValue, { color: colors.text }]}>
                      ₺{branch.sales.total.toLocaleString('tr-TR')}
                    </Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.cancellationButton, { backgroundColor: colors.error + '15' }]}
                onPress={() => openCancellations(branch)}
              >
                <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                <Text style={[styles.cancellationText, { color: colors.error }]}>
                  {branch.cancellations.length} İptal Fişi
                </Text>
                <Ionicons name="chevron-forward" size={14} color={colors.error} />
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* Bottom Spacing - Reduced */}
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Filter Modal */}
      <FilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        onApply={setFilters}
        currentFilters={filters}
      />

      {/* Card Type Location Modal */}
      <Modal visible={!!selectedCardType} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {getCardTypeLabel(selectedCardType || '')} - Lokasyon Dağılımı
              </Text>
              <TouchableOpacity onPress={() => setSelectedCardType(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
              {branchSalesData.map((branch) => {
                const value = selectedCardType === 'cash' ? branch.sales.cash
                  : selectedCardType === 'card' ? branch.sales.card
                  : selectedCardType === 'openAccount' ? branch.sales.openAccount
                  : branch.sales.total;
                const percentage = (value / totals[selectedCardType || 'total']) * 100;
                return (
                  <View key={branch.branchId} style={[styles.locationModalItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.locationModalInfo}>
                      <View style={[styles.locationModalIcon, { backgroundColor: getCardTypeColor(selectedCardType || '') + '20' }]}>
                        <Ionicons name="storefront" size={18} color={getCardTypeColor(selectedCardType || '')} />
                      </View>
                      <View>
                        <Text style={[styles.locationModalName, { color: colors.text }]}>{branch.branchName}</Text>
                        <Text style={[styles.locationModalPercent, { color: colors.textSecondary }]}>
                          %{percentage.toFixed(1)} pay
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.locationModalValue, { color: getCardTypeColor(selectedCardType || '') }]}>
                      ₺{value.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                );
              })}
              <View style={[styles.totalRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[styles.totalLabel, { color: colors.text }]}>Toplam</Text>
                <Text style={[styles.totalValue, { color: getCardTypeColor(selectedCardType || '') }]}>
                  ₺{totals[selectedCardType || 'total'].toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Hour Detail Modal */}
      <Modal visible={showHourDetail} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {selectedHour?.hour} Satış Detayı
              </Text>
              <TouchableOpacity onPress={() => { setShowHourDetail(false); setHighlightedHourIndex(null); }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            {selectedHour && (
              <View style={[styles.modalBody, styles.modalBodyContent]}>
                <View style={[styles.hourDetailCard, { backgroundColor: colors.primary + '15' }]}>
                  <Ionicons name="time-outline" size={48} color={colors.primary} />
                  <Text style={[styles.hourDetailTime, { color: colors.text }]}>{selectedHour.hour}</Text>
                  <Text style={[styles.hourDetailAmount, { color: colors.primary }]}>
                    ₺{selectedHour.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                  </Text>
                  <Text style={[styles.hourDetailTx, { color: colors.textSecondary }]}>
                    {selectedHour.transactions} işlem gerçekleşti
                  </Text>
                </View>
                <View style={styles.hourStats}>
                  <View style={[styles.hourStatItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.hourStatLabel, { color: colors.textSecondary }]}>Ortalama İşlem</Text>
                    <Text style={[styles.hourStatValue, { color: colors.text }]}>
                      ₺{(selectedHour.amount / selectedHour.transactions).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={[styles.hourStatItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.hourStatLabel, { color: colors.textSecondary }]}>Dakikada</Text>
                    <Text style={[styles.hourStatValue, { color: colors.text }]}>
                      {(selectedHour.transactions / 60).toFixed(1)} işlem
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Cancellations List Modal */}
      <Modal visible={!!selectedBranchCancellations} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {selectedBranchCancellations?.branch.branchName} - İptal Fişleri
              </Text>
              <TouchableOpacity onPress={() => setSelectedBranchCancellations(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
              <View style={[styles.cancellationSummary, { backgroundColor: colors.error + '15' }]}>
                <Ionicons name="alert-circle" size={24} color={colors.error} />
                <View style={styles.cancellationSummaryText}>
                  <Text style={[styles.cancellationCount, { color: colors.error }]}>
                    {selectedBranchCancellations?.receipts.length} İptal Fişi
                  </Text>
                  <Text style={[styles.cancellationTotal, { color: colors.text }]}>
                    Toplam: ₺{selectedBranchCancellations?.receipts.reduce((acc, r) => acc + r.amount, 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
              </View>

              {selectedBranchCancellations?.receipts.map((receipt) => (
                <TouchableOpacity
                  key={receipt.id}
                  style={[styles.receiptCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => setSelectedReceipt(receipt)}
                >
                  <View style={styles.receiptCardHeader}>
                    <View>
                      <Text style={[styles.receiptCardNo, { color: colors.text }]}>{receipt.receiptNo}</Text>
                      <Text style={[styles.receiptCardDate, { color: colors.textSecondary }]}>{receipt.date}</Text>
                    </View>
                    <Text style={[styles.receiptCardAmount, { color: colors.error }]}>
                      ₺{receipt.amount.toFixed(2)}
                    </Text>
                  </View>
                  <View style={styles.receiptCardFooter}>
                    <Text style={[styles.receiptCardReason, { color: colors.textSecondary }]} numberOfLines={1}>
                      {receipt.reason}
                    </Text>
                    <View style={styles.receiptCardAction}>
                      <Text style={[styles.receiptCardActionText, { color: colors.primary }]}>Detay</Text>
                      <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Receipt Detail Modal */}
      <Modal visible={!!selectedReceipt} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={() => setSelectedReceipt(null)}>
                <Ionicons name="arrow-back" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.modalTitle, { color: colors.text, flex: 1, textAlign: 'center' }]}>
                {t('table_detail')}
              </Text>
              <View style={{ width: 24 }} />
            </View>
            {selectedReceipt && (
              <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
                <View style={[styles.receiptHeader, { backgroundColor: colors.error + '15' }]}>
                  <Text style={[styles.receiptNo, { color: colors.error }]}>
                    {selectedReceipt.receiptNo}
                  </Text>
                  <Text style={[styles.receiptDate, { color: colors.textSecondary }]}>
                    {selectedReceipt.date}
                  </Text>
                  <View style={styles.receiptReasonRow}>
                    <Ionicons name="information-circle-outline" size={16} color={colors.text} />
                    <Text style={[styles.receiptReason, { color: colors.text }]}>
                      {selectedReceipt.reason}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.receiptItemsTitle, { color: colors.text }]}>{t('products')} ({selectedReceipt.items.length})</Text>
                {selectedReceipt.items.map((item, index) => (
                  <View key={index} style={[styles.receiptItem, { borderBottomColor: colors.border }]}>
                    <View style={styles.receiptItemInfo}>
                      <Text style={[styles.receiptItemName, { color: colors.text }]}>{item.productName}</Text>
                      <Text style={[styles.receiptItemQty, { color: colors.textSecondary }]}>
                        {item.quantity} x ₺{item.unitPrice.toFixed(2)}
                      </Text>
                    </View>
                    <Text style={[styles.receiptItemTotal, { color: colors.text }]}>₺{item.total.toFixed(2)}</Text>
                  </View>
                ))}
                <View style={[styles.receiptTotal, { borderTopColor: colors.border }]}>
                  <Text style={[styles.receiptTotalLabel, { color: colors.text }]}>{t('total')}</Text>
                  <Text style={[styles.receiptTotalValue, { color: colors.error }]}>
                    ₺{selectedReceipt.amount.toFixed(2)}
                  </Text>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Open Table Detail Modal */}
      <Modal visible={!!selectedOpenTable} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {t('table_detail')}
              </Text>
              <TouchableOpacity onPress={() => setSelectedOpenTable(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            {selectedOpenTable && (
              <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
                {/* Table Info Card */}
                <View style={[styles.tableDetailHeader, { backgroundColor: colors.primary + '10' }]}>
                  <View style={[styles.tableDetailIcon, { backgroundColor: getPaymentStatusColor(selectedOpenTable) + '20' }]}>
                    <Ionicons name="restaurant" size={32} color={getPaymentStatusColor(selectedOpenTable)} />
                  </View>
                  <Text style={[styles.tableDetailTitle, { color: colors.text }]}>{selectedOpenTable.tableNo}</Text>
                  <Text style={[styles.tableDetailCustomer, { color: colors.textSecondary }]}>{selectedOpenTable.customerName}</Text>
                  <View style={[styles.paymentBadge, { backgroundColor: getPaymentStatusColor(selectedOpenTable) + '15', marginTop: 8 }]}>
                    <Text style={[styles.paymentBadgeText, { color: getPaymentStatusColor(selectedOpenTable) }]}>
                      {getPaymentStatusText(selectedOpenTable)}
                    </Text>
                  </View>
                </View>

                {/* Amount Details */}
                <View style={styles.tableDetailGrid}>
                  <View style={[styles.tableDetailGridItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Ionicons name="receipt-outline" size={20} color={colors.primary} />
                    <Text style={[styles.tableDetailGridLabel, { color: colors.textSecondary }]}>{t('amount_label')}</Text>
                    <Text style={[styles.tableDetailGridValue, { color: colors.text }]}>
                      ₺{selectedOpenTable.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={[styles.tableDetailGridItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Ionicons name="checkmark-circle-outline" size={20} color={colors.success} />
                    <Text style={[styles.tableDetailGridLabel, { color: colors.textSecondary }]}>{t('paid_amount')}</Text>
                    <Text style={[styles.tableDetailGridValue, { color: colors.success }]}>
                      ₺{selectedOpenTable.paidAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={[styles.tableDetailGridItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Ionicons name="time-outline" size={20} color={colors.error} />
                    <Text style={[styles.tableDetailGridLabel, { color: colors.textSecondary }]}>{t('remaining_amount')}</Text>
                    <Text style={[styles.tableDetailGridValue, { color: colors.error }]}>
                      ₺{selectedOpenTable.remainingAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={[styles.tableDetailGridItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Ionicons name="cube-outline" size={20} color={colors.info} />
                    <Text style={[styles.tableDetailGridLabel, { color: colors.textSecondary }]}>{t('items_count')}</Text>
                    <Text style={[styles.tableDetailGridValue, { color: colors.text }]}>
                      {selectedOpenTable.itemCount}
                    </Text>
                  </View>
                </View>

                {/* Info Rows */}
                <View style={[styles.tableDetailInfo, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={[styles.tableDetailInfoRow, { borderBottomColor: colors.border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name="location-outline" size={18} color={colors.primary} />
                      <Text style={[styles.tableDetailInfoLabel, { color: colors.textSecondary }]}>{t('location')}</Text>
                    </View>
                    <Text style={[styles.tableDetailInfoValue, { color: colors.text }]}>{selectedOpenTable.location}</Text>
                  </View>
                  <View style={[styles.tableDetailInfoRow, { borderBottomColor: colors.border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name="time-outline" size={18} color={colors.primary} />
                      <Text style={[styles.tableDetailInfoLabel, { color: colors.textSecondary }]}>{t('opened_at')}</Text>
                    </View>
                    <Text style={[styles.tableDetailInfoValue, { color: colors.text }]}>{selectedOpenTable.openedAt}</Text>
                  </View>
                  <View style={styles.tableDetailInfoRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name="server-outline" size={18} color={colors.primary} />
                      <Text style={[styles.tableDetailInfoLabel, { color: colors.textSecondary }]}>{t('data_source')}</Text>
                    </View>
                    <Text style={[styles.tableDetailInfoValue, { color: colors.text }]}>{selectedOpenTable.dataSource}</Text>
                  </View>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Customer Tables Modal (Multiple data) */}
      <Modal visible={!!selectedCustomerTables} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {selectedCustomerTables?.customerName} - {t('customer_tables')}
              </Text>
              <TouchableOpacity onPress={() => setSelectedCustomerTables(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
              {/* Customer Summary */}
              <View style={[styles.customerModalSummary, { backgroundColor: colors.primary + '10' }]}>
                <View style={[styles.customerModalAvatar, { backgroundColor: colors.primary + '20' }]}>
                  <Ionicons name="person" size={28} color={colors.primary} />
                </View>
                <Text style={[styles.customerModalName, { color: colors.text }]}>
                  {selectedCustomerTables?.customerName}
                </Text>
                <Text style={[styles.customerModalSubtitle, { color: colors.textSecondary }]}>
                  {selectedCustomerTables?.tables.length} {t('open_tables').toLowerCase()}
                </Text>
                <View style={styles.customerModalTotals}>
                  <View style={styles.customerModalTotalItem}>
                    <Text style={[styles.customerModalTotalLabel, { color: colors.textSecondary }]}>{t('total')}</Text>
                    <Text style={[styles.customerModalTotalValue, { color: colors.text }]}>
                      ₺{selectedCustomerTables?.tables.reduce((s, t) => s + t.amount, 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={styles.customerModalTotalItem}>
                    <Text style={[styles.customerModalTotalLabel, { color: colors.textSecondary }]}>{t('paid_amount')}</Text>
                    <Text style={[styles.customerModalTotalValue, { color: colors.success }]}>
                      ₺{selectedCustomerTables?.tables.reduce((s, t) => s + t.paidAmount, 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={styles.customerModalTotalItem}>
                    <Text style={[styles.customerModalTotalLabel, { color: colors.textSecondary }]}>{t('remaining_amount')}</Text>
                    <Text style={[styles.customerModalTotalValue, { color: colors.error }]}>
                      ₺{selectedCustomerTables?.tables.reduce((s, t) => s + t.remainingAmount, 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Individual Tables */}
              {selectedCustomerTables?.tables.map((table) => (
                <TouchableOpacity
                  key={table.id}
                  style={[styles.customerModalTableCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => {
                    setSelectedCustomerTables(null);
                    setTimeout(() => setSelectedOpenTable(table), 300);
                  }}
                >
                  <View style={styles.customerModalTableHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={[styles.tableIcon, { backgroundColor: getPaymentStatusColor(table) + '15' }]}>
                        <Ionicons name="restaurant-outline" size={16} color={getPaymentStatusColor(table)} />
                      </View>
                      <View>
                        <Text style={[styles.openTableName, { color: colors.text }]}>{table.tableNo}</Text>
                        <Text style={[styles.openTableLocation, { color: colors.textSecondary }]}>
                          {table.location}
                        </Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <View style={[styles.dataSourceTag, { backgroundColor: colors.info + '12' }]}>
                        <Ionicons name="server-outline" size={10} color={colors.info} />
                        <Text style={[styles.dataSourceText, { color: colors.info }]}>{table.dataSource}</Text>
                      </View>
                    </View>
                  </View>
                  <View style={[styles.customerModalTableFooter, { borderTopColor: colors.border }]}>
                    <View>
                      <Text style={[styles.openTableStatLabel, { color: colors.textSecondary }]}>{t('amount_label')}</Text>
                      <Text style={[styles.openTableStatValue, { color: colors.text }]}>₺{table.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</Text>
                    </View>
                    <View>
                      <Text style={[styles.openTableStatLabel, { color: colors.textSecondary }]}>{t('paid_amount')}</Text>
                      <Text style={[styles.openTableStatValue, { color: colors.success }]}>₺{table.paidAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</Text>
                    </View>
                    <View>
                      <Text style={[styles.openTableStatLabel, { color: colors.textSecondary }]}>{t('remaining_amount')}</Text>
                      <Text style={[styles.openTableStatValue, { color: colors.error }]}>₺{table.remainingAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                  </View>
                </TouchableOpacity>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  greeting: {
    fontSize: 13,
    marginBottom: 2,
  },
  userName: {
    fontSize: 20,
    fontWeight: '700',
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  cardsContainer: {
    padding: 16,
    paddingBottom: 8,
  },
  cardRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
  },
  bestHourBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  bestHourText: {
    fontSize: 12,
    fontWeight: '600',
  },
  chartScroll: {
    marginBottom: 8,
  },
  barChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 200,
    paddingTop: 20,
  },
  barContainer: {
    alignItems: 'center',
    marginHorizontal: 6,
    width: 32,
  },
  barValue: {
    fontSize: 9,
    marginBottom: 4,
  },
  bar: {
    width: 24,
    borderRadius: 6,
    minHeight: 4,
  },
  barLabel: {
    fontSize: 10,
    marginTop: 6,
    fontWeight: '500',
  },
  chartHint: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
  productItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  productRank: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  productRankText: {
    fontSize: 13,
    fontWeight: '700',
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  productQty: {
    fontSize: 12,
  },
  productRevenue: {
    fontSize: 14,
    fontWeight: '600',
  },
  locationCard: {
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  locationName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 10,
  },
  locationDetails: {
    gap: 8,
  },
  locationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  locationStat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  locationLabel: {
    fontSize: 12,
  },
  locationValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  cancellationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  cancellationText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
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
  hourDetailCard: {
    alignItems: 'center',
    padding: 32,
    borderRadius: 20,
    marginBottom: 16,
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
  hourStats: {
    flexDirection: 'row',
    gap: 12,
  },
  hourStatItem: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  hourStatLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  hourStatValue: {
    fontSize: 16,
    fontWeight: '700',
  },
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
  receiptHeader: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  receiptNo: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  receiptDate: {
    fontSize: 13,
    marginBottom: 8,
  },
  receiptReasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  receiptReason: {
    fontSize: 14,
    flex: 1,
  },
  receiptItemsTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  receiptItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  receiptItemInfo: {
    flex: 1,
  },
  receiptItemName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  receiptItemQty: {
    fontSize: 12,
  },
  receiptItemTotal: {
    fontSize: 14,
    fontWeight: '600',
  },
  receiptTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: 1,
  },
  receiptTotalLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  receiptTotalValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  // Open Tables Styles
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveText: {
    fontSize: 10,
    fontWeight: '700',
  },
  openTableCount: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  openTableCountText: {
    fontSize: 13,
    fontWeight: '700',
  },
  locationFilterScroll: {
    marginBottom: 12,
    marginTop: -4,
  },
  locationChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  locationChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  openTablesSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  openTablesSummaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  openTablesSummaryLabel: {
    fontSize: 10,
    marginBottom: 2,
  },
  openTablesSummaryValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  openTablesSummaryDivider: {
    width: 1,
    height: 30,
    marginHorizontal: 4,
  },
  customerGroup: {
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  customerGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  customerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  customerGroupName: {
    fontSize: 14,
    fontWeight: '600',
  },
  customerGroupSub: {
    fontSize: 11,
    marginTop: 1,
  },
  customerGroupTotal: {
    fontSize: 13,
    fontWeight: '700',
  },
  openTableCard: {
    margin: 8,
    marginTop: 0,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  openTableCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  tableIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  openTableName: {
    fontSize: 14,
    fontWeight: '600',
  },
  openTableLocation: {
    fontSize: 11,
    marginTop: 1,
  },
  paymentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  paymentBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  openTableCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  openTableStat: {
    flex: 1,
    alignItems: 'center',
  },
  openTableStatLabel: {
    fontSize: 10,
    marginBottom: 2,
  },
  openTableStatValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  dataSourceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  dataSourceText: {
    fontSize: 10,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyStateText: {
    fontSize: 14,
  },
  // Table Detail Modal
  tableDetailHeader: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 16,
    marginBottom: 16,
  },
  tableDetailIcon: {
    width: 60,
    height: 60,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  tableDetailTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  tableDetailCustomer: {
    fontSize: 14,
    marginTop: 4,
  },
  tableDetailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  tableDetailGridItem: {
    width: '48%',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  tableDetailGridLabel: {
    fontSize: 11,
  },
  tableDetailGridValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  tableDetailInfo: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableDetailInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
  },
  tableDetailInfoLabel: {
    fontSize: 13,
  },
  tableDetailInfoValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Customer Modal
  customerModalSummary: {
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    marginBottom: 16,
  },
  customerModalAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  customerModalName: {
    fontSize: 18,
    fontWeight: '700',
  },
  customerModalSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  customerModalTotals: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 16,
  },
  customerModalTotalItem: {
    alignItems: 'center',
  },
  customerModalTotalLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  customerModalTotalValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  customerModalTableCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
  },
  customerModalTableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  customerModalTableFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderTopWidth: 1,
  },
});
