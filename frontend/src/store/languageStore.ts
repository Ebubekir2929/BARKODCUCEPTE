import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { translations, Language, TranslationKey } from '../i18n/translations';

interface LanguageState {
  language: Language;
  t: (key: TranslationKey) => string;
  setLanguage: (lang: Language) => Promise<void>;
  loadLanguage: () => Promise<void>;
}

export const useLanguageStore = create<LanguageState>((set, get) => ({
  language: 'tr',
  
  t: (key: TranslationKey) => {
    const { language } = get();
    return translations[language][key] || key;
  },
  
  setLanguage: async (lang: Language) => {
    set({ language: lang });
    await AsyncStorage.setItem('app_language', lang);
  },
  
  loadLanguage: async () => {
    try {
      const savedLang = await AsyncStorage.getItem('app_language');
      if (savedLang && (savedLang === 'tr' || savedLang === 'en')) {
        set({ language: savedLang as Language });
      }
    } catch (error) {
      console.log('Error loading language:', error);
    }
  },
}));
