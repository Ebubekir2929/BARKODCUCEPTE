import React from 'react';
import { TouchableOpacity, View, StyleSheet, Animated, Easing } from 'react-native';
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
 * Modern dual scroll-to-top / scroll-to-bottom buttons.
 * - Compact pill design (instead of two large round FABs)
 * - Subtle border + shadow, dark-translucent background for contrast on any list
 * - Animated slide-in when becoming visible
 */
export const ScrollFab: React.FC<ScrollFabProps> = ({
  onUp,
  onDown,
  showUp = false,
  showDown = false,
  primaryColor,
  bottomOffset = 100,
}) => {
  const fade = React.useRef(new Animated.Value(0)).current;
  const visible = showUp || showDown;

  React.useEffect(() => {
    Animated.timing(fade, {
      toValue: visible ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [visible, fade]);

  if (!showUp && !showDown) return null;
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          bottom: bottomOffset,
          opacity: fade,
          transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        },
      ]}
    >
      <View style={[styles.pill, { backgroundColor: 'rgba(20,20,20,0.85)' }]}>
        {showUp && (
          <TouchableOpacity
            style={styles.btn}
            onPress={onUp}
            activeOpacity={0.6}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="chevron-up" size={20} color="#fff" />
          </TouchableOpacity>
        )}
        {showUp && showDown && <View style={styles.divider} />}
        {showDown && (
          <TouchableOpacity
            style={styles.btn}
            onPress={onDown}
            activeOpacity={0.6}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="chevron-down" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 12,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'column',
    borderRadius: 22,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  btn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: 8,
  },
});
