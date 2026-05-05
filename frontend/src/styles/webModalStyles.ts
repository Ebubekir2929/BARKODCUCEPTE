import { StyleSheet } from 'react-native';

/**
 * Shared modal/dialog styles for desktop web (>= 1024px).
 * Apply conditionally with: `Platform.OS === 'web' && isDesktop && webStyles.overlayDesktop`.
 *
 * Pattern:
 *   <View style={[styles.modalOverlay, Platform.OS === 'web' && isDesktop && webStyles.overlayDesktop]}>
 *     <View style={[styles.modalContent, ..., Platform.OS === 'web' && isDesktop && [webStyles.cardDesktop, { borderColor: colors.border }]]}>
 *       ...
 */
export const webStyles = StyleSheet.create({
  // Dark backdrop, centered card
  overlayDesktop: {
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  // Centered dialog card with shadow + rounded corners
  cardDesktop: {
    width: '95%',
    maxWidth: 720,
    flex: 0,
    minHeight: 320,
    maxHeight: '88%',
    borderRadius: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 30,
    elevation: 24,
  },
  // Wider variant for tables / detail screens
  cardDesktopWide: {
    width: '95%',
    maxWidth: 1100,
    flex: 0,
    height: '92%',
    maxHeight: '92%',
    borderRadius: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 30,
    elevation: 24,
  },
});

export default webStyles;
