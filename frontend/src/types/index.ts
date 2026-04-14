// Types for the POS/Sales Management App

export interface TenantSource {
  tenant_id: string;
  name: string;
  added_at?: string;
}

export interface User {
  id: string;
  full_name: string;
  username: string;
  email: string;
  tax_number: string;
  business_type: 'normal' | 'restoran';
  tenants: TenantSource[];
  role: string;
  created_at?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface SalesData {
  cash: number;
  card: number;
  openAccount: number;
  total: number;
}

export interface BranchSales {
  branchId: string;
  branchName: string;
  sales: SalesData;
  cancellations: CancelledReceipt[];
}

export interface HourlyProductSale {
  productName: string;
  quantity: number;
  revenue: number;
}

export interface HourlySales {
  hour: string;
  amount: number;
  transactions: number;
  products?: HourlyProductSale[];
}

export interface Product {
  id: string;
  barcode: string;
  name: string;
  group: string;
  kdv: number; // VAT percentage
  salesPrice: number;
  purchasePrice: number;
  quantity: number;
  profit: number;
}

export interface ProductMovement {
  id: string;
  productId: string;
  date: string;
  type: 'sale' | 'purchase' | 'transfer' | 'adjustment';
  quantity: number;
  branchName: string;
  description: string;
}

export interface ProductLocationStock {
  branchId: string;
  branchName: string;
  quantity: number;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  balance: number;
  totalDebt: number;
  totalCredit: number;
}

export interface CustomerMovement {
  id: string;
  customerId: string;
  date: string;
  type: 'invoice' | 'payment' | 'refund';
  amount: number;
  description: string;
  invoiceDetails?: InvoiceDetail[];
}

export interface InvoiceDetail {
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface CancelledReceipt {
  id: string;
  receiptNo: string;
  date: string;
  amount: number;
  reason: string;
  items: InvoiceDetail[];
}

export interface DashboardFilter {
  startDate: Date;
  endDate: Date;
  branchId: string | null;
}

export interface TopProduct {
  id: string;
  name: string;
  quantity: number;
  revenue: number;
}

export interface OpenTable {
  id: string;
  tableNo: string;
  customerName: string;
  customerId: string;
  amount: number;        // Tutar (toplam hesap)
  paidAmount: number;    // Ödenen tutar
  remainingAmount: number; // Kalan tutar
  location: string;      // Lokasyon/Şube
  section: string;       // Bölüm (Salon, Bahçe vb.)
  openedAt: string;      // Açılış zamanı
  itemCount: number;     // Ürün sayısı
  dataSource: string;    // Veri kaynağı
}


export interface WaiterSale {
  id: string;
  name: string;
  location: string;
  totalSales: number;
  cashSales: number;
  cardSales: number;
  transactionCount: number;
  averageTicket: number;
  topProduct: string;
  workingHours: string;
}

export interface WaiterLocation {
  location: string;
  totalSales: number;
  waiterCount: number;
  waiters: WaiterSale[];
}
