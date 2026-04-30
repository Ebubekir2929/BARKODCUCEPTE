import React from 'react';
import { TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ScrollFabProps {
  onUp?: () => void;
  onDown?: () => void;
  showUp?: boolean;
  showDown?: boolean;
  primaryColor: string;
  bottomOffset?: number;
}

/**
 * Reusable floating scroll-to-top / scroll-to-bottom buttons.
 * Stacked vertically on the right edge of the screen.
 */
export const ScrollFab: React.FC<ScrollFabProps> = ({
  onUp,
  onDown,
  showUp = false,
  showDown = false,
  primaryColor,
  bottomOffset = 100,
}) => {
  if (!showUp && !showDown) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: bottomOffset }]}>
      {showDown && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: primaryColor + 'CC', marginBottom: 8 }]}
          onPress={onDown}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-down" size={22} color="#fff" />
        </TouchableOpacity>
      )}
      {showUp && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: primaryColor }]}
          onPress={onUp}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-up" size={22} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 16,
    alignItems: 'center',
  },
  fab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
});
