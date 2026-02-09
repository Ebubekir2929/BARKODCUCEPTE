import { BranchSales, HourlySales, Product, ProductMovement, ProductLocationStock, Customer, CustomerMovement, TopProduct, CancelledReceipt } from '../types';

// Branch data
export const branches = [
  { id: '1', name: 'Merkez Şube' },
  { id: '2', name: 'Kadıköy Şube' },
  { id: '3', name: 'Beşiktaş Şube' },
  { id: '4', name: 'Ataşehir Şube' },
  { id: '5', name: 'Maltepe Şube' },
];

// Generate cancelled receipts
const generateCancelledReceipts = (branchId: string): CancelledReceipt[] => [
  {
    id: `cancel-${branchId}-1`,
    receiptNo: `FIS-${branchId}-001`,
    date: '2025-07-15 14:30',
    amount: 245.50,
    reason: 'Müşteri iade talebi',
    items: [
      { productName: 'Coca Cola 1L', quantity: 2, unitPrice: 35.00, total: 70.00 },
      { productName: 'Simit', quantity: 5, unitPrice: 15.00, total: 75.00 },
      { productName: 'Ayran 200ml', quantity: 3, unitPrice: 12.50, total: 37.50 },
    ],
  },
  {
    id: `cancel-${branchId}-2`,
    receiptNo: `FIS-${branchId}-002`,
    date: '2025-07-15 16:45',
    amount: 180.00,
    reason: 'Yanlış ürün',
    items: [
      { productName: 'Peynir 500g', quantity: 1, unitPrice: 120.00, total: 120.00 },
      { productName: 'Ekmek', quantity: 4, unitPrice: 15.00, total: 60.00 },
    ],
  },
];

// Branch sales data
export const branchSalesData: BranchSales[] = [
  {
    branchId: '1',
    branchName: 'Merkez Şube',
    sales: { cash: 15420.50, card: 28350.00, openAccount: 5200.00, total: 48970.50 },
    cancellations: generateCancelledReceipts('1'),
  },
  {
    branchId: '2',
    branchName: 'Kadıköy Şube',
    sales: { cash: 12300.00, card: 22150.50, openAccount: 3800.00, total: 38250.50 },
    cancellations: generateCancelledReceipts('2'),
  },
  {
    branchId: '3',
    branchName: 'Beşiktaş Şube',
    sales: { cash: 18500.00, card: 31200.00, openAccount: 6100.00, total: 55800.00 },
    cancellations: generateCancelledReceipts('3'),
  },
  {
    branchId: '4',
    branchName: 'Ataşehir Şube',
    sales: { cash: 9800.50, card: 18400.00, openAccount: 2500.00, total: 30700.50 },
    cancellations: generateCancelledReceipts('4'),
  },
  {
    branchId: '5',
    branchName: 'Maltepe Şube',
    sales: { cash: 11200.00, card: 19850.50, openAccount: 4100.00, total: 35150.50 },
    cancellations: generateCancelledReceipts('5'),
  },
];

// Hourly sales data
export const hourlySalesData: HourlySales[] = [
  { hour: '08:00', amount: 2450.00, transactions: 15 },
  { hour: '09:00', amount: 4200.50, transactions: 28 },
  { hour: '10:00', amount: 6800.00, transactions: 42 },
  { hour: '11:00', amount: 8500.50, transactions: 55 },
  { hour: '12:00', amount: 15200.00, transactions: 98 },
  { hour: '13:00', amount: 18500.00, transactions: 120 },
  { hour: '14:00', amount: 12400.50, transactions: 78 },
  { hour: '15:00', amount: 9800.00, transactions: 62 },
  { hour: '16:00', amount: 11200.00, transactions: 71 },
  { hour: '17:00', amount: 14500.50, transactions: 89 },
  { hour: '18:00', amount: 16800.00, transactions: 105 },
  { hour: '19:00', amount: 13200.00, transactions: 82 },
  { hour: '20:00', amount: 8900.50, transactions: 54 },
  { hour: '21:00', amount: 5400.00, transactions: 32 },
  { hour: '22:00', amount: 2800.00, transactions: 18 },
];

// Top selling products
export const topSellingProducts: TopProduct[] = [
  { id: '1', name: 'Coca Cola 1L', quantity: 450, revenue: 15750.00 },
  { id: '2', name: 'Simit', quantity: 380, revenue: 5700.00 },
  { id: '3', name: 'Ekmek', quantity: 320, revenue: 4800.00 },
  { id: '4', name: 'Su 500ml', quantity: 290, revenue: 2900.00 },
  { id: '5', name: 'Çikolata Bar', quantity: 250, revenue: 6250.00 },
  { id: '6', name: 'Peynir 500g', quantity: 180, revenue: 21600.00 },
  { id: '7', name: 'Süt 1L', quantity: 165, revenue: 4125.00 },
  { id: '8', name: 'Ayran 200ml', quantity: 155, revenue: 1937.50 },
  { id: '9', name: 'Cips Paket', quantity: 140, revenue: 3500.00 },
  { id: '10', name: 'Dondurma', quantity: 125, revenue: 3125.00 },
];

// Least selling products
export const leastSellingProducts: TopProduct[] = [
  { id: '11', name: 'Konserve Balık', quantity: 5, revenue: 225.00 },
  { id: '12', name: 'Zeytinyağı 2L', quantity: 8, revenue: 720.00 },
  { id: '13', name: 'Bal 500g', quantity: 12, revenue: 1080.00 },
  { id: '14', name: 'Reçel 750g', quantity: 15, revenue: 600.00 },
  { id: '15', name: 'Makarna 1kg', quantity: 18, revenue: 540.00 },
  { id: '16', name: 'Pirinç 2kg', quantity: 22, revenue: 990.00 },
  { id: '17', name: 'Bulgur 1kg', quantity: 25, revenue: 500.00 },
  { id: '18', name: 'Mercimek 1kg', quantity: 28, revenue: 700.00 },
  { id: '19', name: 'Tuz 750g', quantity: 30, revenue: 300.00 },
  { id: '20', name: 'Şeker 2kg', quantity: 35, revenue: 1050.00 },
];

// Products for stock management
export const productsData: Product[] = [
  { id: '1', barcode: '8690000001', name: 'Coca Cola 1L', group: 'İçecekler', kdv: 10, salesPrice: 35.00, purchasePrice: 25.00, quantity: 450, profit: 4500.00 },
  { id: '2', barcode: '8690000002', name: 'Simit', group: 'Unlu Mamüller', kdv: 1, salesPrice: 15.00, purchasePrice: 8.00, quantity: 380, profit: 2660.00 },
  { id: '3', barcode: '8690000003', name: 'Ekmek', group: 'Unlu Mamüller', kdv: 1, salesPrice: 15.00, purchasePrice: 10.00, quantity: 320, profit: 1600.00 },
  { id: '4', barcode: '8690000004', name: 'Su 500ml', group: 'İçecekler', kdv: 1, salesPrice: 10.00, purchasePrice: 5.00, quantity: 290, profit: 1450.00 },
  { id: '5', barcode: '8690000005', name: 'Çikolata Bar', group: 'Atıştırmalık', kdv: 10, salesPrice: 25.00, purchasePrice: 15.00, quantity: 250, profit: 2500.00 },
  { id: '6', barcode: '8690000006', name: 'Peynir 500g', group: 'Süt Ürünleri', kdv: 10, salesPrice: 120.00, purchasePrice: 85.00, quantity: 180, profit: 6300.00 },
  { id: '7', barcode: '8690000007', name: 'Süt 1L', group: 'Süt Ürünleri', kdv: 1, salesPrice: 25.00, purchasePrice: 18.00, quantity: 165, profit: 1155.00 },
  { id: '8', barcode: '8690000008', name: 'Ayran 200ml', group: 'Süt Ürünleri', kdv: 1, salesPrice: 12.50, purchasePrice: 8.00, quantity: 155, profit: 697.50 },
  { id: '9', barcode: '8690000009', name: 'Cips Paket', group: 'Atıştırmalık', kdv: 10, salesPrice: 25.00, purchasePrice: 15.00, quantity: 140, profit: 1400.00 },
  { id: '10', barcode: '8690000010', name: 'Dondurma', group: 'Dondurulmuş', kdv: 10, salesPrice: 25.00, purchasePrice: 12.00, quantity: 125, profit: 1625.00 },
  { id: '11', barcode: '8690000011', name: 'Konserve Balık', group: 'Konserve', kdv: 10, salesPrice: 45.00, purchasePrice: 32.00, quantity: 50, profit: 650.00 },
  { id: '12', barcode: '8690000012', name: 'Zeytinyağı 2L', group: 'Yağlar', kdv: 10, salesPrice: 90.00, purchasePrice: 65.00, quantity: 80, profit: 2000.00 },
  { id: '13', barcode: '8690000013', name: 'Bal 500g', group: 'Kahvaltılık', kdv: 1, salesPrice: 90.00, purchasePrice: 60.00, quantity: 45, profit: 1350.00 },
  { id: '14', barcode: '8690000014', name: 'Reçel 750g', group: 'Kahvaltılık', kdv: 10, salesPrice: 40.00, purchasePrice: 25.00, quantity: 60, profit: 900.00 },
  { id: '15', barcode: '8690000015', name: 'Makarna 1kg', group: 'Temel Gıda', kdv: 1, salesPrice: 30.00, purchasePrice: 20.00, quantity: 120, profit: 1200.00 },
];

// Product location stocks
export const getProductLocationStocks = (productId: string): ProductLocationStock[] => [
  { branchId: '1', branchName: 'Merkez Şube', quantity: Math.floor(Math.random() * 100) + 20 },
  { branchId: '2', branchName: 'Kadıköy Şube', quantity: Math.floor(Math.random() * 80) + 15 },
  { branchId: '3', branchName: 'Beşiktaş Şube', quantity: Math.floor(Math.random() * 90) + 18 },
  { branchId: '4', branchName: 'Ataşehir Şube', quantity: Math.floor(Math.random() * 70) + 10 },
  { branchId: '5', branchName: 'Maltepe Şube', quantity: Math.floor(Math.random() * 60) + 12 },
];

// Product movements
export const getProductMovements = (productId: string): ProductMovement[] => [
  { id: '1', productId, date: '2025-07-15 14:30', type: 'sale', quantity: -5, branchName: 'Merkez Şube', description: 'Satış' },
  { id: '2', productId, date: '2025-07-15 12:15', type: 'sale', quantity: -3, branchName: 'Kadıköy Şube', description: 'Satış' },
  { id: '3', productId, date: '2025-07-14 09:00', type: 'purchase', quantity: 50, branchName: 'Merkez Şube', description: 'Alım - Tedarikçi A' },
  { id: '4', productId, date: '2025-07-13 16:45', type: 'transfer', quantity: -10, branchName: 'Merkez Şube', description: 'Transfer - Kadıköy Şube' },
  { id: '5', productId, date: '2025-07-13 16:45', type: 'transfer', quantity: 10, branchName: 'Kadıköy Şube', description: 'Transfer - Merkez Şube\'den' },
  { id: '6', productId, date: '2025-07-12 11:30', type: 'sale', quantity: -8, branchName: 'Beşiktaş Şube', description: 'Satış' },
  { id: '7', productId, date: '2025-07-11 10:00', type: 'adjustment', quantity: -2, branchName: 'Ataşehir Şube', description: 'Sayım Farkı' },
];

// Customers data
export const customersData: Customer[] = [
  { id: '1', name: 'Ahmet Yılmaz', phone: '0532 111 2233', email: 'ahmet@email.com', balance: -2500.00, totalDebt: 2500.00, totalCredit: 0 },
  { id: '2', name: 'Mehmet Kaya', phone: '0533 222 3344', email: 'mehmet@email.com', balance: 1200.00, totalDebt: 0, totalCredit: 1200.00 },
  { id: '3', name: 'Ayşe Demir', phone: '0534 333 4455', email: 'ayse@email.com', balance: -5800.00, totalDebt: 5800.00, totalCredit: 0 },
  { id: '4', name: 'Fatma Öztürk', phone: '0535 444 5566', email: 'fatma@email.com', balance: -1500.00, totalDebt: 1500.00, totalCredit: 0 },
  { id: '5', name: 'Ali Şahin', phone: '0536 555 6677', email: 'ali@email.com', balance: 3200.00, totalDebt: 0, totalCredit: 3200.00 },
  { id: '6', name: 'Zeynep Arslan', phone: '0537 666 7788', email: 'zeynep@email.com', balance: -8500.00, totalDebt: 8500.00, totalCredit: 0 },
  { id: '7', name: 'Can Yıldız', phone: '0538 777 8899', email: 'can@email.com', balance: -4200.00, totalDebt: 4200.00, totalCredit: 0 },
  { id: '8', name: 'Selin Koç', phone: '0539 888 9900', email: 'selin@email.com', balance: 500.00, totalDebt: 0, totalCredit: 500.00 },
];

// Customer movements
export const getCustomerMovements = (customerId: string): CustomerMovement[] => [
  {
    id: '1',
    customerId,
    date: '2025-07-15 14:30',
    type: 'invoice',
    amount: -1250.00,
    description: 'Fatura #F2025-001',
    invoiceDetails: [
      { productName: 'Coca Cola 1L', quantity: 10, unitPrice: 35.00, total: 350.00 },
      { productName: 'Peynir 500g', quantity: 5, unitPrice: 120.00, total: 600.00 },
      { productName: 'Ekmek', quantity: 20, unitPrice: 15.00, total: 300.00 },
    ],
  },
  {
    id: '2',
    customerId,
    date: '2025-07-14 10:15',
    type: 'payment',
    amount: 2000.00,
    description: 'Nakit Ödeme',
  },
  {
    id: '3',
    customerId,
    date: '2025-07-12 16:45',
    type: 'invoice',
    amount: -3500.00,
    description: 'Fatura #F2025-002',
    invoiceDetails: [
      { productName: 'Zeytinyağı 2L', quantity: 20, unitPrice: 90.00, total: 1800.00 },
      { productName: 'Bal 500g', quantity: 10, unitPrice: 90.00, total: 900.00 },
      { productName: 'Reçel 750g', quantity: 20, unitPrice: 40.00, total: 800.00 },
    ],
  },
  {
    id: '4',
    customerId,
    date: '2025-07-10 09:00',
    type: 'payment',
    amount: 1500.00,
    description: 'Havale - İş Bankası',
  },
  {
    id: '5',
    customerId,
    date: '2025-07-08 11:30',
    type: 'refund',
    amount: 250.00,
    description: 'İade - Hasarlı ürün',
  },
];

// Weekly comparison data
export const weeklyComparisonData = {
  lastWeek: { cash: 52000.00, card: 95000.00, openAccount: 18000.00, total: 165000.00 },
  thisWeek: { cash: 67221.00, card: 119951.00, openAccount: 21700.00, total: 208872.00 },
};

// Today's totals
export const todayTotals = {
  cash: 12450.50,
  card: 22150.00,
  openAccount: 4200.00,
  total: 38800.50,
};
