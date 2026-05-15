import React, { useEffect, useRef } from 'react';
import { TouchableOpacity, StyleSheet, Animated, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

interface Props {
  isActive: boolean;
  onPress: () => void;
  disabled?: boolean;
}

export function MicButton({ isActive, onPress, disabled }: Props) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  // Using any to avoid strict typing issues with Animated.CompositeAnimation across RN versions
  const pulseLoopRef = useRef<any>(null);

  useEffect(() => {
    if (isActive) {
      pulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.35,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 700,
            useNativeDriver: true,
          }),
        ])
      );
      pulseLoopRef.current.start();
    } else {
      if (pulseLoopRef.current) {
        pulseLoopRef.current.stop();
        pulseLoopRef.current = null;
      }
      Animated.timing(pulseAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  return (
    <View style={styles.wrapper}>
      {isActive && (
        <Animated.View
          style={[styles.pulse, { transform: [{ scale: pulseAnim }] }]}
        />
      )}
      <TouchableOpacity
        style={[
          styles.btn,
          isActive ? styles.btnActive : styles.btnIdle,
          disabled === true && styles.btnDisabled,
        ]}
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.8}
      >
        <Ionicons
          name={isActive ? 'mic' : 'mic-outline'}
          size={28}
          color={isActive ? '#fff' : Colors.textSecondary}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 72,
    height: 72,
  },
  pulse: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.micActive,
  },
  btn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnIdle: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  btnActive: {
    backgroundColor: Colors.mic,
  },
  btnDisabled: {
    opacity: 0.4,
  },
});
