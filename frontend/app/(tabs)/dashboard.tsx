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
import { SummaryCard } from '../../src/components/SummaryCard';
import { FilterModal } from '../../src/components/FilterModal';
import {
  branchSalesData,
  hourlySalesData,
  topSellingProducts,
  leastSellingProducts,
  weeklyComparisonData,
  todayTotals,
} from '../../src/data/mockData';
import { BranchSales, HourlySales, CancelledReceipt } from '../../src/types';

const screenWidth = Dimensions.get('window').width;

export default function DashboardScreen() {
  const { colors } = useThemeStore();
  const { user } = useAuthStore();

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

  const comparePercentage = useMemo(() => {
    const lastWeek = weeklyComparisonData.lastWeek.total;
    const thisWeek = weeklyComparisonData.thisWeek.total;
    return ((thisWeek - lastWeek) / lastWeek) * 100;
  }, []);

  const maxHourAmount = useMemo(() => Math.max(...hourlySalesData.map(h => h.amount)), []);

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
            />
            <SummaryCard
              title="Kredi Kartı"
              amount={totals.card}
              icon="card-outline"
              color={colors.primary}
              onPress={() => setSelectedCardType('card')}
            />
          </View>
          <View style={styles.cardRow}>
            <SummaryCard
              title="Açık Hesap"
              amount={totals.openAccount}
              icon="wallet-outline"
              color={colors.openAccount}
              onPress={() => setSelectedCardType('openAccount')}
            />
            <SummaryCard
              title="Toplam"
              amount={totals.total}
              icon="stats-chart"
              color={colors.total}
              onPress={() => setSelectedCardType('total')}
            />
          </View>

          {/* Weekly Comparison - Inside Cards Section */}
          <View style={[styles.weeklyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.weeklyRow}>
              <View style={styles.weeklyItem}>
                <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                <Text style={[styles.weeklyLabel, { color: colors.textSecondary }]}>Geçen Hafta</Text>
                <Text style={[styles.weeklyValue, { color: colors.text }]}>
                  ₺{weeklyComparisonData.lastWeek.total.toLocaleString('tr-TR')}
                </Text>
              </View>
              <View style={[styles.weeklyDivider, { backgroundColor: colors.border }]} />
              <View style={styles.weeklyItem}>
                <Ionicons name="today-outline" size={16} color={colors.success} />
                <Text style={[styles.weeklyLabel, { color: colors.textSecondary }]}>Bugün</Text>
                <Text style={[styles.weeklyValue, { color: colors.success }]}>
                  ₺{todayTotals.total.toLocaleString('tr-TR')}
                </Text>
              </View>
              <View style={[styles.weeklyDivider, { backgroundColor: colors.border }]} />
              <View style={styles.weeklyItem}>
                <Ionicons
                  name={comparePercentage >= 0 ? 'trending-up' : 'trending-down'}
                  size={16}
                  color={comparePercentage >= 0 ? colors.success : colors.error}
                />
                <Text style={[styles.weeklyLabel, { color: colors.textSecondary }]}>Değişim</Text>
                <Text style={[styles.weeklyValue, { color: comparePercentage >= 0 ? colors.success : colors.error }]}>
                  %{Math.abs(comparePercentage).toFixed(1)}
                </Text>
              </View>
            </View>
          </View>
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
                Fiş Detayı
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
                <Text style={[styles.receiptItemsTitle, { color: colors.text }]}>Ürünler ({selectedReceipt.items.length})</Text>
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
                  <Text style={[styles.receiptTotalLabel, { color: colors.text }]}>Toplam</Text>
                  <Text style={[styles.receiptTotalValue, { color: colors.error }]}>
                    ₺{selectedReceipt.amount.toFixed(2)}
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
  weeklyCard: {
    marginTop: 8,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
  },
  weeklyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weeklyItem: {
    flex: 1,
    alignItems: 'center',
  },
  weeklyDivider: {
    width: 1,
    height: 40,
  },
  weeklyLabel: {
    fontSize: 11,
    marginTop: 4,
  },
  weeklyValue: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
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
    backgroundColor: 'rgba(0,0,0,0.5)',
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
    paddingBottom: 20,
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
});
