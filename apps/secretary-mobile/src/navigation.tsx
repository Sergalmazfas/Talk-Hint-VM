import React from 'react';
import { NavigationContainer, type NavigatorScreenParams } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from './auth';
import { SignInScreen } from './screens/SignInScreen';
import { SecretaryScreen } from './screens/SecretaryScreen';
import { CardsScreen } from './screens/CardsScreen';
import { HistoryScreen, HistoryDetailScreen } from './screens/HistoryScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { PrepareScreen } from './screens/PrepareScreen';
import { TaskDetailScreen } from './screens/TaskDetailScreen';
import { colors } from './theme';
import type { SecretaryTask } from './types';

export type TabParamList = {
  Secretary: undefined;
  Cards: undefined;
  History: undefined;
  Settings: undefined;
};
export type RootStackParamList = {
  Main: NavigatorScreenParams<TabParamList> | undefined;
  Prepare: undefined;
  TaskDetail: { taskId: string; initialTask?: SecretaryTask };
  HistoryDetail: { id: string; taskId?: string; kind?: 'call' | 'task' };
};

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function MainTabs() {
  return <Tab.Navigator screenOptions={({ route }) => ({
    headerShown: false,
    tabBarActiveTintColor: colors.blue,
    tabBarInactiveTintColor: colors.muted,
    tabBarStyle: { backgroundColor: '#FFFFFF', borderTopColor: colors.line, height: 82, paddingTop: 9, paddingBottom: 14 },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
    tabBarIcon: ({ color, size }) => {
      const icons: Record<keyof TabParamList, keyof typeof Ionicons.glyphMap> = {
        Secretary: 'sparkles-outline', Cards: 'albums-outline', History: 'time-outline', Settings: 'options-outline',
      };
      return <Ionicons name={icons[route.name]} size={size} color={color} />;
    },
  })}>
    <Tab.Screen name="Secretary" component={SecretaryScreen} />
    <Tab.Screen name="Cards" component={CardsScreen} />
    <Tab.Screen name="History" component={HistoryScreen} />
    <Tab.Screen name="Settings" component={SettingsScreen} />
  </Tab.Navigator>;
}

function AuthenticatedNavigator() {
  const { me } = useAuth();
  if (!me) return <SignInScreen />;
  return <Stack.Navigator screenOptions={{
    headerBackTitle: 'Back',
    headerTintColor: colors.blue,
    headerStyle: { backgroundColor: colors.canvas },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: colors.canvas },
  }}>
    <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
    <Stack.Screen name="Prepare" component={PrepareScreen} options={{ title: 'New test task' }} />
    <Stack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: 'Task review' }} />
    <Stack.Screen name="HistoryDetail" component={HistoryDetailScreen} options={{ title: 'History detail' }} />
  </Stack.Navigator>;
}

export function AppNavigation() {
  return <NavigationContainer>
    <AuthenticatedNavigator />
  </NavigationContainer>;
}
