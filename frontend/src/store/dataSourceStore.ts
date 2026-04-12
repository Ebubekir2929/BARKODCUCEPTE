import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type DataSource = 'data1' | 'data2' | 'data3';

interface DataSourceState {
  activeSource: DataSource;
  setActiveSource: (source: DataSource) => Promise<void>;
  loadDataSource: () => Promise<void>;
}

export const useDataSourceStore = create<DataSourceState>((set) => ({
  activeSource: 'data1',

  setActiveSource: async (source: DataSource) => {
    set({ activeSource: source });
    await AsyncStorage.setItem('active_data_source', source);
  },

  loadDataSource: async () => {
    try {
      const saved = await AsyncStorage.getItem('active_data_source');
      if (saved && (saved === 'data1' || saved === 'data2' || saved === 'data3')) {
        set({ activeSource: saved as DataSource });
      }
    } catch (error) {
      console.log('Error loading data source:', error);
    }
  },
}));
