import { StyleSheet } from 'react-native';

/**
 * Shared modal/dialog styles for desktop web (>= 1024px).
 *
 * IMPORTANT — RN-Web flex bug workaround (2026-02):
 *  React-Native-Web collapses children with `flex: 0` to content height
 *  when the parent uses `alignItems: 'center'`. Setting explicit `height: Npx`
 *  is also unreliable in flex contexts.
 *
 *  PRAGMATIC SOLUTION: Keep the existing mobile bottom-sheet layout intact
 *  on web — i.e. parent overlay with `justifyContent: 'flex-end'` and child
 *  modalContent with `flex:1, maxHeight: '92%'`. This combo IS proven to
 *  work in RNW. We only add a darker backdrop for desktop, plus rounded
 *  corners + shadow on the card.  Centered-dialog look is sacrificed for
 *  reliability.
 *
 * Usage:
 *   <View style={[
 *     styles.modalOverlay,
 *     Platform.OS === 'web' && isDesktop && webStyles.overlayDesktop,
 *   ]}>
 *     <View style={[
 *       styles.modalContent,                // flex:1, maxHeight:92%
 *       { backgroundColor: colors.surface },
 *       Platform.OS === 'web' && isDesktop && [webStyles.cardDesktop, { borderColor: colors.border }],
 *     ]}>
 *       ...
 */
export const webStyles = StyleSheet.create({
  // Desktop: keep base flex-end alignment, just darken backdrop and center
  // horizontally so the constrained-width card lands in the middle.
  overlayDesktop: {
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
  },
  // Constrains the card's WIDTH (cross-axis) and adds dialog chrome.
  // Vertical sizing is left to base styles.modalContent (flex:1, maxHeight:92%).
  cardDesktop: {
    width: 720,
    maxWidth: 720,
    borderRadius: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    boxShadow: '0 12px 30px rgba(0,0,0,0.25)',
  } as any,
  // Wider variant for tables / detail screens
  cardDesktopWide: {
    width: 1100,
    maxWidth: 1100,
    borderRadius: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    boxShadow: '0 12px 30px rgba(0,0,0,0.25)',
  } as any,
});

export default webStyles;
