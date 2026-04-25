import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface Row {
  CARI_ID: number;
  CARI_KOD: string;
  CARI_AD: string;
  LOKASYON_AD: string;
  TOPLAM_FIS_SAYISI: number;
  PERAKENDE_FIS_SAYISI: number;
  ERP12_FIS_SAYISI: number;
  TOPLAM_CIRO: number;
  TOPLAM_ODEME: number;
  TOPLAM_ACIK_HESAP: number;
  PERAKENDE_ACIK_HESAP: number;
  ERP12_ACIK_HESAP: number;
  TOPLAM_ISKONTO: number;
  PERAKENDE_ISKONTO: number;
  ERP12_ISKONTO: number;
  SON_FIS_TARIHI: string;
}

interface Totals {
  toplam_kayit: number;
  genel_toplam: number;
  genel_perakende: number;
  genel_erp12: number;
}

const fmtTL = (n: number) =>
  n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const parseFloatField = (v: any): number => {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
};

export const AcikHesapKisiDetail: React.FC<{
  tenantId: string;
  sdate: string; // YYYY-MM-DD
  edate: string;
  visible: boolean;
}> = ({ tenantId, sdate, edate, visible }) => {
  const { colors } = useThemeStore();
  const { token } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !tenantId || !token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const attempt = async (tryNum: number, maxTries: number): Promise<any> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 100000);
      try {
        const resp = await fetch(`${API_URL}/api/data/acik-hesap-kisi`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
          body: JSON.stringify({
            tenant_id: tenantId,
            sdate, edate,
            page: 1, pageSize: 200,
          }),
        });
        clearTimeout(timer);
        if (!resp.ok) {
          // 502/504 = upstream POS hiccup; retry transparently
          if ((resp.status === 502 || resp.status === 504) && tryNum < maxTries) {
            await new Promise((r) => setTimeout(r, 1500 * tryNum)); // backoff
            return attempt(tryNum + 1, maxTries);
          }
          throw new Error(`HTTP ${resp.status}`);
        }
        return await resp.json();
      } catch (e: any) {
        clearTimeout(timer);
        // Network/timeout retry
        if (tryNum < maxTries && !cancelled) {
          await new Promise((r) => setTimeout(r, 1500 * tryNum));
          return attempt(tryNum + 1, maxTries);
        }
        throw e;
      }
    };

    (async () => {
      try {
        const j = await attempt(1, 3); // up to 3 attempts
        if (cancelled) return;

        // Normalize numeric fields (POS may return strings)
        const data: Row[] = (j?.data || []).map((r: any) => ({
          CARI_ID: parseInt(r.CARI_ID || '0'),
          CARI_KOD: String(r.CARI_KOD || ''),
          CARI_AD: String(r.CARI_AD || 'Tanımsız'),
          LOKASYON_AD: String(r.LOKASYON_AD || '-'),
          TOPLAM_FIS_SAYISI: parseInt(r.TOPLAM_FIS_SAYISI || '0'),
          PERAKENDE_FIS_SAYISI: parseInt(r.PERAKENDE_FIS_SAYISI || '0'),
          ERP12_FIS_SAYISI: parseInt(r.ERP12_FIS_SAYISI || '0'),
          TOPLAM_CIRO: parseFloatField(r.TOPLAM_CIRO),
          TOPLAM_ODEME: parseFloatField(r.TOPLAM_ODEME),
          TOPLAM_ACIK_HESAP: parseFloatField(r.TOPLAM_ACIK_HESAP),
          PERAKENDE_ACIK_HESAP: parseFloatField(r.PERAKENDE_ACIK_HESAP),
          ERP12_ACIK_HESAP: parseFloatField(r.ERP12_ACIK_HESAP),
          TOPLAM_ISKONTO: parseFloatField(r.TOPLAM_ISKONTO),
          PERAKENDE_ISKONTO: parseFloatField(r.PERAKENDE_ISKONTO),
          ERP12_ISKONTO: parseFloatField(r.ERP12_ISKONTO),
          SON_FIS_TARIHI: String(r.SON_FIS_TARIHI || ''),
        }));
        setRows(data);
        setTotals(j?.totals || null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Hata');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, tenantId, sdate, edate, token]);

  if (!visible) return null;

  if (loading) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 24 }}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 8 }}>
          Müşteri açık hesapları yükleniyor...
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ padding: 12, borderRadius: 10, backgroundColor: colors.error + '12', borderWidth: 1, borderColor: colors.error + '40' }}>
        <Text style={{ color: colors.error, fontSize: 12 }}>Hata: {error}</Text>
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={{ padding: 16, alignItems: 'center' }}>
        <Ionicons name="checkmark-circle-outline" size={28} color={colors.success} />
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 6 }}>
          Açık hesap bulunmamaktadır
        </Text>
      </View>
    );
  }

  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>
          👥 Müşteri Bazlı Açık Hesaplar
        </Text>
        {totals && (
          <View style={{ backgroundColor: colors.openAccount + '18', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
            <Text style={{ color: colors.openAccount, fontSize: 11, fontWeight: '700' }}>
              {totals.toplam_kayit} müşteri
            </Text>
          </View>
        )}
      </View>

      {totals && (totals.genel_perakende > 0 || totals.genel_erp12 > 0) && (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          <View style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: '#10B98115', borderWidth: 1, borderColor: '#10B98140' }}>
            <Text style={{ color: '#10B981', fontSize: 10, fontWeight: '700', marginBottom: 2 }}>PERAKENDE</Text>
            <Text style={{ color: '#10B981', fontSize: 14, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              ₺{fmtTL(totals.genel_perakende)}
            </Text>
          </View>
          <View style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: '#8B5CF615', borderWidth: 1, borderColor: '#8B5CF640' }}>
            <Text style={{ color: '#8B5CF6', fontSize: 10, fontWeight: '700', marginBottom: 2 }}>ERP12</Text>
            <Text style={{ color: '#8B5CF6', fontSize: 14, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              ₺{fmtTL(totals.genel_erp12)}
            </Text>
          </View>
        </View>
      )}

      <ScrollView style={{ maxHeight: 400 }} nestedScrollEnabled showsVerticalScrollIndicator>
        {rows.map((r, i) => {
          const pct = totals?.genel_toplam ? (r.TOPLAM_ACIK_HESAP / totals.genel_toplam) * 100 : 0;
          return (
            <View
              key={`${r.CARI_ID}-${r.LOKASYON_AD}-${i}`}
              style={{
                marginBottom: 8,
                padding: 12,
                borderRadius: 12,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }} numberOfLines={1}>
                    {r.CARI_AD}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 10 }} numberOfLines={1}>
                    📍 {r.LOKASYON_AD}{r.CARI_KOD ? ` · ${r.CARI_KOD}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: colors.openAccount, fontSize: 15, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    ₺{fmtTL(r.TOPLAM_ACIK_HESAP)}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 10 }}>%{pct.toFixed(1)}</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {r.PERAKENDE_ACIK_HESAP > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#10B98115', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                    <Text style={{ color: '#10B981', fontSize: 10, fontWeight: '700' }}>P: ₺{fmtTL(r.PERAKENDE_ACIK_HESAP)}</Text>
                    <Text style={{ color: '#10B981', fontSize: 9 }}>({r.PERAKENDE_FIS_SAYISI}f)</Text>
                  </View>
                )}
                {r.ERP12_ACIK_HESAP > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#8B5CF615', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                    <Text style={{ color: '#8B5CF6', fontSize: 10, fontWeight: '700' }}>E: ₺{fmtTL(r.ERP12_ACIK_HESAP)}</Text>
                    <Text style={{ color: '#8B5CF6', fontSize: 9 }}>({r.ERP12_FIS_SAYISI}f)</Text>
                  </View>
                )}
                {r.TOPLAM_ISKONTO > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.warning + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                    <Ionicons name="pricetag-outline" size={10} color={colors.warning} />
                    <Text style={{ color: colors.warning, fontSize: 10, fontWeight: '700' }}>₺{fmtTL(r.TOPLAM_ISKONTO)} iskonto</Text>
                  </View>
                )}
              </View>

              <Text style={{ color: colors.textSecondary, fontSize: 10, marginTop: 4 }}>
                Ciro ₺{fmtTL(r.TOPLAM_CIRO)} · Ödeme ₺{fmtTL(r.TOPLAM_ODEME)}
                {r.SON_FIS_TARIHI ? ` · Son: ${String(r.SON_FIS_TARIHI).slice(0, 10)}` : ''}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};
