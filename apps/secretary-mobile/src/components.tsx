import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewProps, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, shadow, space } from './theme';

export function Page({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.page, style]}>{children}</View>;
}
export function ScrollPage({ children, style, ...props }: Omit<ScrollViewProps, 'children' | 'contentContainerStyle'> & { children: React.ReactNode; style?: ViewStyle }) {
  return <ScrollView keyboardShouldPersistTaps="handled" {...props}
    contentContainerStyle={[styles.scrollPage, { width: '100%', maxWidth: 760, alignSelf: 'center' }, style]}>{children}</ScrollView>;
}
export function Surface({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.surface, style]}>{children}</View>;
}
export function Heading({ children, eyebrow }: { children: React.ReactNode; eyebrow?: string }) {
  return <View style={styles.heading}>
    {eyebrow ? <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
    <Text style={styles.title}>{children}</Text>
  </View>;
}
export function Body({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[styles.body, style]}>{children}</Text>;
}
export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}
export function Field({ label, style, ...props }: TextInputProps & { label?: string; style?: object }) {
  return <View style={{ gap: 7 }}>
    {label ? <Label>{label}</Label> : null}
    <TextInput placeholderTextColor={colors.muted} {...props}
      style={[styles.field, props.multiline && styles.multiline, style]} />
  </View>;
}
export function Button({ title, onPress, tone = 'blue', disabled = false, loading = false, compact = false }: {
  title: string; onPress: () => void; tone?: 'blue' | 'green' | 'quiet' | 'danger'; disabled?: boolean; loading?: boolean; compact?: boolean;
}) {
  const bg = tone === 'green' ? colors.green : tone === 'quiet' ? colors.bluePale : tone === 'danger' ? '#FCECEC' : colors.blue;
  const fg = tone === 'quiet' ? colors.blue : tone === 'danger' ? colors.red : '#FFFFFF';
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || loading}
    style={({ pressed }) => [styles.button, compact && styles.buttonCompact, { backgroundColor: bg },
      (disabled || loading) && { opacity: 0.54 }, pressed && { transform: [{ scale: 0.985 }], opacity: 0.88 }]}>
    {loading ? <ActivityIndicator size="small" color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
  </Pressable>;
}
export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10 }, style]}>{children}</View>;
}
export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <Surface style={styles.errorBox}>
    <Text style={{ color: colors.red, fontWeight: '700', fontSize: 15 }}>Couldn’t load this yet</Text>
    <Body style={{ color: colors.muted }}>{message}</Body>
    {onRetry ? <Button title="Try again" onPress={onRetry} tone="quiet" compact /> : null}
  </Surface>;
}
export function LoadingRows() {
  return <View style={{ gap: 12 }}>
    {[0, 1, 2].map(i => <View key={i} style={styles.skeleton} />)}
  </View>;
}
export function Pill({ children, tone = 'blue' }: { children: React.ReactNode; tone?: 'blue' | 'green' | 'amber' }) {
  const bg = tone === 'green' ? colors.greenPale : tone === 'amber' ? colors.amberPale : colors.bluePale;
  const fg = tone === 'green' ? colors.green : tone === 'amber' ? colors.amber : colors.blue;
  return <View style={[styles.pill, { backgroundColor: bg }]}><Text style={{ color: fg, fontSize: 11, fontWeight: '800', letterSpacing: 0.7 }}>{children}</Text></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas, paddingHorizontal: space(2.25), paddingTop: 16 },
  scrollPage: { paddingHorizontal: space(2.25), paddingTop: 18, paddingBottom: 36, gap: 16 },
  surface: { backgroundColor: colors.card, borderRadius: 24, padding: 20, gap: 14, ...shadow },
  heading: { marginTop: 4, marginBottom: 4, gap: 5 },
  eyebrow: { color: colors.blue, fontSize: 11, fontFamily: 'DMSans_800ExtraBold', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 30, fontFamily: 'DMSans_700Bold', letterSpacing: -0.8 },
  body: { color: colors.ink, fontSize: 15, fontFamily: 'DMSans_400Regular', lineHeight: 22 },
  label: { color: colors.ink, fontSize: 13, fontFamily: 'DMSans_700Bold' },
  field: { backgroundColor: '#F7F7FA', borderRadius: 14, borderWidth: 1, borderColor: colors.line, color: colors.ink,
    paddingHorizontal: 15, paddingVertical: 13, fontSize: 15, minHeight: 48 },
  multiline: { minHeight: 115, textAlignVertical: 'top', paddingTop: 14 },
  button: { minHeight: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  buttonCompact: { minHeight: 39, borderRadius: 13, alignSelf: 'flex-start', paddingHorizontal: 14 },
  buttonText: { fontSize: 15, fontFamily: 'DMSans_700Bold' },
  errorBox: { borderWidth: 1, borderColor: '#F1D5D5', backgroundColor: '#FFF8F8' },
  skeleton: { height: 96, borderRadius: 22, backgroundColor: '#E8E7EE' },
  pill: { alignSelf: 'flex-start', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
});
