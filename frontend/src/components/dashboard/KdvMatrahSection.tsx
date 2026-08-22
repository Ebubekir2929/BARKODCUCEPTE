/**
 * KDV / Matrah Detayı bölümü — dashboard.tsx'ten çıkarıldı (2026-08 refactor).
 * KDV oranı bazında dağılım + lokasyon kırılımı gösterir.
 */
import React from 'react';
import { View, Text, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  kdvBreakdown: any;
  colors: any;
  style?: StyleProp<ViewStyle>;
}

export function KdvMatrahSection({ kdvBreakdown, colors, style }: Props) {
  const grandRates = kdvBreakdown?.grandRates || [];
  if (grandRates.length === 0) return null;

  const grandMatrah = kdvBreakdown.grandTotalMatrah;
  const grandKdv = kdvBreakdown.grandTotalKdv;
  const grandTotal = grandMatrah + grandKdv;
  const fmt = (v: number) => v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtShort = (v: number) => {
    if (v >= 1000000) return `${(v / 1000000).toFixed(2)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
    return v.toFixed(0);
  };
  // Renkler oran bazında — her oran farklı bir hue
  const rateColor = (rate: number): string => {
    if (rate === 0) return '#10B981';     // yeşil
    if (rate === 1) return '#3B82F6';     // mavi
    if (rate === 8) return '#F59E0B';     // amber
    if (rate === 10) return '#EC4899';    // pembe
    if (rate === 18) return '#EF4444';    // kırmızı
    if (rate === 20) return '#8B5CF6';    // mor
    return colors.primary;
  };

  return (
    <View style={style}>
      {/* Başlık + KPI özet */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <View style={{
          width: 36, height: 36, borderRadius: 10,
          backgroundColor: colors.primary + '18',
          justifyContent: 'center', alignItems: 'center',
        }}>
          <Ionicons name="calculator" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>
            KDV / Matrah Detayı
          </Text>
          <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
            KDV oranı bazında dağılım
          </Text>
        </View>
      </View>

      {/* Üst KPI Şeridi: Matrah / KDV / Toplam */}
      <View style={{
        flexDirection: 'row', gap: 8, marginTop: 14, marginBottom: 16,
      }}>
        <View style={{
          flex: 1, padding: 10, borderRadius: 12,
          backgroundColor: colors.background,
          borderWidth: 1, borderColor: colors.border,
        }}>
          <Text style={{ fontSize: 9, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Matrah
          </Text>
          <Text style={{ fontSize: 17, fontWeight: '900', color: colors.text, marginTop: 4 }} numberOfLines={1}>
            ₺{fmtShort(grandMatrah)}
          </Text>
          <Text style={{ fontSize: 9, color: colors.textSecondary, marginTop: 1 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            ₺{fmt(grandMatrah)}
          </Text>
        </View>
        <View style={{
          flex: 1, padding: 10, borderRadius: 12,
          backgroundColor: '#F59E0B' + '12',
          borderWidth: 1, borderColor: '#F59E0B' + '40',
        }}>
          <Text style={{ fontSize: 9, fontWeight: '700', color: '#F59E0B', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            KDV
          </Text>
          <Text style={{ fontSize: 17, fontWeight: '900', color: '#F59E0B', marginTop: 4 }} numberOfLines={1}>
            ₺{fmtShort(grandKdv)}
          </Text>
          <Text style={{ fontSize: 9, color: '#F59E0B', opacity: 0.7, marginTop: 1 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            ₺{fmt(grandKdv)}
          </Text>
        </View>
        <View style={{
          flex: 1, padding: 10, borderRadius: 12,
          backgroundColor: colors.primary + '15',
          borderWidth: 1.5, borderColor: colors.primary + '50',
        }}>
          <Text style={{ fontSize: 9, fontWeight: '700', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Toplam
          </Text>
          <Text style={{ fontSize: 17, fontWeight: '900', color: colors.primary, marginTop: 4 }} numberOfLines={1}>
            ₺{fmtShort(grandTotal)}
          </Text>
          <Text style={{ fontSize: 9, color: colors.primary, opacity: 0.7, marginTop: 1 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            ₺{fmt(grandTotal)}
          </Text>
        </View>
      </View>

      {/* Oran kartları */}
      {grandRates.map((g: any) => {
        const c = rateColor(g.rate);
        const sharePct = grandTotal > 0 ? (g.total / grandTotal) * 100 : 0;
        return (
          <View
            key={g.rate}
            style={{
              marginBottom: 10,
              padding: 12,
              borderRadius: 12,
              backgroundColor: colors.background,
              borderWidth: 1,
              borderColor: colors.border,
              borderLeftWidth: 4,
              borderLeftColor: c,
            }}
          >
            {/* Üst satır: Rate chip + Toplam */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{
                  backgroundColor: c + '20',
                  paddingHorizontal: 10, paddingVertical: 5,
                  borderRadius: 8,
                }}>
                  <Text style={{ fontSize: 13, fontWeight: '900', color: c }}>%{g.rate} KDV</Text>
                </View>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textSecondary }}>
                  {sharePct.toFixed(1)}% pay
                </Text>
              </View>
              <Text style={{ fontSize: 15, fontWeight: '900', color: c }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                ₺{fmt(g.total)}
              </Text>
            </View>

            {/* Pay barı */}
            <View style={{
              height: 4, backgroundColor: c + '15', borderRadius: 2, overflow: 'hidden', marginBottom: 10,
            }}>
              <View style={{
                width: `${Math.max(sharePct, 1)}%`,
                height: '100%',
                backgroundColor: c,
                borderRadius: 2,
              }} />
            </View>

            {/* Alt satır: Matrah / KDV ayrı ayrı */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', marginBottom: 2 }}>
                  Matrah
                </Text>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                  ₺{fmt(g.matrah)}
                </Text>
              </View>
              <View style={{ width: 1, backgroundColor: colors.border, marginHorizontal: 4 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#F59E0B', textTransform: 'uppercase', marginBottom: 2 }}>
                  KDV
                </Text>
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#F59E0B' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                  ₺{fmt(g.kdv)}
                </Text>
              </View>
            </View>
          </View>
        );
      })}

      {/* 2026-05-16 — Lokasyon kırılımı: filtreli durumda sadece seçili
          lokasyon, normalde tüm gerçek lokasyonlar. Her satır o
          lokasyonun matrah/kdv/toplamını ve oran kırılımını gösterir. */}
      {((kdvBreakdown?.branches || []) as any[]).length > 0 && (
        <View style={{ marginTop: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Ionicons name="business-outline" size={14} color={colors.primary} />
            <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text }}>
              Lokasyon Bazında
            </Text>
          </View>
          {((kdvBreakdown?.branches || []) as any[]).map((b: any) => {
            const bTotal = (b.totalMatrah || 0) + (b.totalKdv || 0);
            if (bTotal <= 0) return null;
            return (
              <View
                key={b.branchId || b.branchName}
                style={{
                  marginBottom: 10,
                  padding: 12,
                  borderRadius: 12,
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
                    <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text }} numberOfLines={1}>
                      {b.branchName || 'Bilinmeyen'}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '900', color: colors.primary }} numberOfLines={1}>
                    ₺{fmt(bTotal)}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 9, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase' }}>
                      Matrah
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      ₺{fmt(b.totalMatrah || 0)}
                    </Text>
                  </View>
                  <View style={{ width: 1, backgroundColor: colors.border, marginHorizontal: 4 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 9, fontWeight: '700', color: '#F59E0B', textTransform: 'uppercase' }}>
                      KDV
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: '#F59E0B', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      ₺{fmt(b.totalKdv || 0)}
                    </Text>
                  </View>
                </View>
                {/* Oran kırılımı satırları */}
                {(b.rates || []).length > 0 && (
                  <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
                    {(b.rates || []).map((r: any) => {
                      const c = rateColor(r.rate);
                      return (
                        <View key={r.rate} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <View style={{
                            backgroundColor: c + '20', paddingHorizontal: 7, paddingVertical: 2,
                            borderRadius: 5,
                          }}>
                            <Text style={{ fontSize: 10, fontWeight: '800', color: c }}>%{r.rate}</Text>
                          </View>
                          <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                            M: ₺{fmt(r.matrah || 0)} · K: ₺{fmt(r.kdv || 0)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
