// 2026-05-06 — Mobil-only proje. Web sürümü AYRI bir projede yazılacak.
// Tüm web/desktop modal stilleri etkisiz hale getirildi (boş StyleSheet).
// İmport eden dosyalardaki kullanım: `Platform.OS === 'web' && isDesktop && webStyles.xxx`
// — `isDesktop` artık her zaman `false` döndüğü için bu branch'lar hiç çalışmaz
// (dead code). Yeni özelliklerde bu kalıbı KULLANMAYIN.
import { StyleSheet } from 'react-native';

export const webStyles = StyleSheet.create({
  overlayDesktop: {},
  cardDesktop: {} as any,
  cardDesktopWide: {} as any,
});

export default webStyles;
