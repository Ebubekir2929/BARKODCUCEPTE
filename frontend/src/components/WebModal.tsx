import React from 'react';
import { Modal, View, Platform, StyleSheet, ViewStyle } from 'react-native';
import { useResponsive } from '../hooks/useResponsive';

/**
 * Cross-platform Modal that:
 *  • On mobile (iOS/Android & narrow web): keeps the existing bottom-sheet
 *    behaviour (full-width content, slide-up animation).
 *  • On Desktop Web (>= 1024px): renders a centered dialog card with a
 *    semi-transparent dark backdrop, drop shadow, and rounded corners —
 *    the standard SaaS web modal pattern.
 *
 * Drop-in usage:
 *   <WebModal visible={open} onClose={...} maxWidth={760}>
 *     <View style={{ backgroundColor: colors.surface }}>... your card ...</View>
 *   </WebModal>
 *
 * The caller passes the inner card content; this wrapper handles the
 * <Modal>, the overlay (with backdrop click → onClose), and the centered/
 * sheet layout. The card itself should set its own background color, header,
 * scroll view, etc.
 */
export interface WebModalProps {
  visible: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  /** Max width of the centered dialog card on Desktop Web. Default 720. */
  maxWidth?: number;
  /** If true, the dialog occupies most of the height (e.g. for tables). Default false. */
  fullHeight?: boolean;
  /** Border color for the desktop card (uses colors.border in caller). */
  borderColor?: string;
  /** Card background (typically colors.surface). Required for desktop card. */
  cardBackground?: string;
  /** Animation type override (default: slide). */
  animationType?: 'none' | 'slide' | 'fade';
  /** Override sheet content style (e.g. for non-rounded full sheets). */
  sheetStyle?: ViewStyle;
  /** If false, clicking the backdrop won't close (e.g. for required dialogs). */
  closeOnBackdropPress?: boolean;
}

export const WebModal: React.FC<WebModalProps> = ({
  visible,
  onClose,
  children,
  maxWidth = 720,
  fullHeight = false,
  borderColor = '#E5E7EB',
  cardBackground = '#FFFFFF',
  animationType = 'slide',
  sheetStyle,
  closeOnBackdropPress = true,
}) => {
  const { isDesktop } = useResponsive();
  const desktopMode = Platform.OS === 'web' && isDesktop;

  return (
    <Modal
      visible={visible}
      animationType={desktopMode ? 'fade' : animationType}
      transparent
      presentationStyle={Platform.OS === 'web' ? 'overFullScreen' : undefined}
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.overlay,
          desktopMode && styles.overlayDesktop,
        ]}
        // backdrop click → close (desktop only — mobile uses sheet swipe / close icon)
        // eslint-disable-next-line react-native/no-inline-styles
        onStartShouldSetResponder={desktopMode && closeOnBackdropPress ? () => true : undefined}
        onResponderRelease={
          desktopMode && closeOnBackdropPress
            ? (e: any) => {
                // Only close when user clicks the backdrop itself (not the card)
                if (e?.target === e?.currentTarget) onClose?.();
              }
            : undefined
        }
      >
        <View
          style={[
            desktopMode
              ? [
                  styles.cardDesktop,
                  {
                    maxWidth,
                    height: fullHeight ? '92%' : undefined,
                    maxHeight: fullHeight ? '92%' : '88%',
                    backgroundColor: cardBackground,
                    borderColor,
                  },
                ]
              : styles.cardSheet,
            sheetStyle,
          ]}
        >
          {children}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  overlayDesktop: {
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  cardSheet: {
    flex: 1,
    maxHeight: '90%',
  },
  cardDesktop: {
    width: '95%',
    flex: 0,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 30,
    elevation: 24,
  },
});

export default WebModal;
