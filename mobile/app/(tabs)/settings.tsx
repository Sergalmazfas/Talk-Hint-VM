import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { useAppStore, Language } from '../../store/appStore';
import { wsClient } from '../../services/websocket';

const LANGUAGES: { code: Language; label: string; flag: string }[] = [
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
];

export default function SettingsScreen() {
  const serverUrl = useAppStore((s) => s.serverUrl);
  const language = useAppStore((s) => s.language);
  const setServerUrl = useAppStore((s) => s.setServerUrl);
  const setLanguage = useAppStore((s) => s.setLanguage);

  const [urlInput, setUrlInput] = useState(serverUrl);

  function saveServer() {
    const url = urlInput.trim().replace(/\/$/, '');
    if (!url.startsWith('http')) {
      Alert.alert('Invalid URL', 'Server URL must start with http:// or https://');
      return;
    }
    setServerUrl(url);
    wsClient.connect(url);
    Alert.alert('Saved', 'Connected to server: ' + url);
  }

  function changeLanguage(lang: Language) {
    setLanguage(lang);
    wsClient.send({ type: 'set_language', language: lang });
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>BACKEND SERVER</Text>
          <Text style={styles.sectionDesc}>
            Enter the URL of your TalkHint server (Replit deployment URL)
          </Text>
          <TextInput
            style={styles.input}
            value={urlInput}
            onChangeText={setUrlInput}
            placeholder="https://your-app.replit.app"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TouchableOpacity style={styles.saveBtn} onPress={saveServer}>
            <Text style={styles.saveBtnText}>Connect to Server</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>HINT LANGUAGE</Text>
          <Text style={styles.sectionDesc}>
            Language for translations and suggestions
          </Text>
          <View style={styles.langRow}>
            {LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.langBtn,
                  language === lang.code && styles.langBtnActive,
                ]}
                onPress={() => changeLanguage(lang.code)}
              >
                <Text style={styles.langFlag}>{lang.flag}</Text>
                <Text
                  style={[
                    styles.langLabel,
                    language === lang.code && styles.langLabelActive,
                  ]}
                >
                  {lang.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ABOUT</Text>
          <Text style={styles.about}>
            TalkHint v2.0{'\n'}
            Real-time AI call assistant{'\n'}
            Backend: TalkHint Cloud
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20, gap: 24 },
  section: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  sectionDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 14,
    lineHeight: 18,
  },
  input: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 13,
    color: Colors.textPrimary,
    fontSize: 14,
    marginBottom: 12,
  },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    padding: 13,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  langRow: { flexDirection: 'row', gap: 12 },
  langBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  langBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryGlow,
  },
  langFlag: { fontSize: 20 },
  langLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  langLabelActive: { color: Colors.primary },
  about: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
});
