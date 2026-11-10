/**
 * Sonuç listesinin en üstündeki belirgin toplam / satış-alış ayrımı / ipucu banner'ı.
 */
import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeColors } from '../../store/themeStore';
import { FilterValues, ReportDef } from '../../reports/types';
import { fmtMoney } from '../../reports/format';
import { fisKalemSatisAlis, isDetayli, personelToplamSatis } from '../../reports/summary';

interface Props { report: ReportDef; data: any[]; filterValues: FilterValues; colors: ThemeColors }

const TopBannerComp: React.FC<Props> = ({ report, data, filterValues, colors }) => {
  if (!data || data.length === 0) return null;

  if (report.key === 'personel_satis') {
    const { toplam, fisAdet } = personelToplamSatis(data);
    return (
      <View style={[styles.banner, { backgroundColor: colors.success + '15', borderColor: colors.success + '50' }]}>
        <View style={[styles.iconBg, { backgroundColor: colors.success }]}>
          <Ionicons name="cash-outline" size={22} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, { color: colors.success }]}>TOPLAM SATIŞ</Text>
          <Text style={[styles.big, { color: colors.text }]} numberOfLines={1}>{fmtMoney(toplam)}</Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>{fisAdet.toLocaleString('tr-TR')} fiş • {data.length} personel</Text>
        </View>
      </View>
    );
  }

  if (report.key === 'fis_kalem') {
    const { satis, alis, satisAdet, alisAdet } = fisKalemSatisAlis(data);
    return (
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        <View style={[styles.halfBanner, { backgroundColor: colors.success + '15', borderColor: colors.success + '50' }]}>
          <Ionicons name="arrow-up-circle" size={20} color={colors.success} />
          <Text style={[styles.halfLabel, { color: colors.success }]}>SATIŞ TOPLAMI</Text>
          <Text style={[styles.halfBig, { color: colors.text }]} numberOfLines={1}>{fmtMoney(satis)}</Text>
          <Text style={[styles.halfSub, { color: colors.textSecondary }]}>{satisAdet} fiş/fatura</Text>
        </View>
        <View style={[styles.halfBanner, { backgroundColor: colors.error + '10', borderColor: colors.error + '50' }]}>
          <Ionicons name="arrow-down-circle" size={20} color={colors.error} />
          <Text style={[styles.halfLabel, { color: colors.error }]}>ALIŞ TOPLAMI</Text>
          <Text style={[styles.halfBig, { color: colors.text }]} numberOfLines={1}>{fmtMoney(alis)}</Text>
          <Text style={[styles.halfSub, { color: colors.textSecondary }]}>{alisAdet} fiş/fatura</Text>
        </View>
      </View>
    );
  }

  if (report.key === 'cari_ekstre' && isDetayli(filterValues)) {
    const detailCount = data.filter((r: any) => r.__isDetail).length;
    return (
      <View style={[styles.hint, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '40' }]}>
        <Ionicons name="information-circle" size={18} color={colors.primary} />
        <Text style={[styles.hintText, { color: colors.text }]} numberOfLines={2}>
          💡 Her fiş / faturanın altında <Text style={{ fontWeight: '700', color: colors.primary }}>stok kalemleri</Text> gösterilmektedir ({detailCount} stok kalemi bulundu)
        </Text>
      </View>
    );
  }

  return null;
};

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, marginBottom: 10 },
  iconBg: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, marginBottom: 2 },
  big: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  sub: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  halfBanner: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1.5, gap: 2 },
  halfLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, marginTop: 4 },
  halfBig: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  halfSub: { fontSize: 10, fontWeight: '500' },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  hintText: { flex: 1, fontSize: 12, fontWeight: '500', lineHeight: 17 },
});

export const TopBanner = memo(TopBannerComp, (p, n) => p.report === n.report && p.data === n.data && p.filterValues === n.filterValues && p.colors === n.colors);
export default TopBanner;
