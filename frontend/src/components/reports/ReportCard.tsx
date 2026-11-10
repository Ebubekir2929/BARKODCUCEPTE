/**
 * Rapor sonuç kartı. Üç görünüm:
 *  - Fiş Kalem başlık kartı (__isFisHeader)
 *  - Alt kalem satırı (__isDetail)
 *  - cardLayout'a göre genel kart (başlık/kod/tutar/çipler/meta); yoksa 2 kolonlu ızgara
 */
import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeColors } from '../../store/themeStore';
import { ReportDef } from '../../reports/types';
import { fmtMoney, fmtNumber, isTruthyFlag, renderValue, toNum } from '../../reports/format';
import { formatDateCell } from '../../reports/dates';
import { cardStyles } from './reportStyles';

interface Props { item: any; report: ReportDef | null; colors: ThemeColors }

const FisHeaderCard: React.FC<{ item: any; colors: ThemeColors }> = ({ item, colors }) => {
  const belge = String(item.BELGENO || '');
  const tarih = formatDateCell(String(item.FIS_TARIHI || '').trim());
  const cariAd = String(item.CARI_AD || '');
  return (
    <View style={[cardStyles.card, { backgroundColor: colors.primary + '08', borderColor: colors.primary + '40', borderWidth: 1.5 }]}>
      <View style={cardStyles.cardTop}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={[cardStyles.code, { color: colors.primary, fontWeight: '700' }]} numberOfLines={1}>{belge}</Text>
          <Text style={[cardStyles.title, { color: colors.text }]} numberOfLines={2}>{String(item.FIS_TURU || '-')}</Text>
          {!!tarih && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <Ionicons name="calendar-outline" size={12} color={colors.textSecondary} />
              <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '600' }} numberOfLines={1}>{tarih}</Text>
            </View>
          )}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[cardStyles.amount, { color: colors.primary }]} numberOfLines={1}>{fmtMoney(toNum(item.SATIR_GENEL_TOPLAM))}</Text>
          <Text style={[cardStyles.amountCurrency, { color: colors.textSecondary }]}>Fiş Toplamı</Text>
        </View>
      </View>
      <View style={cardStyles.chipsRow}>
        {!!tarih && <View style={[cardStyles.chip, { backgroundColor: colors.primary + '15' }]}><Text style={[cardStyles.chipText, { color: colors.primary }]}>{tarih}</Text></View>}
        <View style={[cardStyles.chip, { backgroundColor: colors.success + '18' }]}><Text style={[cardStyles.chipText, { color: colors.success }]}>{item.KALEM_SAYISI || 0} kalem</Text></View>
        <View style={[cardStyles.chip, { backgroundColor: colors.primary + '12' }]}><Text style={[cardStyles.chipText, { color: colors.primary }]}>Toplam Miktar: {toNum(item.MIKTAR_FIS).toLocaleString('tr-TR')}</Text></View>
        {!!cariAd && <View style={[cardStyles.chip, { backgroundColor: colors.textSecondary + '18' }]}><Text style={[cardStyles.chipText, { color: colors.text }]} numberOfLines={1}>{cariAd}</Text></View>}
      </View>
    </View>
  );
};

const DetailRow: React.FC<{ item: any; colors: ThemeColors }> = ({ item, colors }) => {
  const kdv = toNum(item.KDV_TUTAR);
  const netKdvDahil = toNum(item.SATIR_GENEL_TOPLAM || item.DAHIL_NET_TUTAR);
  return (
    <View style={[styles.detail, { borderLeftColor: colors.primary + '80', backgroundColor: colors.card + 'C0', borderColor: colors.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
        <Ionicons name="arrow-forward-outline" size={12} color={colors.primary} />
        <Text style={{ fontSize: 11, color: colors.textSecondary, marginLeft: 4 }}>{String(item.STOK_KOD || '')}</Text>
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}>{fmtMoney(netKdvDahil)}</Text>
      </View>
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6 }} numberOfLines={2}>{String(item.STOK_AD || '-')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Text style={{ fontSize: 11, color: colors.textSecondary }}>Miktar: <Text style={{ color: colors.text, fontWeight: '600' }}>{toNum(item.MIKTAR_FIS).toLocaleString('tr-TR')} {String(item.STOK_BIRIM || '')}</Text></Text>
        <Text style={{ fontSize: 11, color: colors.textSecondary }}>Fiyat: <Text style={{ color: colors.text, fontWeight: '600' }}>{fmtMoney(toNum(item.NET_FIYAT))}</Text></Text>
        {kdv > 0 && <Text style={{ fontSize: 11, color: colors.textSecondary }}>KDV: <Text style={{ color: colors.text, fontWeight: '600' }}>{fmtMoney(kdv)}</Text></Text>}
      </View>
    </View>
  );
};

const ReportCardComp: React.FC<Props> = ({ item, report, colors }) => {
  if (item.__isFisHeader) return <FisHeaderCard item={item} colors={colors} />;
  if (item.__isDetail) return <DetailRow item={item} colors={colors} />;

  const cl = report?.cardLayout;
  if (!cl) {
    // Yedek: 2 kolonlu ızgara
    return (
      <View style={[cardStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {(report?.columns || []).map(col => (
            <View key={col.key} style={cardStyles.resultCell}>
              <Text style={{ fontSize: 10, color: colors.textSecondary }}>{col.label}</Text>
              <Text style={{ fontSize: 12, fontWeight: '600', color: col.type === 'money' ? colors.primary : colors.text }} numberOfLines={1}>{renderValue(item[col.key], col)}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  const codeVal = cl.code ? String(item[cl.code] ?? '') : '';
  const amountCurrency = cl.amountCurrency ? String(item[cl.amountCurrency] ?? '') : '';
  const amountText = cl.amount
    ? (cl.amountType === 'money'
        ? fmtMoney(parseFloat(item[cl.amount] || '0'))
        : parseFloat(item[cl.amount] || '0').toLocaleString('tr-TR', { minimumFractionDigits: 2 }))
    : '';
  return (
    <View style={[cardStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={cardStyles.cardTop}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          {codeVal !== '' && <Text style={[cardStyles.code, { color: colors.textSecondary }]} numberOfLines={1}>{codeVal}</Text>}
          <Text style={[cardStyles.title, { color: colors.text }]} numberOfLines={2}>{String(item[cl.title] ?? '-')}</Text>
        </View>
        {cl.amount && (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[cardStyles.amount, { color: colors.primary }]} numberOfLines={1}>{amountText}</Text>
            {amountCurrency !== '' && <Text style={[cardStyles.amountCurrency, { color: colors.textSecondary }]}>{amountCurrency}</Text>}
          </View>
        )}
      </View>
      {!!cl.chips?.length && (
        <View style={cardStyles.chipsRow}>
          {cl.chips.map(c => {
            const v = item[c.key];
            if (v === undefined || v === null || v === '') return null;
            const col = report?.columns.find(x => x.key === c.key);
            const label = c.label || col?.label || c.key;
            let txt: string; let bg = colors.primary + '12'; let fg = colors.primary;
            if (c.type === 'bool' || col?.type === 'bool') {
              const isTrue = isTruthyFlag(v);
              txt = `${label}: ${isTrue ? 'Evet' : 'Hayır'}`;
              bg = isTrue ? colors.success + '20' : colors.error + '18';
              fg = isTrue ? colors.success : colors.error;
            } else if (c.type === 'number' || col?.type === 'number') {
              txt = `${label}: ${fmtNumber(toNum(v))}`;
            } else {
              txt = c.label ? `${c.label}: ${v}` : String(v);
            }
            return <View key={c.key} style={[cardStyles.chip, { backgroundColor: bg }]}><Text style={[cardStyles.chipText, { color: fg }]} numberOfLines={1}>{txt}</Text></View>;
          })}
        </View>
      )}
      {!!cl.meta?.length && (
        <View style={[cardStyles.metaRow, { borderTopColor: colors.border }]}>
          {cl.meta.map(m => {
            const v = item[m.key];
            if (v === undefined || v === null || v === '' || v === '-') return null;
            const col = report?.columns.find(x => x.key === m.key);
            let val = String(v);
            if (m.type === 'money' || col?.type === 'money') val = `₺${toNum(v).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;
            else if (m.type === 'number' || col?.type === 'number') val = fmtNumber(toNum(v));
            return (
              <View key={m.key} style={cardStyles.metaItem}>
                <Text style={[cardStyles.metaLabel, { color: colors.textSecondary }]}>{m.label || col?.label || m.key}</Text>
                <Text style={[cardStyles.metaValue, { color: colors.text }]} numberOfLines={1}>{val}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  detail: { marginLeft: 16, marginTop: -8, marginBottom: 8, padding: 10, borderRadius: 8, borderLeftWidth: 3, borderWidth: StyleSheet.hairlineWidth },
});

export const ReportCard = memo(ReportCardComp, (p, n) => p.item === n.item && p.report === n.report && p.colors === n.colors);
export default ReportCard;
