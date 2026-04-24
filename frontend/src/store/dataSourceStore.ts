import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// DataSource is a flexible string type (data1, data2, data3, data4, ... — unlimited)
export type DataSource = string;

interface DataSourceState {
  activeSource: DataSource;
  setActiveSource: (source: DataSource) => Promise<void>;
  loadDataSource: () => Promise<void>;
}

const isValidKey = (s: any): s is string =>
  typeof s === 'string' && /^data\d+$/.test(s);

export const useDataSourceStore = create<DataSourceState>((set) => ({
  activeSource: 'data1',

  setActiveSource: async (source: DataSource) => {
    set({ activeSource: source });
    await AsyncStorage.setItem('active_data_source', source);
  },

  loadDataSource: async () => {
    try {
      const saved = await AsyncStorage.getItem('active_data_source');
      if (saved && isValidKey(saved)) {
        set({ activeSource: saved });
      }
    } catch (error) {
      console.log('Error loading data source:', error);
    }
  },
}));
