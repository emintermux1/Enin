import { RiskLevel } from '../types';

export function classifyRisk(price: number): RiskLevel {
  if (price <= 0.30) {
    return { level: 'HIGH RISK', emoji: '🔴', color: '#FF4444' };
  }
  if (price <= 0.70) {
    return { level: 'MEDIUM RISK', emoji: '🟡', color: '#FFB800' };
  }
  return { level: 'LOW RISK', emoji: '🟢', color: '#00C853' };
}
