type Tone = 'success' | 'danger' | 'warning' | 'primary' | 'neutral'

interface StatusBadgeProps {
  tone: Tone
  label: string
  dot?: boolean
  sm?: boolean
}

/** 색상 dot + 라벨로 상태를 빠르게 인지시키는 pill badge */
export default function StatusBadge({ tone, label, dot = true, sm = false }: StatusBadgeProps) {
  return (
    <span className={`badge ${tone} ${sm ? 'badge-sm' : ''}`}>
      {dot && <span className="badge-dot" />}
      {label}
    </span>
  )
}

/** ROS 연결 상태 → badge tone/label 매핑 (모든 화면 공통) */
export function connectionTone(status: string): { tone: Tone; label: string } {
  switch (status) {
    case 'connected': return { tone: 'success', label: 'CONNECTED' }
    case 'connecting': return { tone: 'warning', label: 'CONNECTING' }
    case 'error': return { tone: 'danger', label: 'ERROR' }
    default: return { tone: 'neutral', label: 'DISCONNECTED' }
  }
}
