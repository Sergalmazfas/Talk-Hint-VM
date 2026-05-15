import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

interface Props {
  isConnected: boolean;
  serverUrl: string;
  isMicActive: boolean;
}

export function ConnectionStatus({ isConnected, serverUrl, isMicActive }: Props) {
  return (
    <View style={styles.container}>
      <View style={[styles.dot, isConnected ? styles.dotConnected : styles.dotDisconnected]} />
      <Text style={styles.text}>
        {isConnected
          ? isMicActive
            ? 'Listening...'
            : 'Connected'
          : serverUrl
          ? 'Connecting...'
          : 'Not configured'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: Colors.surfaceElevated,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  dotConnected: {
    backgroundColor: Colors.success,
  },
  dotDisconnected: {
    backgroundColor: Colors.textMuted,
  },
  text: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
});
