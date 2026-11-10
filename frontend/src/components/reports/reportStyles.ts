/**
 * Raporlar ekranı modal / kart ortak stilleri (2026-11 refactor).
 */
import { StyleSheet } from 'react-native';

export const reportModalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  content: { borderTopLeftRadius: 24, borderTopRightRadius: 24, flex: 1, maxHeight: '85%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  headerTitle: { fontSize: 16, fontWeight: '700', flex: 1 },
  searchInput: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, gap: 6 },
  filterInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  // Modal içi tam ekran karartma (tarih seçici / liste seçici / dışa aktarma)
  innerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', zIndex: 200 },
  dialogBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
});

export const cardStyles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  code: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3, marginBottom: 2 },
  title: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  amount: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  amountCurrency: { fontSize: 10, fontWeight: '600', marginTop: 2 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  chipText: { fontSize: 11, fontWeight: '600' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  metaItem: { minWidth: 70 },
  metaLabel: { fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 1 },
  metaValue: { fontSize: 12, fontWeight: '600' },
  resultCell: { minWidth: '40%', flex: 1 },
});
