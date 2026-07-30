/**
 * DashboardPdfExport — Ana sayfa PDF dışa aktarma (2026-07).
 *
 * Kullanıcı istediği bölümleri işaretler (özet kartlar, lokasyon satışları,
 * saatlik satışlar, açık masalar, iptaller) → HTML rapor üretilir →
 * expo-print ile PDF'e çevrilip expo-sharing ile paylaşılır.
 *
 * iOS native Modal YASAK (Reanimated/UI-thread çakışmaları) → inline
 * absoluteFillObject overlay kullanılır.
 */
import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useThemeStore } from '../store/themeStore';

interface Totals { cash: number; card: number; openAccount: number; total: number }

interface Props {
  visible: boolean;
  onClose: () => void;
  tenantName?: string;
  dateLabel?: string;
  totals: Totals;
  branchSales: any[];
  hourlySales: any[];
  openTables: any[];
  iptalOzet: any[];
}

const fmt = (n: number) =>
  '₺' + (Number(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esc = (s: any) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type SectionKey = 'ozet' | 'lokasyon' | 'saatlik' | 'masalar' | 'iptaller';

export const DashboardPdfExport: React.FC<Props> = ({
  visible, onClose, tenantName, dateLabel, totals, branchSales, hourlySales, openTables, iptalOzet,
}) => {
  const { colors } = useThemeStore();
  const [selected, setSelected] = useState<Record<SectionKey, boolean>>({
    ozet: true, lokasyon: true, saatlik: true, masalar: true, iptaller: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sections = useMemo(() => ([
    { key: 'ozet' as SectionKey, label: 'Özet Kartlar', desc: 'Nakit · Kredi Kartı · Açık Hesap · Toplam', icon: 'grid-outline', count: 4 },
    { key: 'lokasyon' as SectionKey, label: 'Lokasyon Bazlı Satışlar', desc: `${branchSales.length} lokasyon`, icon: 'business-outline', count: branchSales.length },
    { key: 'saatlik' as SectionKey, label: 'Saatlik Satışlar', desc: `${hourlySales.length} saat dilimi`, icon: 'time-outline', count: hourlySales.length },
    { key: 'masalar' as SectionKey, label: 'Açık Masalar', desc: `${openTables.length} açık masa`, icon: 'restaurant-outline', count: openTables.length },
    { key: 'iptaller' as SectionKey, label: 'İptaller', desc: `${iptalOzet.length} iptal kaydı`, icon: 'close-circle-outline', count: iptalOzet.length },
  ]), [branchSales.length, hourlySales.length, openTables.length, iptalOzet.length]);

  const anySelected = sections.some((s) => selected[s.key] && s.count > 0);

  const buildHtml = (): string => {
    const parts: string[] = [];
    if (selected.ozet) {
      parts.push(`<h3>Özet</h3>
      <table><thead><tr><th>Nakit</th><th>Kredi Kartı</th><th>Açık Hesap</th><th>Toplam</th></tr></thead>
      <tbody><tr><td>${fmt(totals.cash)}</td><td>${fmt(totals.card)}</td><td>${fmt(totals.openAccount)}</td><td><b>${fmt(totals.total)}</b></td></tr></tbody></table>`);
    }
    if (selected.lokasyon && branchSales.length > 0) {
      parts.push(`<h3>Lokasyon Bazlı Satışlar</h3>
      <table><thead><tr><th>Lokasyon</th><th>Nakit</th><th>Kredi Kartı</th><th>Açık Hesap</th><th>Toplam</th></tr></thead><tbody>
      ${branchSales.map((b: any) => `<tr><td>${esc(b.branchName)}</td><td>${fmt(b.sales?.cash)}</td><td>${fmt(b.sales?.card)}</td><td>${fmt(b.sales?.openAccount)}</td><td><b>${fmt(b.sales?.total)}</b></td></tr>`).join('')}
      </tbody></table>`);
    }
    if (selected.saatlik && hourlySales.length > 0) {
      const toplam = hourlySales.reduce((s: number, h: any) => s + (Number(h.amount) || 0), 0);
      parts.push(`<h3>Saatlik Satışlar</h3>
      <table><thead><tr><th>Saat</th><th>İşlem</th><th>Tutar</th></tr></thead><tbody>
      ${hourlySales.map((h: any) => `<tr><td>${esc(h.hour)}</td><td>${Number(h.transactions) || 0}</td><td>${fmt(h.amount)}</td></tr>`).join('')}
      <tr><td colspan="2"><b>TOPLAM</b></td><td><b>${fmt(toplam)}</b></td></tr>
      </tbody></table>`);
    }
    if (selected.masalar && openTables.length > 0) {
      const acikToplam = openTables.reduce((s: number, m: any) => s + (Number(m.remainingAmount ?? m.amount) || 0), 0);
      parts.push(`<h3>Açık Masalar</h3>
      <table><thead><tr><th>Masa</th><th>Lokasyon</th><th>Tutar</th><th>Ödenen</th><th>Kalan</th></tr></thead><tbody>
      ${openTables.map((m: any) => `<tr><td>${esc(m.tableNo || m.customerName)}</td><td>${esc(m.location)}</td><td>${fmt(m.amount)}</td><td>${fmt(m.paidAmount)}</td><td>${fmt(m.remainingAmount)}</td></tr>`).join('')}
      <tr><td colspan="4"><b>KALAN TOPLAM</b></td><td><b>${fmt(acikToplam)}</b></td></tr>
      </tbody></table>`);
    }
    if (selected.iptaller && iptalOzet.length > 0) {
      const iptalToplam = iptalOzet.reduce((s: number, r: any) => s + (parseFloat(r.IPTAL_TUTAR || r.TUTAR || '0') || 0), 0);
      parts.push(`<h3>İptaller</h3>
      <table><thead><tr><th>Saat</th><th>Tip</th><th>Lokasyon</th><th>Personel</th><th>Tutar</th></tr></thead><tbody>
      ${iptalOzet.map((r: any) => {
        const saatRaw = String(r.TARIH_IPTAL || r.TARIH || '');
        const saat = saatRaw.includes(' ') ? saatRaw.split(' ')[1] : saatRaw;
        return `<tr><td>${esc(saat)}</td><td>${esc(r.IPTAL_TIPI)}</td><td>${esc(r.LOKASYON)}</td><td>${esc(r.PERSONEL_AD)}</td><td>${fmt(parseFloat(r.IPTAL_TUTAR || r.TUTAR || '0'))}</td></tr>`;
      }).join('')}
      <tr><td colspan="4"><b>TOPLAM</b></td><td><b>${fmt(iptalToplam)}</b></td></tr>
      </tbody></table>`);
    }
    return `<html><head><meta charset="utf-8"><style>
      body{font-family:sans-serif;padding:20px;color:#111}
      h2{margin:0 0 2px 0} .sub{color:#666;font-size:12px;margin-bottom:14px}
      h3{margin:18px 0 6px 0;border-bottom:2px solid #3B82F6;padding-bottom:4px;font-size:14px}
      table{width:100%;border-collapse:collapse;margin-bottom:8px}
      th,td{border:1px solid #ddd;padding:6px;font-size:11px;text-align:left}
      th{background:#f5f5f5}
    </style></head><body>
    <h2>Günlük Rapor${tenantName ? ` — ${esc(tenantName)}` : ''}</h2>
    <div class="sub">${esc(dateLabel || new Date().toLocaleDateString('tr-TR'))} · Barkodcu Cepte</div>
    ${parts.join('')}
    </body></html>`;
  };

  const exportPdf = async () => {
    if (busy || !anySelected) return;
    setBusy(true);
    setError(null);
    try {
      const html = buildHtml();
      if (Platform.OS === 'web') {
        await Print.printAsync({ html });
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Günlük Rapor PDF' });
      }
      onClose();
    } catch (e: any) {
      setError(String(e?.message || e || 'PDF oluşturulamadı'));
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <View style={[styles.overlay, { pointerEvents: 'auto' }] as any}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {/* Header */}
        <View style={styles.sheetHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <Ionicons name="document-text" size={20} color={colors.primary} />
            <Text style={[styles.title, { color: colors.text }]}>PDF Dışa Aktar</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <Text style={{ fontSize: 12, color: colors.textSecondary, paddingHorizontal: 16, marginBottom: 8 }}>
          Rapora eklenecek bölümleri seçin
        </Text>

        <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {sections.map((s) => {
            const disabled = s.count === 0;
            const checked = selected[s.key] && !disabled;
            return (
              <TouchableOpacity
                key={s.key}
                disabled={disabled}
                onPress={() => setSelected((p) => ({ ...p, [s.key]: !p[s.key] }))}
                style={[styles.row, {
                  backgroundColor: colors.card,
                  borderColor: checked ? colors.primary : colors.border,
                  opacity: disabled ? 0.45 : 1,
                }]}
              >
                <View style={[styles.checkbox, {
                  backgroundColor: checked ? colors.primary : 'transparent',
                  borderColor: checked ? colors.primary : colors.border,
                }]}>
                  {checked && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
                <Ionicons name={s.icon as any} size={18} color={checked ? colors.primary : colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{s.label}</Text>
                  <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 1 }}>
                    {disabled ? 'Veri yok' : s.desc}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {!!error && (
          <Text style={{ color: colors.error, fontSize: 12, paddingHorizontal: 16, marginTop: 8 }}>{error}</Text>
        )}

        <TouchableOpacity
          onPress={exportPdf}
          disabled={busy || !anySelected}
          style={[styles.exportBtn, { backgroundColor: anySelected ? colors.primary : colors.border, opacity: busy ? 0.7 : 1 }]}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="share-outline" size={18} color="#fff" />
          )}
          <Text style={styles.exportBtnText}>{busy ? 'Oluşturuluyor…' : 'PDF Oluştur ve Paylaş'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingBottom: 28,
    paddingTop: 6,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 17, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
  },
  exportBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
