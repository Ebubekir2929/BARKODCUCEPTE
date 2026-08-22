/**
 * Dashboard modal'larının ortak stilleri.
 * 2026-08 refactor: dashboard.tsx'ten çıkarılan modal komponentleri
 * (CardTypeLocationModal, HourDetailModal, LocationIptalModal) kullanır.
 */
import { Dimensions, Platform, StyleSheet } from 'react-native';

const screenHeight = Dimensions.get('window').height;

export const modalStyles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: screenHeight * 0.85,
    overflow: 'hidden',
    flexGrow: 0,
    flexShrink: 1,
    alignSelf: Platform.OS === 'web' ? 'center' : 'flex-end',
    width: '100%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalBody: {
    padding: 20,
  },
  modalBodyContent: {
    paddingBottom: 50,
    flexGrow: 0,
  },
});
