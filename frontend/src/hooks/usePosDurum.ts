/**
 * POS istemcisi kalp atışı durumu (hafif /senkron/pos-durum ucu).
 * Ekran odaktayken yüklenir ve 60 sn'de bir yenilenir.
 */
import { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuthStore } from '../store/authStore';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export interface PosDurum {
  aktif: boolean;
  son_gorulme: string | null;
  yas_sn: number | null;
  durum: 'iyi' | 'uyari' | 'kritik' | 'yok';
}

export function usePosDurum(tenantId: string): PosDurum | null {
  const [durum, setDurum] = useState<PosDurum | null>(null);

  // Tenant değişince eski tenant'ın durumu gösterilmesin
  useEffect(() => { setDurum(null); }, [tenantId]);

  const load = useCallback(async () => {
    const { token } = useAuthStore.getState();
    if (!token || !tenantId) { setDurum(null); return; }
    try {
      const r = await fetch(`${API_URL}/api/senkron/pos-durum?tenant_id=${tenantId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      if (j?.ok && j.data) setDurum(j.data as PosDurum);
    } catch {
      // ağ hatası → son bilinen durumu koru
    }
  }, [tenantId]);

  useFocusEffect(useCallback(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]));

  return durum;
}
