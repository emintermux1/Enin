import { RiskLevel } from '../types';

export function classifyRisk(price: number): RiskLevel {
  if (price <= 0.2) {
    return { level: 'HIGH RISK', emoji: '🔴', color: '#FF4444' };
  }
  if (price <= 0.6) {
    return { level: 'MEDIUM RISK', emoji: '🟡', color: '#FFB800' };
  }
  if (price <= 0.9) {
    return { level: 'LOW RISK', emoji: '🟢', color: '#00C853' };
  }
  return { level: 'VERY LOW RISK', emoji: '🔵', color: '#2196F3' };
}
