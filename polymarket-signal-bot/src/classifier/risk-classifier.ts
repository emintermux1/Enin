import { RiskLevel } from '../types'

export function classifyRisk(price: number): RiskLevel {
  if (price <= 0.3) {
    return { level: 'HIGH', emoji: '🔴', color: '#FF4444' }
  }
  if (price <= 0.7) {
    return { level: 'MED', emoji: '🟡', color: '#FFB800' }
  }
  return { level: 'LOW', emoji: '🟢', color: '#00C853' }
}
