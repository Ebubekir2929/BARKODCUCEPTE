import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../store/themeStore';

type AlertType = 'success' | 'error' | 'warning' | 'info';

interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface CustomAlertProps {
  visible: boolean;
  type?: AlertType;
  title: string;
  message?: string;
  buttons?: AlertButton[];
  onClose: () => void;
}

const alertConfig = {
  success: {
    icon: 'checkmark-circle' as const,
    gradient: ['#10B981', '#059669'],
  },
  error: {
    icon: 'close-circle' as const,
    gradient: ['#EF4444', '#DC2626'],
  },
  warning: {
    icon: 'warning' as const,
    gradient: ['#F59E0B', '#D97706'],
  },
  info: {
    icon: 'information-circle' as const,
    gradient: ['#3B82F6', '#2563EB'],
  },
};

export const CustomAlert: React.FC<CustomAlertProps> = ({
  visible,
  type = 'info',
  title,
  message,
  buttons = [{ text: 'Tamam', style: 'default' }],
  onClose,
}) => {
  const { colors } = useThemeStore();
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const iconScaleAnim = useRef(new Animated.Value(0)).current;

  const config = alertConfig[type];

  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(0);
      opacityAnim.setValue(0);
      iconScaleAnim.setValue(0);

      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 100,
          friction: 8,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        Animated.spring(iconScaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 150,
          friction: 5,
        }).start();
      });
    }
  }, [visible]);

  const handleButtonPress = (button: AlertButton) => {
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0.8,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      button.onPress?.();
      onClose();
    });
  };

  const getButtonStyle = (style?: AlertButton['style']) => {
    switch (style) {
      case 'destructive':
        return { backgroundColor: colors.error };
      case 'cancel':
        return { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border };
      default:
        return { backgroundColor: config.gradient[0] };
    }
  };

  const getButtonTextStyle = (style?: AlertButton['style']) => {
    switch (style) {
      case 'cancel':
        return { color: colors.text };
      default:
        return { color: '#FFFFFF' };
    }
  };

  return (
    <Modal visible={visible} transparent animationType="none">
      <Animated.View style={[styles.overlay, { opacity: opacityAnim }]}>
        <Animated.View
          style={[
            styles.container,
            { 
              backgroundColor: colors.surface,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          <Animated.View
            style={[
              styles.iconCircle,
              { 
                backgroundColor: config.gradient[0],
                transform: [{ scale: iconScaleAnim }],
              },
            ]}
          >
            <View style={[styles.iconInner, { backgroundColor: config.gradient[1] }]}>
              <Ionicons name={config.icon} size={40} color="#FFFFFF" />
            </View>
          </Animated.View>

          <View style={styles.content}>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            {message && (
              <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
            )}
          </View>

          <View style={styles.buttonContainer}>
            {buttons.map((button, index) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.button,
                  getButtonStyle(button.style),
                  buttons.length > 1 && { flex: 1 },
                ]}
                onPress={() => handleButtonPress(button)}
                activeOpacity={0.8}
              >
                <Text style={[styles.buttonText, getButtonTextStyle(button.style)]}>
                  {button.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

// Hook for easy usage
interface AlertState {
  visible: boolean;
  type: AlertType;
  title: string;
  message?: string;
  buttons?: AlertButton[];
}

export const useAlert = () => {
  const [alertState, setAlertState] = useState<AlertState>({
    visible: false,
    type: 'info',
    title: '',
  });

  const showAlert = useCallback((
    title: string,
    message?: string,
    buttons?: AlertButton[],
    type: AlertType = 'info'
  ) => {
    setAlertState({
      visible: true,
      type,
      title,
      message,
      buttons: buttons || [{ text: 'Tamam', style: 'default' }],
    });
  }, []);

  const showSuccess = useCallback((title: string, message?: string, buttons?: AlertButton[]) => {
    showAlert(title, message, buttons, 'success');
  }, [showAlert]);

  const showError = useCallback((title: string, message?: string, buttons?: AlertButton[]) => {
    showAlert(title, message, buttons, 'error');
  }, [showAlert]);

  const showWarning = useCallback((title: string, message?: string, buttons?: AlertButton[]) => {
    showAlert(title, message, buttons, 'warning');
  }, [showAlert]);

  const showInfo = useCallback((title: string, message?: string, buttons?: AlertButton[]) => {
    showAlert(title, message, buttons, 'info');
  }, [showAlert]);

  const hideAlert = useCallback(() => {
    setAlertState(prev => ({ ...prev, visible: false }));
  }, []);

  return {
    showAlert,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    hideAlert,
    alertProps: {
      ...alertState,
      onClose: hideAlert,
    },
  };
};

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  container: {
    width: Math.min(width - 48, 340),
    borderRadius: 24,
    paddingTop: 50,
    paddingBottom: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  iconCircle: {
    position: 'absolute',
    top: -35,
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  iconInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export default CustomAlert;
