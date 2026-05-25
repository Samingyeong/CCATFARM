import { useEffect, useState } from 'react'
import type { UseRosReturn } from './useRos'
import { TOPICS } from '../config/rosTopics'

declare const ROSLIB: typeof import('roslib')

export interface BatteryData {
  percentage: number   // 0~100
  voltage: number      // V
  current: number      // A
  isCharging: boolean
}

export function useBattery(
  ros: UseRosReturn['ros'],
  status: UseRosReturn['status'],
): BatteryData | null {
  const [battery, setBattery] = useState<BatteryData | null>(null)

  useEffect(() => {
    if (!ros || status !== 'connected') return

    const topic = new ROSLIB.Topic({
      ros,
      name: TOPICS.BATTERY_STATE.name,
      messageType: TOPICS.BATTERY_STATE.messageType,
      queue_length: 1,
      throttle_rate: 1000,
    } as any)

    topic.subscribe((msg: any) => {
      setBattery({
        percentage: Math.round((msg.percentage ?? 0) * 100),
        voltage: msg.voltage ?? 0,
        current: msg.current ?? 0,
        // power_supply_status: 1=charging
        isCharging: msg.power_supply_status === 1,
      })
    })

    return () => topic.unsubscribe()
  }, [ros, status])

  return battery
}
