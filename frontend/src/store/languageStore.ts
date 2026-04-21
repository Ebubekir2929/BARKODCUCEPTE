import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { translations, Language, TranslationKey } from '../i18n/translations';

interface LanguageState {
  language: Language;
  isReady: boolean;
  t: (key: TranslationKey) => string;
  setLanguage: (lang: Language) => Promise<void>;
  loadLanguage: () => Promise<void>;
}

export const useLanguageStore = create<LanguageState>((set, get) => ({
  language: 'tr',
  isReady: false,

  t: (key: TranslationKey) => {
    const { language } = get();
    return translations[language][key] || (translations.tr as any)[key] || key;
  },

  setLanguage: async (lang: Language) => {
    set({ language: lang });
    await AsyncStorage.setItem('app_language', lang);
  },

  loadLanguage: async () => {
    try {
      const savedLang = await AsyncStorage.getItem('app_language');
      if (savedLang && (savedLang === 'tr' || savedLang === 'en')) {
        set({ language: savedLang as Language, isReady: true });
      } else {
        set({ isReady: true });
      }
    } catch (error) {
      console.log('Error loading language:', error);
      set({ isReady: true });
    }
  },
}));
