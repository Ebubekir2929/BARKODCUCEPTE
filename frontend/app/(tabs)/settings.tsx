import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, isDark, toggleTheme } = useThemeStore();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    Alert.alert(
      'Çıkış Yap',
      'Hesabınızdan çıkış yapmak istediğinize emin misiniz?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Çıkış Yap',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  };

  const handleClearCache = () => {
    Alert.alert(
      'Önbelleği Temizle',
      'Tüm önbellekteki veriler silinecek. Devam etmek istiyor musunuz?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Temizle',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.removeItem('cached_products');
              await AsyncStorage.removeItem('cached_customers');
              Alert.alert('Başarılı', 'Önbellek temizlendi');
            } catch (error) {
              Alert.alert('Hata', 'Önbellek temizlenirken bir hata oluştu');
            }
          },
        },
      ]
    );
  };

  const menuItems = [
    {
      title: 'Görünüm',
      items: [
        {
          icon: 'moon-outline' as const,
          label: 'Koyu Tema',
          type: 'switch' as const,
          value: isDark,
          onToggle: toggleTheme,
        },
      ],
    },
    {
      title: 'Veri Yönetimi',
      items: [
        {
          icon: 'trash-outline' as const,
          label: 'Önbelleği Temizle',
          type: 'button' as const,
          onPress: handleClearCache,
        },
        {
          icon: 'sync-outline' as const,
          label: 'Verileri Senkronize Et',
          type: 'button' as const,
          onPress: () => Alert.alert('Bilgi', 'Demo modunda senkronizasyon devre dışı'),
        },
      ],
    },
    {
      title: 'Uygulama',
      items: [
        {
          icon: 'information-circle-outline' as const,
          label: 'Hakkında',
          type: 'button' as const,
          onPress: () => Alert.alert('BizStats', 'Versiyon 1.0.0\n\nSatış Yönetim Sistemi'),
        },
        {
          icon: 'help-circle-outline' as const,
          label: 'Yardım',
          type: 'button' as const,
          onPress: () => Alert.alert('Yardım', 'Destek için: destek@bizstats.com'),
        },
      ],
    },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Ayarlar</Text>
      </View>

      <ScrollView style={styles.scrollView}>
        {/* User Card */}
        <View style={[styles.userCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.userAvatar, { backgroundColor: colors.primary + '20' }]}>
            <Text style={[styles.userAvatarText, { color: colors.primary }]}>
              {user?.name?.charAt(0) || 'U'}
            </Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={[styles.userName, { color: colors.text }]}>{user?.name || 'Kullanıcı'}</Text>
            <Text style={[styles.userEmail, { color: colors.textSecondary }]}>
              {user?.email || 'email@example.com'}
            </Text>
            <View style={[styles.roleBadge, { backgroundColor: colors.success + '20' }]}>
              <Text style={[styles.roleText, { color: colors.success }]}>
                {user?.role === 'admin' ? 'Yönetici' : 'Kullanıcı'}
              </Text>
            </View>
          </View>
        </View>

        {/* Menu Sections */}
        {menuItems.map((section, sectionIndex) => (
          <View key={sectionIndex} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{section.title}</Text>
            <View style={[styles.sectionContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {section.items.map((item, itemIndex) => (
                <React.Fragment key={itemIndex}>
                  {item.type === 'switch' ? (
                    <View
                      style={[
                        styles.menuItem,
                        itemIndex < section.items.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 1 },
                      ]}
                    >
                      <View style={styles.menuItemLeft}>
                        <Ionicons name={item.icon} size={22} color={colors.primary} />
                        <Text style={[styles.menuItemLabel, { color: colors.text }]}>{item.label}</Text>
                      </View>
                      <Switch
                        value={item.value}
                        onValueChange={item.onToggle}
                        trackColor={{ false: colors.border, true: colors.primary }}
                        thumbColor="#FFF"
                      />
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[
                        styles.menuItem,
                        itemIndex < section.items.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 1 },
                      ]}
                      onPress={item.onPress}
                    >
                      <View style={styles.menuItemLeft}>
                        <Ionicons name={item.icon} size={22} color={colors.primary} />
                        <Text style={[styles.menuItemLabel, { color: colors.text }]}>{item.label}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                </React.Fragment>
              ))}
            </View>
          </View>
        ))}

        {/* Logout Button */}
        <TouchableOpacity
          style={[styles.logoutButton, { backgroundColor: colors.error + '15', borderColor: colors.error }]}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={22} color={colors.error} />
          <Text style={[styles.logoutText, { color: colors.error }]}>Çıkış Yap</Text>
        </TouchableOpacity>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
  },
  userAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  userAvatarText: {
    fontSize: 26,
    fontWeight: '700',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    marginBottom: 8,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  sectionContent: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuItemLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
