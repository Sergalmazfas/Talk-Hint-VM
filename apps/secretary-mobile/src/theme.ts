import { Platform } from 'react-native';

export const colors = {
  canvas: '#F2F1F6',
  card: '#FFFFFF',
  ink: '#17171C',
  muted: '#777985',
  line: '#E8E7ED',
  blue: '#3978E8',
  bluePale: '#EAF1FF',
  green: '#2D9B69',
  greenPale: '#E8F6EF',
  amber: '#A66A12',
  amberPale: '#FFF3DE',
  red: '#C64C4C',
};

export const space = (n: number) => n * 8;
export const shadow = Platform.select({
  ios: { shadowColor: '#35334A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } },
  android: { elevation: 2 },
  default: {},
});
