import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';
import { GoalState } from '../store/appStore';

interface Props {
  goal: string;
  goalState: GoalState | null;
  isAchieved: boolean;
}

export function GoalBanner({ goal, goalState, isAchieved }: Props) {
  if (!goal) return null;

  return (
    <View style={[styles.container, isAchieved && styles.achievedContainer]}>
      <View style={styles.row}>
        <Text style={styles.label}>{isAchieved ? '✓ GOAL ACHIEVED' : 'GOAL'}</Text>
        {goalState && (
          <Text style={styles.status}>
            {goalState.status === 'achieved' ? '✓' : goalState.status === 'in_progress' ? '⟳' : '○'}
          </Text>
        )}
      </View>
      <Text style={[styles.goalText, isAchieved && styles.achievedText]} numberOfLines={2}>
        {goal}
      </Text>
      {goalState?.missingSlots && goalState.missingSlots.length > 0 && !isAchieved && (
        <Text style={styles.missing}>
          Missing: {goalState.missingSlots.join(', ')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 10,
    padding: 10,
    marginHorizontal: 12,
    marginBottom: 8,
  },
  achievedContainer: {
    borderColor: Colors.success,
    backgroundColor: Colors.successGlow,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 1.2,
  },
  status: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  goalText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  achievedText: {
    color: Colors.success,
  },
  missing: {
    marginTop: 4,
    fontSize: 11,
    color: Colors.warning,
  },
});
