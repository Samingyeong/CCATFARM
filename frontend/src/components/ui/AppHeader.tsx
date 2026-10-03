import type { ReactNode } from 'react'
import NotificationBell from './NotificationBell'

interface AppHeaderProps {
  title: string
  subtitle?: string
  right?: ReactNode
  showBell?: boolean
}

/** 모든 페이지 상단 공통 헤더: 큰 제목 → 보조 설명, 우측 액션 */
export default function AppHeader({ title, subtitle, right, showBell = true }: AppHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {right}
        {showBell && <NotificationBell />}
      </div>
    </header>
  )
}
