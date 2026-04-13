import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useDataSourceStore } from '../../src/store/dataSourceStore';
import { ActiveSourceIndicator } from '../../src/components/DataSourceSelector';
import { getDataBySource } from '../../src/data/mockData';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useAlert, CustomAlert } from '../../src/components/CustomAlert';

type ReportType = 'sales' | 'stock' | 'customers' | 'products' | 'hourly';

interface Report {
  id: ReportType;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
}

interface ReportFilters {
  branchId: string | null;
  startDate: Date;
  endDate: Date;
}

const reports: Report[] = [
  { id: 'sales', title: 'Şube Satış Raporu', icon: 'storefront-outline', description: 'Şube bazında satış verileri' },
  { id: 'stock', title: 'Stok Durum Raporu', icon: 'cube-outline', description: 'Tüm ürünlerin stok durumu' },
  { id: 'customers', title: 'Cari Hesap Raporu', icon: 'people-outline', description: 'Cari hesap bakiyeleri' },
  { id: 'products', title: 'Ürün Performans Raporu', icon: 'trending-up-outline', description: 'En çok/az satan ürünler' },
  { id: 'hourly', title: 'Saatlik Satış Raporu', icon: 'time-outline', description: 'Saatlik satış dağılımı' },
];

const quickDateOptions = [
  { label: 'Bugün', days: 0 },
  { label: 'Dün', days: 1 },
  { label: 'Son 7 Gün', days: 7 },
  { label: 'Son 30 Gün', days: 30 },
  { label: 'Bu Ay', days: -1 },
];

export default function ReportsScreen() {
  const { colors } = useThemeStore();
  const { activeSource } = useDataSourceStore();
  const sourceData = useMemo(() => getDataBySource(activeSource), [activeSource]);
  const { showSuccess, showError, alertProps } = useAlert();
  const [selectedReport, setSelectedReport] = useState<ReportType | null>(null);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  
  const [filters, setFilters] = useState<ReportFilters>({
    branchId: null,
    startDate: new Date(),
    endDate: new Date(),
  });
  const [startDateInput, setStartDateInput] = useState(formatDateForInput(new Date()));
  const [endDateInput, setEndDateInput] = useState(formatDateForInput(new Date()));
  const [pendingReport, setPendingReport] = useState<ReportType | null>(null);

  function formatDateForInput(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  const parseDate = (input: string): Date | null => {
    const cleaned = input.replace(/[.\-]/g, '/');
    const parts = cleaned.split('/');
    
    if (parts.length === 3) {
      const day = parseInt(parts[0]);
      const month = parseInt(parts[1]);
      const year = parseInt(parts[2]);
      
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2020 && year <= 2030) {
        return new Date(year, month - 1, day);
      }
    }
    return null;
  };

  const handleStartDateChange = (text: string) => {
    setStartDateInput(text);
    const parsed = parseDate(text);
    if (parsed) {
      setFilters(prev => ({ ...prev, startDate: parsed }));
    }
  };

  const handleEndDateChange = (text: string) => {
    setEndDateInput(text);
    const parsed = parseDate(text);
    if (parsed) {
      setFilters(prev => ({ ...prev, endDate: parsed }));
    }
  };

  const onStartDatePickerChange = (event: any, selectedDate?: Date) => {
    setShowStartPicker(Platform.OS === 'ios');
    if (selectedDate) {
      setFilters(prev => ({ ...prev, startDate: selectedDate }));
      setStartDateInput(formatDateForInput(selectedDate));
    }
  };

  const onEndDatePickerChange = (event: any, selectedDate?: Date) => {
    setShowEndPicker(Platform.OS === 'ios');
    if (selectedDate) {
      setFilters(prev => ({ ...prev, endDate: selectedDate }));
      setEndDateInput(formatDateForInput(selectedDate));
    }
  };

  const selectQuickDate = (days: number) => {
    const end = new Date();
    let start = new Date();
    
    if (days === -1) {
      start = new Date(end.getFullYear(), end.getMonth(), 1);
    } else if (days === 0) {
      start = new Date();
    } else {
      start.setDate(start.getDate() - days);
    }
    
    setFilters(prev => ({ ...prev, startDate: start, endDate: end }));
    setStartDateInput(formatDateForInput(start));
    setEndDateInput(formatDateForInput(end));
  };

  const handleReportSelect = (reportId: ReportType) => {
    setPendingReport(reportId);
    setShowFilterModal(true);
  };

  const applyFiltersAndOpenReport = () => {
    setShowFilterModal(false);
    setSelectedReport(pendingReport);
    setShowReportModal(true);
  };

  const generateCSV = (reportType: ReportType): string => {
    let csv = '';

    switch (reportType) {
      case 'sales':
        csv = 'Şube,Nakit,Kart,Açık Hesap,Toplam\n';
        const filteredSales = filters.branchId 
          ? sourceData.branchSales.filter(b => b.branchId === filters.branchId)
          : sourceData.branchSales;
        filteredSales.forEach((b) => {
          csv += `${b.branchName},${b.sales.cash},${b.sales.card},${b.sales.openAccount},${b.sales.total}\n`;
        });
        break;
      case 'stock':
        csv = 'Barkod,Ürün Adı,Grup,KDV,Alış,Satış,Miktar,Kar\n';
        sourceData.products.forEach((p) => {
          csv += `${p.barcode},${p.name},${p.group},${p.kdv},${p.purchasePrice},${p.salesPrice},${p.quantity},${p.profit}\n`;
        });
        break;
      case 'customers':
        csv = 'Cari Adı,Telefon,Email,Bakiye\n';
        sourceData.customers.forEach((c) => {
          csv += `${c.name},${c.phone || '-'},${c.email || '-'},${c.balance}\n`;
        });
        break;
      case 'products':
        csv = 'Sıra,Ürün Adı,Satış Adedi,Ciro,Tip\n';
        sourceData.topSelling.forEach((p, i) => {
          csv += `${i + 1},${p.name},${p.quantity},${p.revenue},En Çok Satan\n`;
        });
        sourceData.leastSelling.forEach((p, i) => {
          csv += `${i + 1},${p.name},${p.quantity},${p.revenue},En Az Satan\n`;
        });
        break;
      case 'hourly':
        csv = 'Saat,Tutar,İşlem Sayısı\n';
        sourceData.hourlySales.forEach((h) => {
          csv += `${h.hour},${h.amount},${h.transactions}\n`;
        });
        break;
    }

    return csv;
  };

  const exportReport = async (format: 'csv' | 'pdf') => {
    if (!selectedReport) return;

    setExporting(true);
    try {
      const reportTitle = reports.find((r) => r.id === selectedReport)?.title || 'Rapor';
      const date = new Date().toISOString().split('T')[0];
      const fileName = `${reportTitle.replace(/\s/g, '_')}_${date}`;

      if (format === 'csv') {
        const csv = generateCSV(selectedReport);
        const fileUri = FileSystem.documentDirectory + fileName + '.csv';
        await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'text/csv',
            dialogTitle: `${reportTitle} Paylaş`,
          });
        } else {
          showSuccess('Başarılı', 'Rapor oluşturuldu');
        }
      } else {
        const html = generateHTMLReport(selectedReport, reportTitle);
        const fileUri = FileSystem.documentDirectory + fileName + '.html';
        await FileSystem.writeAsStringAsync(fileUri, html, { encoding: FileSystem.EncodingType.UTF8 });

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'text/html',
            dialogTitle: `${reportTitle} Paylaş`,
          });
        } else {
          showSuccess('Başarılı', 'Rapor oluşturuldu');
        }
      }
    } catch (error) {
      showError('Hata', 'Rapor dışa aktarılırken bir hata oluştu');
    } finally {
      setExporting(false);
      setShowExportModal(false);
    }
  };

  const generateHTMLReport = (reportType: ReportType, title: string): string => {
    const date = new Date().toLocaleDateString('tr-TR');
    let tableContent = '';

    switch (reportType) {
      case 'sales':
        const filteredSales = filters.branchId 
          ? sourceData.branchSales.filter(b => b.branchId === filters.branchId)
          : sourceData.branchSales;
        tableContent = `
          <tr><th>Şube</th><th>Nakit</th><th>Kart</th><th>Açık Hesap</th><th>Toplam</th></tr>
          ${filteredSales.map((b) => `
            <tr>
              <td>${b.branchName}</td>
              <td>₺${b.sales.cash.toLocaleString('tr-TR')}</td>
              <td>₺${b.sales.card.toLocaleString('tr-TR')}</td>
              <td>₺${b.sales.openAccount.toLocaleString('tr-TR')}</td>
              <td><strong>₺${b.sales.total.toLocaleString('tr-TR')}</strong></td>
            </tr>
          `).join('')}
        `;
        break;
      case 'stock':
        tableContent = `
          <tr><th>Barkod</th><th>Ürün</th><th>Grup</th><th>Alış</th><th>Satış</th><th>Stok</th></tr>
          ${sourceData.products.map((p) => `
            <tr>
              <td>${p.barcode}</td>
              <td>${p.name}</td>
              <td>${p.group}</td>
              <td>₺${p.purchasePrice}</td>
              <td>₺${p.salesPrice}</td>
              <td>${p.quantity}</td>
            </tr>
          `).join('')}
        `;
        break;
      case 'customers':
        tableContent = `
          <tr><th>Cari Adı</th><th>Telefon</th><th>Email</th><th>Bakiye</th></tr>
          ${sourceData.customers.map((c) => `
            <tr>
              <td>${c.name}</td>
              <td>${c.phone || '-'}</td>
              <td>${c.email || '-'}</td>
              <td style="color: ${c.balance >= 0 ? 'green' : 'red'}">₺${c.balance.toLocaleString('tr-TR')}</td>
            </tr>
          `).join('')}
        `;
        break;
      case 'products':
        tableContent = `
          <tr><th>Sıra</th><th>Ürün</th><th>Adet</th><th>Ciro</th></tr>
          <tr><td colspan="4" style="background:#e8f5e9;"><strong>En Çok Satanlar</strong></td></tr>
          ${sourceData.topSelling.map((p, i) => `
            <tr><td>${i + 1}</td><td>${p.name}</td><td>${p.quantity}</td><td>₺${p.revenue.toLocaleString('tr-TR')}</td></tr>
          `).join('')}
          <tr><td colspan="4" style="background:#ffebee;"><strong>En Az Satanlar</strong></td></tr>
          ${sourceData.leastSelling.map((p, i) => `
            <tr><td>${i + 1}</td><td>${p.name}</td><td>${p.quantity}</td><td>₺${p.revenue.toLocaleString('tr-TR')}</td></tr>
          `).join('')}
        `;
        break;
      case 'hourly':
        tableContent = `
          <tr><th>Saat</th><th>Tutar</th><th>İşlem</th></tr>
          ${sourceData.hourlySales.map((h) => `
            <tr><td>${h.hour}</td><td>₺${h.amount.toLocaleString('tr-TR')}</td><td>${h.transactions}</td></tr>
          `).join('')}
        `;
        break;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h1 { color: #2563eb; }
          .date { color: #666; margin-bottom: 20px; }
          .filters { background: #f5f5f5; padding: 10px; border-radius: 8px; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
          th { background: #2563eb; color: white; }
          tr:nth-child(even) { background: #f9f9f9; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        <p class="date">Tarih: ${date}</p>
        <div class="filters">
          <strong>Filtreler:</strong> 
          ${filters.branchId ? `Şube: ${sourceData.branches.find(b => b.id === filters.branchId)?.name || 'Tümü'}` : 'Tüm Şubeler'}
          | ${formatDateForInput(filters.startDate)} - ${formatDateForInput(filters.endDate)}
        </div>
        <table>${tableContent}</table>
      </body>
      </html>
    `;
  };

  const renderReportContent = () => {
    switch (selectedReport) {
      case 'sales':
        const filteredSales = filters.branchId 
          ? sourceData.branchSales.filter(b => b.branchId === filters.branchId)
          : sourceData.branchSales;
        return (
          <>
            <View style={styles.reportHeader}>
              <Text style={[styles.reportTitle, { color: colors.text }]}>Şube Satış Raporu</Text>
              <Text style={[styles.reportDate, { color: colors.textSecondary }]}>
                {new Date().toLocaleDateString('tr-TR')}
              </Text>
            </View>
            {filteredSales.map((branch) => (
              <View key={branch.branchId} style={[styles.reportRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.reportRowTitle, { color: colors.text }]}>{branch.branchName}</Text>
                <View style={styles.reportRowValues}>
                  <View style={styles.reportValue}>
                    <Text style={[styles.reportValueLabel, { color: colors.textSecondary }]}>Nakit</Text>
                    <Text style={[styles.reportValueAmount, { color: colors.cash }]}>
                      ₺{branch.sales.cash.toLocaleString('tr-TR')}
                    </Text>
                  </View>
                  <View style={styles.reportValue}>
                    <Text style={[styles.reportValueLabel, { color: colors.textSecondary }]}>Kart</Text>
                    <Text style={[styles.reportValueAmount, { color: colors.primary }]}>
                      ₺{branch.sales.card.toLocaleString('tr-TR')}
                    </Text>
                  </View>
                  <View style={styles.reportValue}>
                    <Text style={[styles.reportValueLabel, { color: colors.textSecondary }]}>Toplam</Text>
                    <Text style={[styles.reportValueAmount, { color: colors.text }]}>
                      ₺{branch.sales.total.toLocaleString('tr-TR')}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </>
        );
      case 'stock':
        return (
          <>
            <View style={styles.reportHeader}>
              <Text style={[styles.reportTitle, { color: colors.text }]}>Stok Durum Raporu</Text>
              <Text style={[styles.reportDate, { color: colors.textSecondary }]}>
                {sourceData.products.length} ürün
              </Text>
            </View>
            {sourceData.products.slice(0, 10).map((product) => (
              <View key={product.id} style={[styles.reportRow, { borderBottomColor: colors.border }]}>
                <View style={styles.productReportInfo}>
                  <Text style={[styles.reportRowTitle, { color: colors.text }]}>{product.name}</Text>
                  <Text style={[styles.reportRowSub, { color: colors.textSecondary }]}>{product.barcode}</Text>
                </View>
                <View style={styles.productReportValues}>
                  <Text style={[styles.stockQty, { color: product.quantity > 50 ? colors.success : colors.warning }]}>
                    {product.quantity} adet
                  </Text>
                  <Text style={[styles.stockPrice, { color: colors.text }]}>₺{product.salesPrice}</Text>
                </View>
              </View>
            ))}
          </>
        );
      case 'customers':
        return (
          <>
            <View style={styles.reportHeader}>
              <Text style={[styles.reportTitle, { color: colors.text }]}>Cari Hesap Raporu</Text>
              <Text style={[styles.reportDate, { color: colors.textSecondary }]}>
                {sourceData.customers.length} cari
              </Text>
            </View>
            {sourceData.customers.map((customer) => (
              <View key={customer.id} style={[styles.reportRow, { borderBottomColor: colors.border }]}>
                <View style={styles.customerReportInfo}>
                  <Text style={[styles.reportRowTitle, { color: colors.text }]}>{customer.name}</Text>
                  <Text style={[styles.reportRowSub, { color: colors.textSecondary }]}>
                    {customer.phone || customer.email || '-'}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.customerBalance,
                    { color: customer.balance >= 0 ? colors.success : colors.error },
                  ]}
                >
                  {customer.balance >= 0 ? '+' : ''}₺{customer.balance.toLocaleString('tr-TR')}
                </Text>
              </View>
            ))}
          </>
        );
      case 'products':
        return (
          <>
            <View style={styles.reportHeader}>
              <Text style={[styles.reportTitle, { color: colors.text }]}>Ürün Performans Raporu</Text>
            </View>
            <Text style={[styles.subSectionTitle, { color: colors.success }]}>En Çok Satanlar</Text>
            {sourceData.topSelling.slice(0, 5).map((p, i) => (
              <View key={p.id} style={[styles.reportRow, { borderBottomColor: colors.border }]}>
                <View style={[styles.rankBadge, { backgroundColor: colors.success + '20' }]}>
                  <Text style={[styles.rankText, { color: colors.success }]}>{i + 1}</Text>
                </View>
                <View style={styles.productPerformInfo}>
                  <Text style={[styles.reportRowTitle, { color: colors.text }]}>{p.name}</Text>
                  <Text style={[styles.reportRowSub, { color: colors.textSecondary }]}>{p.quantity} adet</Text>
                </View>
                <Text style={[styles.performRevenue, { color: colors.success }]}>
                  ₺{p.revenue.toLocaleString('tr-TR')}
                </Text>
              </View>
            ))}
            <Text style={[styles.subSectionTitle, { color: colors.error, marginTop: 16 }]}>En Az Satanlar</Text>
            {sourceData.leastSelling.slice(0, 5).map((p, i) => (
              <View key={p.id} style={[styles.reportRow, { borderBottomColor: colors.border }]}>
                <View style={[styles.rankBadge, { backgroundColor: colors.error + '20' }]}>
                  <Text style={[styles.rankText, { color: colors.error }]}>{i + 1}</Text>
                </View>
                <View style={styles.productPerformInfo}>
                  <Text style={[styles.reportRowTitle, { color: colors.text }]}>{p.name}</Text>
                  <Text style={[styles.reportRowSub, { color: colors.textSecondary }]}>{p.quantity} adet</Text>
                </View>
                <Text style={[styles.performRevenue, { color: colors.error }]}>
                  ₺{p.revenue.toLocaleString('tr-TR')}
                </Text>
              </View>
            ))}
          </>
        );
      case 'hourly':
        const maxAmount = Math.max(...sourceData.hourlySales.map((h) => h.amount));
        return (
          <>
            <View style={styles.reportHeader}>
              <Text style={[styles.reportTitle, { color: colors.text }]}>Saatlik Satış Raporu</Text>
            </View>
            {sourceData.hourlySales.map((hour) => (
              <View key={hour.hour} style={[styles.hourlyRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.hourTime, { color: colors.text }]}>{hour.hour}</Text>
                <View style={styles.hourlyBarContainer}>
                  <View
                    style={[
                      styles.hourlyBar,
                      {
                        backgroundColor: colors.primary,
                        width: `${(hour.amount / maxAmount) * 100}%`,
                      },
                    ]}
                  />
                </View>
                <View style={styles.hourlyValues}>
                  <Text style={[styles.hourlyAmount, { color: colors.text }]}>
                    ₺{(hour.amount / 1000).toFixed(1)}K
                  </Text>
                  <Text style={[styles.hourlyTx, { color: colors.textSecondary }]}>{hour.transactions}</Text>
                </View>
              </View>
            ))}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Global Data Source Selector */}
      <ActiveSourceIndicator />
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Raporlar</Text>
      </View>

      <ScrollView style={styles.scrollView}>
        {/* Report List */}
        <View style={styles.reportList}>
          <Text style={[styles.listTitle, { color: colors.textSecondary }]}>
            Rapor seçin ve filtreleri belirleyin
          </Text>
          {reports.map((report) => (
            <TouchableOpacity
              key={report.id}
              style={[styles.reportCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => handleReportSelect(report.id)}
            >
              <View style={[styles.reportIcon, { backgroundColor: colors.primary + '20' }]}>
                <Ionicons name={report.icon} size={24} color={colors.primary} />
              </View>
              <View style={styles.reportInfo}>
                <Text style={[styles.reportCardTitle, { color: colors.text }]}>{report.title}</Text>
                <Text style={[styles.reportCardDesc, { color: colors.textSecondary }]}>
                  {report.description}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Filter Modal */}
      <Modal visible={showFilterModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Rapor Filtreleri</Text>
              <TouchableOpacity onPress={() => setShowFilterModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
              {/* Branch Filter */}
              <Text style={[styles.filterLabel, { color: colors.text }]}>Şube Seçimi</Text>
              <View style={styles.filterOptions}>
                <TouchableOpacity
                  style={[
                    styles.filterOption,
                    { borderColor: colors.border },
                    filters.branchId === null && { backgroundColor: colors.primary + '20', borderColor: colors.primary },
                  ]}
                  onPress={() => setFilters(prev => ({ ...prev, branchId: null }))}
                >
                  <Text style={[styles.filterOptionText, { color: filters.branchId === null ? colors.primary : colors.text }]}>
                    Tüm Şubeler
                  </Text>
                </TouchableOpacity>
                {sourceData.branches.map((branch) => (
                  <TouchableOpacity
                    key={branch.id}
                    style={[
                      styles.filterOption,
                      { borderColor: colors.border },
                      filters.branchId === branch.id && { backgroundColor: colors.primary + '20', borderColor: colors.primary },
                    ]}
                    onPress={() => setFilters(prev => ({ ...prev, branchId: branch.id }))}
                  >
                    <Text style={[styles.filterOptionText, { color: filters.branchId === branch.id ? colors.primary : colors.text }]}>
                      {branch.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Quick Date Selection */}
              <Text style={[styles.filterLabel, { color: colors.text }]}>Hızlı Tarih</Text>
              <View style={styles.filterOptions}>
                {quickDateOptions.map((option) => (
                  <TouchableOpacity
                    key={option.label}
                    style={[
                      styles.filterOption,
                      { borderColor: colors.border },
                    ]}
                    onPress={() => selectQuickDate(option.days)}
                  >
                    <Text style={[styles.filterOptionText, { color: colors.text }]}>{option.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Date Filters with Picker */}
              <Text style={[styles.filterLabel, { color: colors.text }]}>Tarih Aralığı</Text>
              <View style={styles.dateInputs}>
                <View style={styles.dateInputWrapper}>
                  <Text style={[styles.dateInputLabel, { color: colors.textSecondary }]}>Başlangıç</Text>
                  <View style={[styles.dateInputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <TextInput
                      style={[styles.dateInput, { color: colors.text }]}
                      placeholder="GG/AA/YYYY"
                      placeholderTextColor={colors.textSecondary}
                      value={startDateInput}
                      onChangeText={handleStartDateChange}
                      keyboardType="numbers-and-punctuation"
                      maxLength={10}
                    />
                    <TouchableOpacity onPress={() => setShowStartPicker(true)} style={styles.calendarBtn}>
                      <Ionicons name="calendar" size={20} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.dateInputWrapper}>
                  <Text style={[styles.dateInputLabel, { color: colors.textSecondary }]}>Bitiş</Text>
                  <View style={[styles.dateInputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <TextInput
                      style={[styles.dateInput, { color: colors.text }]}
                      placeholder="GG/AA/YYYY"
                      placeholderTextColor={colors.textSecondary}
                      value={endDateInput}
                      onChangeText={handleEndDateChange}
                      keyboardType="numbers-and-punctuation"
                      maxLength={10}
                    />
                    <TouchableOpacity onPress={() => setShowEndPicker(true)} style={styles.calendarBtn}>
                      <Ionicons name="calendar" size={20} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* Date Pickers */}
              {showStartPicker && (
                <DateTimePicker
                  value={filters.startDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={onStartDatePickerChange}
                  locale="tr-TR"
                />
              )}
              {showEndPicker && (
                <DateTimePicker
                  value={filters.endDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={onEndDatePickerChange}
                  locale="tr-TR"
                />
              )}

              {/* Selected Date Display */}
              <View style={[styles.selectedDateDisplay, { backgroundColor: colors.background }]}>
                <Ionicons name="time-outline" size={18} color={colors.primary} />
                <Text style={[styles.selectedDateText, { color: colors.text }]}>
                  {formatDateForInput(filters.startDate)} - {formatDateForInput(filters.endDate)}
                </Text>
              </View>

              <Text style={[styles.dateHint, { color: colors.textSecondary }]}>
                Elle yazın veya takvim ikonuna tıklayın
              </Text>
            </ScrollView>
            <View style={[styles.modalFooter, { borderTopColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: colors.border }]}
                onPress={() => setShowFilterModal(false)}
              >
                <Text style={[styles.cancelBtnText, { color: colors.text }]}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.viewReportBtn, { backgroundColor: colors.primary }]}
                onPress={applyFiltersAndOpenReport}
              >
                <Text style={styles.viewReportBtnText}>Raporu Görüntüle</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Report View Modal */}
      <Modal visible={showReportModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, maxHeight: '90%' }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <TouchableOpacity
                style={styles.backBtn}
                onPress={() => setShowReportModal(false)}
              >
                <Ionicons name="arrow-back" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.modalTitle, { color: colors.text, flex: 1, textAlign: 'center' }]}>
                {reports.find(r => r.id === selectedReport)?.title}
              </Text>
              <TouchableOpacity
                style={[styles.exportIconBtn, { backgroundColor: colors.primary }]}
                onPress={() => setShowExportModal(true)}
              >
                <Ionicons name="share-outline" size={20} color="#FFF" />
              </TouchableOpacity>
            </View>
            
            {/* Applied Filters Display */}
            <View style={[styles.appliedFilters, { backgroundColor: colors.background }]}>
              <Text style={[styles.appliedFiltersText, { color: colors.textSecondary }]}>
                {filters.branchId ? sourceData.branches.find(b => b.id === filters.branchId)?.name : 'Tüm Şubeler'}
                {` • ${formatDateForInput(filters.startDate)} - ${formatDateForInput(filters.endDate)}`}
              </Text>
            </View>

            <ScrollView style={styles.reportContent} contentContainerStyle={styles.reportContentContainer}>
              {renderReportContent()}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Export Modal */}
      <Modal visible={showExportModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Dışa Aktar</Text>
              <TouchableOpacity onPress={() => setShowExportModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalBody}>
              <TouchableOpacity
                style={[styles.exportOption, { backgroundColor: colors.success + '15', borderColor: colors.success }]}
                onPress={() => exportReport('csv')}
                disabled={exporting}
              >
                <Ionicons name="document-text-outline" size={32} color={colors.success} />
                <Text style={[styles.exportOptionTitle, { color: colors.text }]}>CSV / Excel</Text>
                <Text style={[styles.exportOptionDesc, { color: colors.textSecondary }]}>
                  Tablolar için ideal format
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.exportOption, { backgroundColor: colors.error + '15', borderColor: colors.error }]}
                onPress={() => exportReport('pdf')}
                disabled={exporting}
              >
                <Ionicons name="document-outline" size={32} color={colors.error} />
                <Text style={[styles.exportOptionTitle, { color: colors.text }]}>HTML / PDF</Text>
                <Text style={[styles.exportOptionDesc, { color: colors.textSecondary }]}>
                  Baskıya hazır format
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Custom Alert */}
      <CustomAlert {...alertProps} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  reportList: {
    padding: 16,
  },
  listTitle: {
    fontSize: 14,
    marginBottom: 16,
  },
  reportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  reportIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  reportInfo: {
    flex: 1,
  },
  reportCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  reportCardDesc: {
    fontSize: 13,
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
  backBtn: {
    padding: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  exportIconBtn: {
    padding: 8,
    borderRadius: 10,
  },
  modalBody: {
    padding: 20,
  },
  modalBodyContent: {
    paddingBottom: 50,
  },
  filterLabel: {
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
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterOptionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  dateInputs: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  dateInputWrapper: {
    flex: 1,
  },
  dateInputLabel: {
    fontSize: 12,
    marginBottom: 6,
  },
  dateInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  dateInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
  },
  calendarBtn: {
    padding: 8,
  },
  selectedDateDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 10,
    gap: 8,
    marginBottom: 8,
  },
  selectedDateText: {
    fontSize: 14,
    fontWeight: '600',
  },
  dateHint: {
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 10,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  viewReportBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  viewReportBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  appliedFilters: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  appliedFiltersText: {
    fontSize: 13,
  },
  reportContent: {
    padding: 20,
  },
  reportContentContainer: {
    paddingBottom: 50,
  },
  reportHeader: {
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  reportTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  reportDate: {
    fontSize: 13,
  },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  reportRowTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  reportRowSub: {
    fontSize: 12,
    marginTop: 2,
  },
  reportRowValues: {
    flexDirection: 'row',
    marginTop: 8,
    gap: 16,
  },
  reportValue: {
    alignItems: 'center',
  },
  reportValueLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  reportValueAmount: {
    fontSize: 13,
    fontWeight: '600',
  },
  productReportInfo: {
    flex: 1,
  },
  productReportValues: {
    alignItems: 'flex-end',
  },
  stockQty: {
    fontSize: 14,
    fontWeight: '600',
  },
  stockPrice: {
    fontSize: 12,
    marginTop: 2,
  },
  customerReportInfo: {
    flex: 1,
  },
  customerBalance: {
    fontSize: 16,
    fontWeight: '700',
  },
  subSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rankText: {
    fontSize: 13,
    fontWeight: '700',
  },
  productPerformInfo: {
    flex: 1,
  },
  performRevenue: {
    fontSize: 14,
    fontWeight: '600',
  },
  hourlyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  hourTime: {
    width: 50,
    fontSize: 13,
    fontWeight: '500',
  },
  hourlyBarContainer: {
    flex: 1,
    height: 20,
    backgroundColor: '#E5E7EB20',
    borderRadius: 4,
    marginHorizontal: 10,
    overflow: 'hidden',
  },
  hourlyBar: {
    height: '100%',
    borderRadius: 4,
  },
  hourlyValues: {
    width: 60,
    alignItems: 'flex-end',
  },
  hourlyAmount: {
    fontSize: 12,
    fontWeight: '600',
  },
  hourlyTx: {
    fontSize: 10,
  },
  exportOption: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  exportOptionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 4,
  },
  exportOptionDesc: {
    fontSize: 13,
  },
});
