import { useState } from 'react'
import { Bell, User, Trash2, Clock, LogOut } from 'lucide-react'
import { getPatrolHistory, clearPatrolHistory, type PatrolSession } from '../utils/patrolStorage'
import { getUser } from '../utils/auth'

interface SettingsProps {
  onLogout: () => void
}

export default function Settings({ onLogout }: SettingsProps) {
  const [history, setHistory] = useState<PatrolSession[]>(() => getPatrolHistory())
  const user = getUser()

  const handleClear = () => {
    if (confirm('순회 이력을 모두 삭제하시겠습니까?')) {
      clearPatrolHistory()
      setHistory([])
    }
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleString('ko-KR', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const formatDuration = (session: PatrolSession) => {
    if (session.records.length < 2) return '--'
    const start = session.records[0].enteredAt
    const end = session.records[session.records.length - 1].enteredAt
    const mins = Math.round((end - start) / 60000)
    return mins < 1 ? '< 1분' : `${mins}분`
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Settings</h1>
        <Bell size={20} className="header-icon" />
      </header>

      <div className="page-content">
        {/* Avatar & User Info */}
        <div className="settings-avatar">
          <div className="avatar-circle">
            <User size={48} color="#6b7280" />
          </div>
        </div>
        {user && (
          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4 }}>
            {user.name || user.username}
          </p>
        )}
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <button className="logout-btn" onClick={onLogout}>
            <LogOut size={13} /> 로그아웃
          </button>
        </div>

        {/* Form Fields */}
        <div className="settings-form">
          {[
            { label: 'USER NAME', type: 'text', placeholder: '' },
            { label: 'EMAIL ADDRESS', type: 'email', placeholder: '' },
            { label: 'PHONE NUMBER', type: 'tel', placeholder: '🇰🇷 82 +' },
            { label: 'FARM ADDRESS', type: 'text', placeholder: '' },
          ].map((field) => (
            <div key={field.label} className="form-group">
              <label className="form-label">{field.label}</label>
              <input className="form-input" type={field.type} placeholder={field.placeholder} />
            </div>
          ))}
        </div>

        {/* Patrol History */}
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p className="card-label" style={{ margin: 0 }}>PATROL HISTORY (순회 이력)</p>
            {history.length > 0 && (
              <button className="patrol-clear-btn" onClick={handleClear}>
                <Trash2 size={12} /> 전체 삭제
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
              아직 순회 이력이 없습니다.<br />로봇이 Zone을 이동하면 자동으로 기록됩니다.
            </p>
          ) : (
            <div className="patrol-history-list">
              {history.map((session, idx) => (
                <div key={session.startedAt} className="patrol-session-card">
                  <div className="patrol-session-header">
                    <Clock size={12} />
                    <span>{formatTime(session.startedAt)}</span>
                    <span className="patrol-session-duration">{formatDuration(session)}</span>
                    {idx === 0 && <span className="patrol-session-live">LIVE</span>}
                  </div>
                  <div className="patrol-session-route">
                    {session.records.length === 0 ? (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>대기 중...</span>
                    ) : (
                      session.records.map((rec, i) => (
                        <span key={i} className="patrol-zone-chip">
                          {i > 0 && <span className="patrol-arrow">→</span>}
                          {rec.zone}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
