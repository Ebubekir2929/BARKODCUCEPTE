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
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { BarChart, LineChart } from 'react-native-chart-kit';
import { BranchSales, HourlySales, TopProduct, CancelledReceipt, InvoiceDetail } from '../../src/types';

const screenWidth = Dimensions.get('window').width;

export default function DashboardScreen() {
  const { colors, isDark } = useThemeStore();
  const { user } = useAuthStore();

  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filters, setFilters] = useState({
    branchId: null as string | null,
    startDate: new Date(),
    endDate: new Date(),
  });
  const [refreshing, setRefreshing] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<BranchSales | null>(null);
  const [selectedHour, setSelectedHour] = useState<HourlySales | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<CancelledReceipt | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

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

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  const chartConfig = {
    backgroundColor: colors.card,
    backgroundGradientFrom: colors.card,
    backgroundGradientTo: colors.card,
    decimalPlaces: 0,
    color: (opacity = 1) => colors.primary,
    labelColor: (opacity = 1) => colors.textSecondary,
    style: { borderRadius: 16 },
    propsForDots: {
      r: '4',
      strokeWidth: '2',
      stroke: colors.primary,
    },
  };

  const comparePercentage = useMemo(() => {
    const lastWeek = weeklyComparisonData.lastWeek.total;
    const thisWeek = weeklyComparisonData.thisWeek.total;
    const diff = ((thisWeek - lastWeek) / lastWeek) * 100;
    return diff;
  }, []);

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
              onPress={() => setExpandedSection(expandedSection === 'cash' ? null : 'cash')}
            />
            <SummaryCard
              title="Kredi Kartı"
              amount={totals.card}
              icon="card-outline"
              color={colors.primary}
              onPress={() => setExpandedSection(expandedSection === 'card' ? null : 'card')}
            />
          </View>
          <View style={styles.cardRow}>
            <SummaryCard
              title="Açık Hesap"
              amount={totals.openAccount}
              icon="wallet-outline"
              color={colors.openAccount}
              onPress={() => setExpandedSection(expandedSection === 'openAccount' ? null : 'openAccount')}
            />
            <SummaryCard
              title="Toplam"
              amount={totals.total}
              icon="stats-chart"
              color={colors.total}
              onPress={() => setExpandedSection(expandedSection === 'total' ? null : 'total')}
            />
          </View>
        </View>

        {/* Weekly Comparison */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Haftalık Karşılaştırma</Text>
            <View
              style={[
                styles.badge,
                { backgroundColor: comparePercentage >= 0 ? colors.success + '20' : colors.error + '20' },
              ]}
            >
              <Ionicons
                name={comparePercentage >= 0 ? 'trending-up' : 'trending-down'}
                size={16}
                color={comparePercentage >= 0 ? colors.success : colors.error}
              />
              <Text
                style={[
                  styles.badgeText,
                  { color: comparePercentage >= 0 ? colors.success : colors.error },
                ]}
              >
                %{Math.abs(comparePercentage).toFixed(1)}
              </Text>
            </View>
          </View>
          <View style={styles.comparisonRow}>
            <View style={styles.comparisonItem}>
              <Text style={[styles.comparisonLabel, { color: colors.textSecondary }]}>Geçen Hafta</Text>
              <Text style={[styles.comparisonValue, { color: colors.text }]}>
                ₺{weeklyComparisonData.lastWeek.total.toLocaleString('tr-TR')}
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color={colors.textSecondary} />
            <View style={styles.comparisonItem}>
              <Text style={[styles.comparisonLabel, { color: colors.textSecondary }]}>Bu Hafta</Text>
              <Text style={[styles.comparisonValue, { color: colors.text }]}>
                ₺{weeklyComparisonData.thisWeek.total.toLocaleString('tr-TR')}
              </Text>
            </View>
          </View>
          <View style={styles.todayRow}>
            <Text style={[styles.todayLabel, { color: colors.textSecondary }]}>Bugün Toplamı:</Text>
            <Text style={[styles.todayValue, { color: colors.success }]}>
              ₺{todayTotals.total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
            </Text>
          </View>
        </View>

        {/* Branch Sales */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Şube Satışları</Text>
          {branchSalesData.map((branch) => (
            <TouchableOpacity
              key={branch.branchId}
              style={[styles.branchItem, { borderBottomColor: colors.border }]}
              onPress={() => setSelectedBranch(branch)}
            >
              <View style={styles.branchInfo}>
                <View style={[styles.branchIcon, { backgroundColor: colors.primary + '20' }]}>
                  <Ionicons name="storefront" size={18} color={colors.primary} />
                </View>
                <Text style={[styles.branchName, { color: colors.text }]}>{branch.branchName}</Text>
              </View>
              <View style={styles.branchAmount}>
                <Text style={[styles.branchTotal, { color: colors.text }]}>
                  ₺{branch.sales.total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Hourly Sales Chart */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Saatlik Satışlar</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <LineChart
              data={{
                labels: hourlySalesData.slice(0, 8).map((h) => h.hour.slice(0, 2)),
                datasets: [{ data: hourlySalesData.slice(0, 8).map((h) => h.amount / 1000) }],
              }}
              width={screenWidth - 32}
              height={200}
              chartConfig={chartConfig}
              bezier
              style={styles.chart}
              onDataPointClick={({ index }) => setSelectedHour(hourlySalesData[index])}
            />
          </ScrollView>
          <View style={styles.hourlyList}>
            {hourlySalesData.slice(0, 6).map((hour, index) => (
              <TouchableOpacity
                key={hour.hour}
                style={[
                  styles.hourItem,
                  { backgroundColor: colors.background, borderColor: colors.border },
                ]}
                onPress={() => setSelectedHour(hour)}
              >
                <Text style={[styles.hourTime, { color: colors.text }]}>{hour.hour}</Text>
                <Text style={[styles.hourAmount, { color: colors.primary }]}>
                  ₺{(hour.amount / 1000).toFixed(1)}K
                </Text>
                <Text style={[styles.hourTx, { color: colors.textSecondary }]}>
                  {hour.transactions} işlem
                </Text>
              </TouchableOpacity>
            ))}
          </View>
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

        {/* Location Summary with Cancellations */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Lokasyon Özeti</Text>
          {branchSalesData.map((branch) => (
            <View key={branch.branchId} style={[styles.locationCard, { borderBottomColor: colors.border }]}>
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
                onPress={() => setSelectedReceipt(branch.cancellations[0])}
              >
                <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                <Text style={[styles.cancellationText, { color: colors.error }]}>
                  {branch.cancellations.length} İptal ({'₺'}
                  {branch.cancellations.reduce((acc, c) => acc + c.amount, 0).toLocaleString('tr-TR')})
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Filter Modal */}
      <FilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        onApply={setFilters}
        currentFilters={filters}
      />

      {/* Branch Detail Modal */}
      <Modal visible={!!selectedBranch} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {selectedBranch?.branchName}
              </Text>
              <TouchableOpacity onPress={() => setSelectedBranch(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            {selectedBranch && (
              <ScrollView style={styles.modalBody}>
                <View style={styles.modalStats}>
                  <View style={[styles.modalStat, { backgroundColor: colors.cash + '15' }]}>
                    <Ionicons name="cash-outline" size={24} color={colors.cash} />
                    <Text style={[styles.modalStatLabel, { color: colors.textSecondary }]}>Nakit</Text>
                    <Text style={[styles.modalStatValue, { color: colors.text }]}>
                      ₺{selectedBranch.sales.cash.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={[styles.modalStat, { backgroundColor: colors.primary + '15' }]}>
                    <Ionicons name="card-outline" size={24} color={colors.primary} />
                    <Text style={[styles.modalStatLabel, { color: colors.textSecondary }]}>Kart</Text>
                    <Text style={[styles.modalStatValue, { color: colors.text }]}>
                      ₺{selectedBranch.sales.card.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={[styles.modalStat, { backgroundColor: colors.openAccount + '15' }]}>
                    <Ionicons name="wallet-outline" size={24} color={colors.openAccount} />
                    <Text style={[styles.modalStatLabel, { color: colors.textSecondary }]}>Açık Hesap</Text>
                    <Text style={[styles.modalStatValue, { color: colors.text }]}>
                      ₺{selectedBranch.sales.openAccount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={[styles.modalStat, { backgroundColor: colors.total + '15' }]}>
                    <Ionicons name="stats-chart" size={24} color={colors.total} />
                    <Text style={[styles.modalStatLabel, { color: colors.textSecondary }]}>Toplam</Text>
                    <Text style={[styles.modalStatValue, { color: colors.text }]}>
                      ₺{selectedBranch.sales.total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Hour Detail Modal */}
      <Modal visible={!!selectedHour} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {selectedHour?.hour} Satış Detayı
              </Text>
              <TouchableOpacity onPress={() => setSelectedHour(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            {selectedHour && (
              <View style={styles.modalBody}>
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
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Receipt Detail Modal */}
      <Modal visible={!!selectedReceipt} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>İptal Fişi Detayı</Text>
              <TouchableOpacity onPress={() => setSelectedReceipt(null)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            {selectedReceipt && (
              <ScrollView style={styles.modalBody}>
                <View style={[styles.receiptHeader, { backgroundColor: colors.error + '15' }]}>
                  <Text style={[styles.receiptNo, { color: colors.error }]}>
                    {selectedReceipt.receiptNo}
                  </Text>
                  <Text style={[styles.receiptDate, { color: colors.textSecondary }]}>
                    {selectedReceipt.date}
                  </Text>
                  <Text style={[styles.receiptReason, { color: colors.text }]}>
                    Sebep: {selectedReceipt.reason}
                  </Text>
                </View>
                <Text style={[styles.receiptItemsTitle, { color: colors.text }]}>Ürünler</Text>
                {selectedReceipt.items.map((item, index) => (
                  <View
                    key={index}
                    style={[styles.receiptItem, { borderBottomColor: colors.border }]}
                  >
                    <View style={styles.receiptItemInfo}>
                      <Text style={[styles.receiptItemName, { color: colors.text }]}>
                        {item.productName}
                      </Text>
                      <Text style={[styles.receiptItemQty, { color: colors.textSecondary }]}>
                        {item.quantity} x ₺{item.unitPrice.toFixed(2)}
                      </Text>
                    </View>
                    <Text style={[styles.receiptItemTotal, { color: colors.text }]}>
                      ₺{item.total.toFixed(2)}
                    </Text>
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
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  comparisonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  comparisonItem: {
    alignItems: 'center',
    flex: 1,
  },
  comparisonLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  comparisonValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  todayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  todayLabel: {
    fontSize: 14,
  },
  todayValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  branchItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  branchInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  branchIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  branchName: {
    fontSize: 15,
    fontWeight: '500',
  },
  branchAmount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  branchTotal: {
    fontSize: 15,
    fontWeight: '600',
  },
  chart: {
    marginVertical: 8,
    borderRadius: 16,
  },
  hourlyList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    gap: 8,
  },
  hourItem: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 80,
  },
  hourTime: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  hourAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
  hourTx: {
    fontSize: 11,
    marginTop: 2,
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
  },
  modalBody: {
    padding: 20,
  },
  modalStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  modalStat: {
    flex: 1,
    minWidth: '45%',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    gap: 8,
  },
  modalStatLabel: {
    fontSize: 13,
  },
  modalStatValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  hourDetailCard: {
    alignItems: 'center',
    padding: 32,
    borderRadius: 20,
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
  receiptReason: {
    fontSize: 14,
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
