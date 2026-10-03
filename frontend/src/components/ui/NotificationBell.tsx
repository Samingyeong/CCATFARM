import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, AlertTriangle, CheckCircle2 } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL ?? ''
const SEEN_KEY = 'ccatfarm_notif_seen_id' // 마지막으로 확인한 최신 detection id

// ISO 타임스탬프 → 읽기 쉬운 짧은 형식 (예: 09.05 15:32)
function formatTime(ts?: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

interface NotiItem {
  id: number
  zone: string
  status: string
  overall?: string
  camera?: string
  analyzed_at?: string
  capturedAt?: string
}

/**
 * 알림 벨 — 이상(Abnormal) 감지 결과를 알림으로 표시.
 * - 안 읽은 알림 수를 작은 숫자 배지로 표시
 * - 클릭 시 드롭다운: 데이터 있으면 목록, 없으면 "데이터 없음" 빈 상태
 * - 열면 현재 최신 id를 '읽음'으로 저장하여 배지 초기화
 */
export default function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotiItem[]>([])
  const [seenId, setSeenId] = useState<number>(() => {
    const v = Number(localStorage.getItem(SEEN_KEY))
    return Number.isFinite(v) ? v : 0
  })
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/crops?status=Abnormal&limit=20`)
      const data = await res.json()
      setItems((data.crops || []).filter((c: any) => typeof c.id === 'number'))
    } catch {
      /* 백엔드 미연결 시 조용히 무시 */
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])

  // 바깥 클릭 시 닫기
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const latestId = items.length > 0 ? Math.max(...items.map((i) => i.id)) : 0
  const unread = items.filter((i) => i.id > seenId).length

  const handleToggle = () => {
    const next = !open
    setOpen(next)
    if (next && latestId > seenId) {
      setSeenId(latestId)
      localStorage.setItem(SEEN_KEY, String(latestId))
    }
  }

  return (
    <div className="notif-wrap" ref={ref}>
      <button className="header-bell" onClick={handleToggle} aria-label="알림">
        <Bell size={18} />
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-head">
            <span>알림</span>
            {items.length > 0 && <span className="notif-count">{items.length}건</span>}
          </div>

          {items.length === 0 ? (
            <div className="notif-empty">
              <div className="notif-empty-icon"><CheckCircle2 size={22} /></div>
              <p className="notif-empty-title">데이터가 없습니다</p>
              <p className="notif-empty-desc">새 이상 감지가 들어오면 여기에 표시됩니다</p>
            </div>
          ) : (
            <div className="notif-list">
              {items.slice(0, 8).map((it) => (
                <div
                  key={it.id}
                  className={`notif-item ${it.id > seenId ? 'unread' : ''}`}
                  onClick={() => { setOpen(false); navigate('/crops', { state: { detailId: it.id } }) }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="notif-item-icon"><AlertTriangle size={15} /></div>
                  <div className="notif-item-body">
                    <div className="notif-item-title">
                      {it.zone} 이상 감지
                      {it.camera && <span className="notif-cam">{it.camera}</span>}
                    </div>
                    <div className="notif-item-desc">{it.overall || '이상 작물이 감지되었습니다'}</div>
                    {(it.capturedAt || it.analyzed_at) && (
                      <div className="notif-item-time">{formatTime(it.capturedAt || it.analyzed_at)}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
