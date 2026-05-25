import { useEffect, useState } from 'react'
import type { UseRosReturn } from './useRos'
import { TOPICS } from '../config/rosTopics'

declare const ROSLIB: typeof import('roslib')

export interface DiagnosticItem {
  name: string
  level: number  // 0=OK, 1=WARN, 2=ERROR, 3=STALE
  message: string
  timestamp: number
}

/**
 * /diagnostics 구독 → 에러/경고만 필터링해서 반환
 */
export function useDiagnostics(
  ros: UseRosReturn['ros'],
  status: UseRosReturn['status'],
  maxItems = 10,
): DiagnosticItem[] {
  const [items, setItems] = useState<DiagnosticItem[]>([])

  useEffect(() => {
    if (!ros || status !== 'connected') return

    const topic = new ROSLIB.Topic({
      ros,
      name: TOPICS.DIAGNOSTICS.name,
      messageType: TOPICS.DIAGNOSTICS.messageType,
      queue_length: 1,
      throttle_rate: 1000,
    } as any)

    topic.subscribe((msg: any) => {
      const now = Date.now()
      const newItems: DiagnosticItem[] = (msg.status ?? [])
        .filter((s: any) => s.level > 0) // WARN 이상만
        .map((s: any) => ({
          name: s.name,
          level: s.level,
          message: s.message,
          timestamp: now,
        }))

      if (newItems.length > 0) {
        setItems((prev) => [...newItems, ...prev].slice(0, maxItems))
      }
    })

    return () => topic.unsubscribe()
  }, [ros, status, maxItems])

  return items
}
