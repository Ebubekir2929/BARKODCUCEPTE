/**
 * AccentColorPickerModal — Tema vurgu rengini özelleştirme
 * Hue (renk tonu) + Saturation/Brightness panel + hex input + preset swatches
 *
 * iOS Crash Fix (Jun 2026):
 *  - Native <Modal> kaldırıldı, <View pointerEvents/absoluteFillObject> ile
 *    inline overlay'e geçildi (projemizdeki iOS Nested Modal Freeze pattern'ı).
 *  - reanimated-color-picker `onChange` (UI worklet → runOnJS) yerine
 *    `onChangeJS` kullanılır; iOS 18+ üzerinde worklet→JS callback'inin
 *    sebep olduğu native crash'i önler.
 *    Ref: https://github.com/alabsi91/reanimated-color-picker/issues/82
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  StatusBar,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ColorPicker, { Panel1, HueSlider, Preview } from 'reanimated-color-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeStore } from '../store/themeStore';

const PRESETS = [
  '#2563EB', '#7C3AED', '#059669', '#EA580C',
  '#DC2626', '#DB2777', '#1E40AF', '#0891B2',
  '#16A34A', '#CA8A04', '#9333EA', '#0D9488',
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function AccentColorPickerModal({ visible, onClose }: Props) {
  const { colors, accent, setAccent } = useThemeStore();
  const insets = useSafeAreaInsets();
  const [tempColor, setTempColor] = useState<string>(accent);
  const [hexInput, setHexInput] = useState<string>(accent);

  useEffect(() => {
    if (visible) {
      setTempColor(accent);
      setHexInput(accent);
    }
  }, [visible, accent]);

  // JS-thread callback — reanimated-color-picker UI worklet'ten güvenli geçiş.
  const handleColorChangeJS = ({ hex }: { hex: string }) => {
    const upper = hex.toUpperCase().substring(0, 7);
    setTempColor(upper);
    setHexInput(upper);
  };

  const handleHexSubmit = () => {
    const v = hexInput.startsWith('#') ? hexInput : `#${hexInput}`;
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
      setTempColor(v.toUpperCase());
    } else {
      setHexInput(tempColor); // revert
    }
  };

  const onSave = async () => {
    try {
      await setAccent(tempColor);
    } catch (e) {
      // sessizce devam et
    }
    onClose();
  };

  if (!visible) return null;

  return (
    <View
      style={[
        StyleSheet.absoluteFillObject,
        styles.overlay,
        { backgroundColor: 'rgba(0,0,0,0.45)', pointerEvents: 'auto' },
      ]}
    >
      {/* Backdrop tıklaması ile kapanma */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={onClose}
        style={StyleSheet.absoluteFillObject}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={onClose} style={styles.iconBtn}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.title, { color: colors.text }]}>Vurgu Rengi</Text>
            <TouchableOpacity onPress={onSave} style={styles.iconBtn}>
              <Text style={{ color: tempColor, fontWeight: '700', fontSize: 15 }}>Kaydet</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 30 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Color Picker — onChangeJS (UI worklet yerine JS-thread) */}
            <ColorPicker
              style={{ width: '100%' }}
              value={tempColor}
              onCompleteJS={handleColorChangeJS}
            >
              <Preview hideInitialColor style={{ borderRadius: 12, height: 50, marginBottom: 16 }} />
              <Panel1 style={{ borderRadius: 12, marginBottom: 16, height: 200 }} />
              <HueSlider style={{ marginBottom: 16 }} />
            </ColorPicker>

            {/* Hex Input */}
            <View style={{ marginBottom: 16 }}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>HEX Kodu</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 8,
                    backgroundColor: tempColor,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                />
                <TextInput
                  style={[
                    styles.input,
                    {
                      color: colors.text,
                      borderColor: colors.border,
                      backgroundColor: colors.background,
                      flex: 1,
                    },
                  ]}
                  value={hexInput}
                  onChangeText={setHexInput}
                  onBlur={handleHexSubmit}
                  onSubmitEditing={handleHexSubmit}
                  placeholder="#2563EB"
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={7}
                />
              </View>
            </View>

            {/* Preset Swatches */}
            <View style={{ marginBottom: 8 }}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Hazır Renkler</Text>
              <View style={styles.swatchGrid}>
                {PRESETS.map((c) => {
                  const active = tempColor.toUpperCase() === c.toUpperCase();
                  return (
                    <TouchableOpacity
                      key={c}
                      onPress={() => {
                        setTempColor(c);
                        setHexInput(c);
                      }}
                      style={[
                        styles.swatch,
                        {
                          backgroundColor: c,
                          borderColor: active ? colors.text : 'transparent',
                          borderWidth: active ? 3 : 0,
                        },
                      ]}
                    >
                      {active && <Ionicons name="checkmark" size={20} color="#FFF" />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    justifyContent: 'flex-end',
    // Status bar yüksekliği kadar üstten boşluk (Android için)
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0,
    zIndex: 9999,
    elevation: 9999,
  },
  sheetWrap: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  iconBtn: { padding: 8, minWidth: 56, alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '600',
  },
  swatchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  swatch: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
