import type { ReactNode } from 'react'

export type AlertLevel = 'critical' | 'warning' | 'info' | 'success'

interface AlertItemProps {
  level: AlertLevel
  icon: ReactNode
  title: string
  desc?: string
  time?: string
}

/** 아이콘 + 제목 + 설명 + 시간 구조의 알림 list item */
export default function AlertItem({ level, icon, title, desc, time }: AlertItemProps) {
  return (
    <div className="alert-item">
      <div className={`alert-icon ${level}`}>{icon}</div>
      <div className="alert-body">
        <div className="alert-title">{title}</div>
        {desc && <div className="alert-desc">{desc}</div>}
      </div>
      {time && <span className="alert-time">{time}</span>}
    </div>
  )
}
