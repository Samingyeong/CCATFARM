import type { ReactNode } from 'react'

interface DashboardCardProps {
  label?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}

/** 라벨 + 우측 액션(View all 등)을 가진 공통 대시보드 카드 */
export default function DashboardCard({ label, action, children, className = '' }: DashboardCardProps) {
  return (
    <section className={`card ${className}`}>
      {(label || action) && (
        <div className="card-header-row">
          {label && <p className="card-label" style={{ margin: 0 }}>{label}</p>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}
