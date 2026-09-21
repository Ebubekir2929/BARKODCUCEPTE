import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/themeStore';
import { useAuthStore } from '../../store/authStore';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

type Ayar = {
  aktif: boolean;
  email: string;
  gonderim_saati: string;
  sonraki: string;
  son_gonderim: { hafta: string; durum: string; zaman: string | null; hata?: string | null } | null;
};

type Props = {
  showSuccess: (title: string, msg: string) => void;
  showError: (title: string, msg: string) => void;
};

function zamanMetni(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Ayarlar → "Haftalık Rapor Maili": Pazartesi özet e-postası aç/kapa + hemen gönder. */
export default function HaftalikRaporMailKarti({ showSuccess, showError }: Props) {
  const { colors } = useThemeStore();
  const token = useAuthStore((s) => s.token);
  const [ayar, setAyar] = useState<Ayar | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`${API_URL}/api/rapor-mail/ayar`, { headers: headers() });
      const j = await r.json();
      if (r.ok && j?.ok) setAyar(j.data);
    } catch (e) {
      console.log('rapor-mail ayar yüklenemedi', e);
    } finally {
      setLoading(false);
    }
  }, [token, headers]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (value: boolean) => {
    if (!ayar) return;
    const onceki = ayar.aktif;
    setAyar({ ...ayar, aktif: value });
    setSaving(true);
    try {
      const r = await fetch(`${API_URL}/api/rapor-mail/ayar`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ aktif: value }),
      });
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      setAyar((a) => (a ? { ...a, aktif: onceki } : a));
      showError('Hata', 'Ayar kaydedilemedi. Lütfen tekrar deneyin.');
    } finally {
      setSaving(false);
    }
  };

  const gonderSimdi = async () => {
    if (sending) return;
    setSending(true);
    try {
      const r = await fetch(`${API_URL}/api/rapor-mail/gonder-simdi`, { method: 'POST', headers: headers() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.detail || 'Gönderilemedi');
      showSuccess('Gönderildi', `Haftalık özet ${j.email} adresine gönderildi.`);
      load();
    } catch (e: any) {
      showError('Gönderilemedi', e?.message || 'E-posta gönderilemedi. Lütfen daha sonra tekrar deneyin.');
    } finally {
      setSending(false);
    }
  };

  const son = ayar?.son_gonderim;
  const sonMetin = son
    ? son.durum === 'gonderildi'
      ? `Son gönderim: ${zamanMetni(son.zaman)}`
      : son.durum === 'veri_yok'
        ? `Son tur (${son.hafta}): satış verisi yoktu, gönderilmedi`
        : `Son gönderim başarısız (${zamanMetni(son.zaman)})`
    : 'Henüz gönderilmedi';

  return (
    <View style={styles.section} testID="haftalik-rapor-mail">
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>HAFTALIK RAPOR MAİLİ</Text>
      <View style={[styles.sectionContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.menuItem, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
          <View style={styles.menuItemLeft}>
            <Ionicons name="mail-outline" size={22} color={colors.primary} />
            <View style={{ flexShrink: 1 }}>
              <Text style={[styles.menuItemLabel, { color: colors.text }]}>Haftalık Satış Özeti</Text>
              <Text style={[styles.menuItemSub, { color: colors.textSecondary }]} numberOfLines={2}>
                {loading ? 'Yükleniyor…' : `Her ${ayar?.gonderim_saati || 'Pazartesi 08:00'} · ${ayar?.email || 'e-posta yok'}`}
              </Text>
            </View>
          </View>
          {loading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Switch
              value={!!ayar?.aktif}
              onValueChange={toggle}
              disabled={saving || !ayar}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
              testID="haftalik-rapor-switch"
            />
          )}
        </View>

        <View style={styles.infoRow}>
          <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
          <Text style={[styles.infoText, { color: colors.textSecondary }]} numberOfLines={2}>
            {loading ? ' ' : ayar?.aktif ? `Sonraki gönderim: ${ayar?.sonraki}` : 'Kapalı — Pazartesi özeti gönderilmez'}
          </Text>
        </View>
        <View style={[styles.infoRow, { paddingTop: 0 }]}>
          <Ionicons
            name={son?.durum === 'gonderildi' ? 'checkmark-circle-outline' : 'information-circle-outline'}
            size={16}
            color={son?.durum === 'gonderildi' ? colors.success : colors.textSecondary}
          />
          <Text style={[styles.infoText, { color: colors.textSecondary }]} numberOfLines={2} testID="haftalik-rapor-son">
            {loading ? ' ' : sonMetin}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.menuItem, { borderTopColor: colors.border, borderTopWidth: 1 }]}
          onPress={gonderSimdi}
          disabled={sending || loading || !ayar?.email}
          testID="haftalik-rapor-gonder"
        >
          <View style={styles.menuItemLeft}>
            <Ionicons name="paper-plane-outline" size={22} color={colors.primary} />
            <View style={{ flexShrink: 1 }}>
              <Text style={[styles.menuItemLabel, { color: colors.text }]}>Şimdi Gönder</Text>
              <Text style={[styles.menuItemSub, { color: colors.textSecondary }]}>
                Geçen haftanın özetini hemen e-postama gönder
              </Text>
            </View>
          </View>
          {sending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, marginBottom: 24 },
  sectionTitle: { fontSize: 13, fontWeight: '600', marginBottom: 8, marginLeft: 4, textTransform: 'uppercase' },
  sectionContent: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 48,
  },
  menuItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  menuItemLabel: { fontSize: 15, fontWeight: '500' },
  menuItemSub: { fontSize: 12, marginTop: 2 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  infoText: { fontSize: 12, flex: 1 },
});
