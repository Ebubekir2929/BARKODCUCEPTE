/**
 * Fiyat Güncelleme Ekranı
 * 2026-05-21 — Kullanıcı kararı:
 *   1c) Tek + Toplu + Bekleyenler listesi (tam paket)
 *   2c) Direkt fiyat, yüzde, sabit miktar — özelleştirilebilir
 *   3a) Sadece fiyat
 *   4c) Şifre ile onay
 *   5a) Backend MariaDB'ye yazıyor, Windows client polling yapacak
 *
 * Mimari: POS API kredisi yakmaz — sadece patron.pending_price_updates tablosu.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Modal,
  ScrollView, ActivityIndicator, FlatList, KeyboardAvoidingView,
  Platform, RefreshControl, Keyboard, TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeStore } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';
import { useDataSourceStore } from '../../src/store/dataSourceStore';
import { useAlert, CustomAlert } from '../../src/components/CustomAlert';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

type PendingUpdate = {
  id: number;
  product_id: string;
  product_barcode?: string | null;
  product_name?: string | null;
  old_price?: number | null;
  new_price: number;
  status: 'pending' | 'applied' | 'failed' | 'cancelled';
  source: string;
  batch_id?: string | null;
  created_at: string;
  applied_at?: string | null;
  error_message?: string | null;
  notes?: string | null;
};

type StockItem = {
  ID: number;
  AD: string;
  BARKOD?: string;
  KOD?: string;
  FIYAT?: string | number | null;
  STOK_GRUP?: string;
  KDV_PAREKENDE?: string;
};

const fmt = (v: number | null | undefined) => {
  if (v == null || isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
};

const dateFmt = (s?: string | null) => {
  if (!s) return '';
  try {
    const d = new Date(s);
    return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return s; }
};

export default function PriceUpdateScreen() {
  const { colors } = useThemeStore();
  const { user, token } = useAuthStore();
  const { activeSource } = useDataSourceStore();
  const { showError, showSuccess, showWarning, alertProps } = useAlert();

  const activeTenantId = useMemo(() => {
    if (!user?.tenants?.length) return '';
    const m = /^data(\d+)$/.exec(activeSource || '');
    const idx = m ? parseInt(m[1], 10) - 1 : -1;
    if (idx >= 0 && idx < user.tenants.length) return user.tenants[idx].tenant_id || '';
    return user.tenants[0]?.tenant_id || '';
  }, [user?.tenants, activeSource]);

  // === STATE ===
  const [activeTab, setActiveTab] = useState<'pending' | 'applied' | 'cancelled'>('pending');
  const [items, setItems] = useState<PendingUpdate[]>([]);
  const [counts, setCounts] = useState({ pending: 0, applied: 0, failed: 0, cancelled: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // New update modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [stockList, setStockList] = useState<StockItem[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockSearch, setStockSearch] = useState('');
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Single product edit sheet
  const [editProduct, setEditProduct] = useState<StockItem | null>(null);
  const [newPrice, setNewPrice] = useState('');

  // Bulk adjust panel
  const [showBulkPanel, setShowBulkPanel] = useState(false);
  const [bulkType, setBulkType] = useState<'percent' | 'amount' | 'fixed_price'>('percent');
  const [bulkValue, setBulkValue] = useState('10');

  // Password confirm step
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Pending action context: 'single' or 'bulk', plus the payload to send
  const [pendingAction, setPendingAction] = useState<any>(null);

  // === API CALLS ===
  const fetchList = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);
    try {
      const resp = await fetch(`${API_URL}/api/stock/price-update?status=${activeTab}&limit=200`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const j = await resp.json();
      if (resp.ok && j.success) {
        setItems(j.items || []);
        setCounts(j.counts || { pending: 0, applied: 0, failed: 0, cancelled: 0 });
      } else {
        showError('Hata', j.detail || 'Liste yüklenemedi');
      }
    } catch (e: any) {
      showError('Bağlantı', 'Sunucuya ulaşılamadı');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, activeTab]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const fetchStock = useCallback(async () => {
    if (!token || !activeTenantId) return;
    setStockLoading(true);
    try {
      const resp = await fetch(`${API_URL}/api/data/stock-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: activeTenantId, page: 1, page_size: 300 }),
      });
      const j = await resp.json();
      if (resp.ok && j.ok) setStockList(j.data || []);
    } catch { /* noop */ }
    finally { setStockLoading(false); }
  }, [token, activeTenantId]);

  useEffect(() => { if (showNewModal) fetchStock(); }, [showNewModal, fetchStock]);

  // === CANCEL pending ===
  const cancelOne = async (id: number) => {
    showWarning('İptal Et', 'Bu bekleyen güncellemeyi iptal etmek istiyor musunuz?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'İptal Et', style: 'destructive',
        onPress: async () => {
          try {
            const r = await fetch(`${API_URL}/api/stock/price-update/${id}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}` },
            });
            const j = await r.json();
            if (r.ok && j.success) {
              showSuccess('İptal Edildi', 'Güncelleme iptal edildi');
              fetchList();
            } else showError('Hata', j.detail || 'İptal edilemedi');
          } catch { showError('Bağlantı', 'Sunucuya ulaşılamadı'); }
        }
      }
    ]);
  };

  // === SUBMIT (with password) ===
  const onPasswordConfirm = async () => {
    if (!password.trim()) { showWarning('Şifre', 'Lütfen şifrenizi girin'); return; }
    if (!pendingAction) return;
    setSubmitting(true);
    try {
      let url = `${API_URL}/api/stock/price-update`;
      let body: any = { ...pendingAction.body, password };
      if (pendingAction.type === 'bulk') url += '/bulk-adjust';
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (r.ok && j.success) {
        setShowPasswordModal(false);
        setShowNewModal(false);
        setPassword('');
        setPendingAction(null);
        setEditProduct(null);
        setNewPrice('');
        setSelectedIds(new Set());
        setShowBulkPanel(false);
        showSuccess('Kaydedildi', j.message || `${j.count} kayıt sıraya alındı`);
        fetchList();
      } else {
        showError('Hata', j.detail || 'Kayıt eklenemedi');
      }
    } catch {
      showError('Bağlantı', 'Sunucuya ulaşılamadı');
    } finally { setSubmitting(false); }
  };

  // === Single product save ===
  const onSingleSave = () => {
    if (!editProduct) return;
    const np = parseFloat(newPrice.replace(',', '.'));
    if (isNaN(np) || np <= 0) { showWarning('Geçersiz Fiyat', 'Yeni fiyat 0\'dan büyük olmalı'); return; }
    setPendingAction({
      type: 'single',
      body: {
        items: [{
          product_id: String(editProduct.ID),
          product_barcode: editProduct.BARKOD || null,
          product_name: editProduct.AD || null,
          old_price: editProduct.FIYAT ? Number(editProduct.FIYAT) : null,
          new_price: Math.round(np * 100) / 100,
        }],
      },
    });
    setShowPasswordModal(true);
  };

  // === Bulk save ===
  const onBulkSave = () => {
    const v = parseFloat(bulkValue.replace(',', '.'));
    if (isNaN(v)) { showWarning('Geçersiz Değer', 'Geçerli bir sayı girin'); return; }
    if (bulkType === 'fixed_price' && v <= 0) { showWarning('Geçersiz Fiyat', 'Sabit fiyat 0\'dan büyük olmalı'); return; }
    if (selectedIds.size === 0) { showWarning('Seçim Yok', 'En az 1 ürün seçin'); return; }
    const itemsArr = stockList
      .filter(s => selectedIds.has(s.ID))
      .map(s => ({
        product_id: String(s.ID),
        product_barcode: s.BARKOD || null,
        product_name: s.AD || null,
        old_price: s.FIYAT ? Number(s.FIYAT) : 0,
      }))
      .filter(it => it.old_price > 0);
    if (itemsArr.length === 0) { showWarning('Geçerli Ürün Yok', 'Seçili ürünlerin mevcut fiyatı yok'); return; }
    setPendingAction({
      type: 'bulk',
      body: {
        items: itemsArr,
        adjustment_type: bulkType,
        value: v,
      },
    });
    setShowPasswordModal(true);
  };

  // === Filter products ===
  const filteredStock = useMemo(() => {
    if (!stockSearch.trim()) return stockList.slice(0, 50);
    const q = stockSearch.toLowerCase().trim();
    return stockList.filter(s =>
      (s.AD || '').toLowerCase().includes(q) ||
      (s.BARKOD || '').toLowerCase().includes(q) ||
      (s.KOD || '').toLowerCase().includes(q)
    ).slice(0, 100);
  }, [stockList, stockSearch]);

  // ============================================================
  // RENDERERS
  // ============================================================

  const renderListItem = ({ item }: { item: PendingUpdate }) => {
    const oldP = item.old_price ?? null;
    const diff = (oldP != null) ? item.new_price - oldP : null;
    const pct = (oldP != null && oldP > 0) ? ((item.new_price - oldP) / oldP) * 100 : null;
    const diffColor = diff != null && diff < 0 ? colors.error : (diff != null && diff > 0 ? '#10B981' : colors.textSecondary);
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
              {item.product_name || `#${item.product_id}`}
            </Text>
            {item.product_barcode ? (
              <Text style={{ color: colors.textSecondary, fontSize: 11 }}>Barkod: {item.product_barcode}</Text>
            ) : null}
          </View>
          {activeTab === 'pending' && (
            <TouchableOpacity onPress={() => cancelOne(item.id)} style={{ padding: 6 }}>
              <Ionicons name="close-circle" size={22} color={colors.error} />
            </TouchableOpacity>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ alignItems: 'flex-start' }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11 }}>Eski</Text>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '500' }}>{fmt(oldP ?? undefined)}</Text>
          </View>
          <Ionicons name="arrow-forward" size={20} color={colors.textSecondary} />
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11 }}>Yeni</Text>
            <Text style={{ color: colors.primary, fontSize: 17, fontWeight: '700' }}>{fmt(item.new_price)}</Text>
          </View>
        </View>
        {diff != null && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={{ color: diffColor, fontSize: 12, fontWeight: '600' }}>
              {diff >= 0 ? '+' : ''}{fmt(diff)} {pct != null ? `(${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{dateFmt(item.created_at)}</Text>
          </View>
        )}
        {item.error_message && (
          <Text style={{ color: colors.error, fontSize: 11, marginTop: 6 }}>⚠ {item.error_message}</Text>
        )}
      </View>
    );
  };

  const renderStockSelectItem = ({ item }: { item: StockItem }) => {
    const sel = selectedIds.has(item.ID);
    const price = item.FIYAT ? Number(item.FIYAT) : 0;
    return (
      <TouchableOpacity
        style={[styles.stockRow, {
          backgroundColor: sel ? colors.primary + '15' : colors.surface,
          borderColor: sel ? colors.primary : colors.border,
        }]}
        onPress={() => {
          if (mode === 'single') {
            setEditProduct(item);
            setNewPrice(price ? String(price) : '');
          } else {
            const next = new Set(selectedIds);
            if (next.has(item.ID)) next.delete(item.ID); else next.add(item.ID);
            setSelectedIds(next);
          }
        }}
      >
        {mode === 'bulk' && (
          <View style={{ marginRight: 10 }}>
            <Ionicons name={sel ? 'checkbox' : 'square-outline'} size={22} color={sel ? colors.primary : colors.textSecondary} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
            {item.AD || `#${item.ID}`}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 11 }} numberOfLines={1}>
            {item.BARKOD || item.KOD || '—'}{item.STOK_GRUP ? ` · ${item.STOK_GRUP}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '700' }}>{fmt(price)}</Text>
          {mode === 'single' && <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />}
        </View>
      </TouchableOpacity>
    );
  };

  // ============================================================
  // MAIN RENDER
  // ============================================================

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* HEADER */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Fiyat Güncelleme</Text>
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
            POS yazılımı uyguladıkça otomatik güncellenir
          </Text>
        </View>
      </View>

      {/* TABS */}
      <View style={[styles.tabsRow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        {([
          { key: 'pending', label: 'Bekleyen', count: counts.pending, color: '#F59E0B' },
          { key: 'applied', label: 'Uygulandı', count: counts.applied, color: '#10B981' },
          { key: 'cancelled', label: 'İptal', count: counts.cancelled, color: colors.textSecondary },
        ] as const).map(t => {
          const active = activeTab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, active && { borderBottomColor: t.color, borderBottomWidth: 2 }]}
              onPress={() => setActiveTab(t.key)}
            >
              <Text style={{ color: active ? t.color : colors.textSecondary, fontWeight: active ? '700' : '500' }}>
                {t.label}{t.count > 0 ? ` (${t.count})` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* LIST */}
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : items.length === 0 ? (
        <ScrollView contentContainerStyle={styles.empty} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchList(true); }} />}>
          <Ionicons name="pricetag-outline" size={64} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {activeTab === 'pending' ? 'Bekleyen güncelleme yok' : activeTab === 'applied' ? 'Henüz uygulanmış güncelleme yok' : 'İptal edilmiş güncelleme yok'}
          </Text>
          {activeTab === 'pending' && (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Aşağıdaki <Text style={{ fontWeight: '700' }}>+ Yeni Güncelleme</Text> butonuna basarak başlayın
            </Text>
          )}
        </ScrollView>
      ) : (
        <FlatList
          data={items}
          renderItem={renderListItem}
          keyExtractor={(it) => String(it.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchList(true); }} />}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => { setMode('single'); setShowNewModal(true); }}
      >
        <Ionicons name="add" size={28} color="#FFF" />
        <Text style={{ color: '#FFF', fontWeight: '700', marginLeft: 4 }}>Yeni Güncelleme</Text>
      </TouchableOpacity>

      {/* ====================  NEW UPDATE MODAL  ==================== */}
      <Modal visible={showNewModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowNewModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {/* Modal Header */}
            <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={() => { setShowNewModal(false); setSelectedIds(new Set()); }} style={styles.headerBtn}>
                <Ionicons name="close" size={26} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.headerTitle, { color: colors.text, flex: 1 }]}>Yeni Güncelleme</Text>
              {mode === 'bulk' && selectedIds.size > 0 && (
                <TouchableOpacity onPress={() => setSelectedIds(new Set())} style={styles.headerBtn}>
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>Temizle</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Mode Tabs */}
            <View style={[styles.tabsRow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.tab, mode === 'single' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
                onPress={() => { setMode('single'); setSelectedIds(new Set()); }}
              >
                <Text style={{ color: mode === 'single' ? colors.primary : colors.textSecondary, fontWeight: mode === 'single' ? '700' : '500' }}>
                  Tek Ürün
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, mode === 'bulk' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
                onPress={() => { setMode('bulk'); setEditProduct(null); }}
              >
                <Text style={{ color: mode === 'bulk' ? colors.primary : colors.textSecondary, fontWeight: mode === 'bulk' ? '700' : '500' }}>
                  Toplu {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Search */}
            <View style={{ padding: 12, backgroundColor: colors.background }}>
              <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="search" size={18} color={colors.textSecondary} />
                <TextInput
                  style={{ flex: 1, marginLeft: 8, color: colors.text, padding: 0 }}
                  placeholder="Ürün adı veya barkod ara…"
                  placeholderTextColor={colors.textSecondary}
                  value={stockSearch}
                  onChangeText={setStockSearch}
                />
                {stockSearch.length > 0 && (
                  <TouchableOpacity onPress={() => setStockSearch('')}>
                    <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Stock List */}
            {stockLoading ? (
              <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
            ) : (
              <FlatList
                data={filteredStock}
                renderItem={renderStockSelectItem}
                keyExtractor={(it) => String(it.ID)}
                contentContainerStyle={{ padding: 12, paddingBottom: 120 }}
                ListEmptyComponent={
                  <View style={{ alignItems: 'center', padding: 40 }}>
                    <Text style={{ color: colors.textSecondary }}>Ürün bulunamadı</Text>
                  </View>
                }
              />
            )}

            {/* Bulk Action Bar */}
            {mode === 'bulk' && selectedIds.size > 0 && (
              <View style={[styles.bulkBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{selectedIds.size} ürün seçildi</Text>
                <TouchableOpacity
                  style={[styles.bulkBtn, { backgroundColor: colors.primary }]}
                  onPress={() => setShowBulkPanel(true)}
                >
                  <Ionicons name="calculator" size={18} color="#FFF" />
                  <Text style={{ color: '#FFF', fontWeight: '700', marginLeft: 6 }}>Toplu Güncelle</Text>
                </TouchableOpacity>
              </View>
            )}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ====================  SINGLE PRODUCT EDIT SHEET  ==================== */}
      <Modal visible={!!editProduct} animationType="slide" transparent onRequestClose={() => setEditProduct(null)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
              <View style={styles.sheetHandle} />
              <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={2}>
                {editProduct?.AD || `Ürün #${editProduct?.ID}`}
              </Text>
              {editProduct?.BARKOD ? (
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 12 }}>
                  Barkod: {editProduct.BARKOD}
                </Text>
              ) : null}

              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                <View style={[styles.priceBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={{ color: colors.textSecondary, fontSize: 11 }}>Eski Fiyat</Text>
                  <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>
                    {fmt(editProduct?.FIYAT ? Number(editProduct.FIYAT) : undefined)}
                  </Text>
                </View>
                <View style={[styles.priceBox, { backgroundColor: colors.primary + '10', borderColor: colors.primary }]}>
                  <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '600' }}>Yeni Fiyat</Text>
                  <TextInput
                    style={{ color: colors.text, fontSize: 18, fontWeight: '700', padding: 0, marginTop: 2 }}
                    placeholder="0.00"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="decimal-pad"
                    value={newPrice}
                    onChangeText={setNewPrice}
                  />
                </View>
              </View>

              {/* Quick presets */}
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 6 }}>Yüzde:</Text>
              <View style={styles.presetRow}>
                {([-10, -5, 5, 10, 15, 20, 25] as const).map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.preset, { borderColor: p < 0 ? colors.error : colors.primary }]}
                    onPress={() => {
                      const op = editProduct?.FIYAT ? Number(editProduct.FIYAT) : 0;
                      if (op > 0) setNewPrice((op * (1 + p / 100)).toFixed(2));
                    }}
                  >
                    <Text style={{ color: p < 0 ? colors.error : colors.primary, fontWeight: '700', fontSize: 13 }}>
                      {p > 0 ? '+' : ''}{p}%
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 6, marginTop: 12 }}>Sabit Miktar:</Text>
              <View style={styles.presetRow}>
                {([-10, -5, -1, 1, 5, 10, 50] as const).map(m => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.preset, { borderColor: m < 0 ? colors.error : '#10B981' }]}
                    onPress={() => {
                      const op = editProduct?.FIYAT ? Number(editProduct.FIYAT) : 0;
                      const cur = parseFloat(newPrice.replace(',', '.')) || op;
                      setNewPrice((cur + m).toFixed(2));
                    }}
                  >
                    <Text style={{ color: m < 0 ? colors.error : '#10B981', fontWeight: '700', fontSize: 13 }}>
                      {m > 0 ? '+' : ''}{m}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                <TouchableOpacity
                  style={[styles.cancelBtn, { borderColor: colors.border }]}
                  onPress={() => { setEditProduct(null); setNewPrice(''); }}
                >
                  <Text style={{ color: colors.text, fontWeight: '600' }}>Vazgeç</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.primary }]} onPress={onSingleSave}>
                  <Text style={{ color: '#FFF', fontWeight: '700' }}>Sıraya Al</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* ====================  BULK ADJUST PANEL  ==================== */}
      <Modal visible={showBulkPanel} animationType="slide" transparent onRequestClose={() => setShowBulkPanel(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
              <View style={styles.sheetHandle} />
              <Text style={[styles.sheetTitle, { color: colors.text }]}>
                Toplu Güncelleme — {selectedIds.size} ürün
              </Text>

              <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 6, marginTop: 8 }}>Tip:</Text>
              <View style={styles.presetRow}>
                {([
                  { v: 'percent', label: '%' },
                  { v: 'amount', label: '+/- ₺' },
                  { v: 'fixed_price', label: 'Sabit ₺' },
                ] as const).map(b => {
                  const active = bulkType === b.v;
                  return (
                    <TouchableOpacity
                      key={b.v}
                      style={[styles.preset, {
                        backgroundColor: active ? colors.primary : 'transparent',
                        borderColor: colors.primary,
                        minWidth: 90,
                      }]}
                      onPress={() => setBulkType(b.v)}
                    >
                      <Text style={{ color: active ? '#FFF' : colors.primary, fontWeight: '700' }}>{b.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 6, marginTop: 16 }}>
                {bulkType === 'percent' ? 'Yüzde (+ artış, - indirim):' : bulkType === 'amount' ? 'Miktar (+ artış, - indirim) ₺:' : 'Yeni Sabit Fiyat ₺:'}
              </Text>
              <TextInput
                style={{
                  borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background,
                  color: colors.text, padding: 14, borderRadius: 10, fontSize: 22, fontWeight: '700', textAlign: 'center',
                }}
                placeholder={bulkType === 'percent' ? '10' : bulkType === 'amount' ? '5' : '99.99'}
                placeholderTextColor={colors.textSecondary}
                keyboardType="numbers-and-punctuation"
                value={bulkValue}
                onChangeText={setBulkValue}
              />

              {/* Quick presets for bulk */}
              {bulkType === 'percent' && (
                <View style={[styles.presetRow, { marginTop: 12 }]}>
                  {([-10, -5, 5, 10, 15, 20, 25] as const).map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[styles.preset, { borderColor: p < 0 ? colors.error : colors.primary }]}
                      onPress={() => setBulkValue(String(p))}
                    >
                      <Text style={{ color: p < 0 ? colors.error : colors.primary, fontWeight: '700', fontSize: 13 }}>
                        {p > 0 ? '+' : ''}{p}%
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                <TouchableOpacity
                  style={[styles.cancelBtn, { borderColor: colors.border }]}
                  onPress={() => setShowBulkPanel(false)}
                >
                  <Text style={{ color: colors.text, fontWeight: '600' }}>Vazgeç</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.primary }]} onPress={onBulkSave}>
                  <Text style={{ color: '#FFF', fontWeight: '700' }}>Sıraya Al</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* ====================  PASSWORD CONFIRM  ==================== */}
      <Modal visible={showPasswordModal} animationType="fade" transparent onRequestClose={() => !submitting && setShowPasswordModal(false)}>
        <KeyboardAvoidingView style={[styles.modalOverlay, { justifyContent: 'center', padding: 24 }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={[styles.confirmBox, { backgroundColor: colors.surface }]}>
              <Ionicons name="shield-checkmark" size={40} color={colors.primary} style={{ alignSelf: 'center' }} />
              <Text style={[styles.confirmTitle, { color: colors.text }]}>Şifre ile Onayla</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: 16 }}>
                Güvenliğiniz için şifrenizi tekrar girin. Bu işlem POS sisteminize fiyat değişikliği için sıraya alınacak.
              </Text>
              <TextInput
                style={{
                  borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background,
                  color: colors.text, padding: 14, borderRadius: 10, fontSize: 15,
                }}
                placeholder="Şifreniz"
                placeholderTextColor={colors.textSecondary}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                editable={!submitting}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                <TouchableOpacity
                  style={[styles.cancelBtn, { borderColor: colors.border }]}
                  onPress={() => { setShowPasswordModal(false); setPassword(''); }}
                  disabled={submitting}
                >
                  <Text style={{ color: colors.text, fontWeight: '600' }}>Vazgeç</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 }]}
                  onPress={onPasswordConfirm}
                  disabled={submitting}
                >
                  {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: '#FFF', fontWeight: '700' }}>Onayla & Kaydet</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      <CustomAlert {...alertProps} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1 },
  headerBtn: { padding: 8, marginRight: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerSub: { fontSize: 11 },
  tabsRow: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, minHeight: 400 },
  emptyTitle: { fontSize: 16, fontWeight: '600', marginTop: 12 },
  emptyText: { fontSize: 13, marginTop: 6, textAlign: 'center' },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  fab: {
    position: 'absolute', right: 16, bottom: 24,
    paddingHorizontal: 18, paddingVertical: 14, borderRadius: 28,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  searchBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  stockRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderWidth: 1, borderRadius: 10, marginBottom: 8 },
  bulkBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1 },
  bulkBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32, maxHeight: '85%' },
  sheetHandle: { width: 40, height: 5, backgroundColor: '#CCC', borderRadius: 3, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  priceBox: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  saveBtn: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  confirmBox: { padding: 24, borderRadius: 16 },
  confirmTitle: { fontSize: 18, fontWeight: '700', marginTop: 8, marginBottom: 4, textAlign: 'center' },
});
