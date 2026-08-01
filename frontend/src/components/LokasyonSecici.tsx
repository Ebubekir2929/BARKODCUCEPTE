// 2026-06 — Lokasyon seçici (sayım + fiş girişi).
// POS client'ın bastığı `lokasyon_list` kaynağından otomatik dolar; ilk kayıt
// otomatik seçilir, kullanıcı chip'lerle değiştirir.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface Lokasyon { id: number; ad: string }

interface Props {
  apiUrl: string;
  tenantId: string;
  headers: Record<string, string>;
  value: Lokasyon | null;
  onChange: (l: Lokasyon) => void;
  colors: any;
}

export default function LokasyonSecici({ apiUrl, tenantId, headers, value, onChange, colors }: Props) {
  const [liste, setListe] = useState<Lokasyon[]>([]);
  const secildiMi = useRef(false);

  useEffect(() => {
    if (!tenantId) return;
    let iptal = false;
    (async () => {
      try {
        const r = await fetch(`${apiUrl}/api/islem/kaynak-liste?tenant_id=${tenantId}&key=lokasyon_list`, { headers });
        const j = await r.json();
        if (iptal || !j.ok || !Array.isArray(j.data)) return;
        const l: Lokasyon[] = j.data
          .map((x: any) => ({
            id: Number(x.ID ?? x.id) || 0,
            ad: String(x.ADI ?? x.AD ?? x.TANIM ?? x.ACIKLAMA ?? '').trim() || `Lokasyon ${x.ID ?? ''}`,
          }))
          .filter((x: Lokasyon) => x.id > 0);
        setListe(l);
        if (l.length > 0 && !secildiMi.current) {
          secildiMi.current = true;
          onChange(l[0]);
        }
      } catch {}
    })();
    return () => { iptal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  if (liste.length === 0) return null;
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>LOKASYON</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {liste.map((l) => {
          const secili = value?.id === l.id;
          return (
            <TouchableOpacity
              key={l.id}
              style={[styles.chip, {
                backgroundColor: secili ? colors.primary : colors.card,
                borderColor: secili ? colors.primary : colors.border,
              }]}
              onPress={() => onChange(l)}
            >
              {secili && <Ionicons name="location" size={12} color="#fff" />}
              <Text style={{ fontSize: 12, fontWeight: '700', color: secili ? '#fff' : colors.text }}>{l.ad}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginBottom: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
  },
});
