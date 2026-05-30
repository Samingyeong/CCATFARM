/**
 * 로봇 순회 이력 관리
 * 로봇이 Zone을 이동할 때마다 자동으로 기록
 */

const HISTORY_KEY = 'ccatfarm_patrol_history'

export interface PatrolRecord {
  zone: string
  enteredAt: number // timestamp
}

export interface PatrolSession {
  startedAt: number
  records: PatrolRecord[]
}

const MAX_SESSIONS = 20

/** 전체 세션 이력 조회 */
export function getPatrolHistory(): PatrolSession[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY)
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }
  return []
}

/** 새 세션 시작 */
export function startNewSession(): PatrolSession {
  const session: PatrolSession = { startedAt: Date.now(), records: [] }
  const history = getPatrolHistory()
  history.unshift(session)
  // 최대 세션 수 제한
  if (history.length > MAX_SESSIONS) history.length = MAX_SESSIONS
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  return session
}

/** 현재 세션(가장 최근)에 Zone 진입 기록 추가 */
export function recordZoneEntry(zone: string): void {
  const history = getPatrolHistory()
  if (history.length === 0) {
    // 세션이 없으면 새로 시작
    const session = startNewSession()
    session.records.push({ zone, enteredAt: Date.now() })
    history[0] = session
  } else {
    const current = history[0]
    // 같은 Zone 연속 기록 방지
    const last = current.records[current.records.length - 1]
    if (last && last.zone === zone) return
    current.records.push({ zone, enteredAt: Date.now() })
  }
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
}

/** 현재 세션의 Zone 이동 순서만 반환 (맵 경로 표시용) */
export function getCurrentSessionRoute(): string[] {
  const history = getPatrolHistory()
  if (history.length === 0) return []
  return history[0].records.map((r) => r.zone)
}

/** 이력 전체 삭제 */
export function clearPatrolHistory(): void {
  localStorage.removeItem(HISTORY_KEY)
}
