import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MapPin, BatteryCharging, Battery, Play, Home as HomeIcon, OctagonAlert,
  WifiOff, AlertTriangle, Hand, Activity, CalendarClock, ChevronRight, CheckCircle2,
} from 'lucide-react'
import { useRos } from '../hooks/useRos'
import { useBattery } from '../hooks/useBattery'
import { useDiagnostics } from '../hooks/useDiagnostics'
import { useRobotCommand } from '../hooks/useRobotCommand'
import { useDriveManagerStatus } from '../hooks/useDriveManagerStatus'
import { TOPICS } from '../config/rosTopics'
import { getZoneName, ZONES } from '../utils/zoneMap'
import AppHeader from '../components/ui/AppHeader'
import DashboardCard from '../components/ui/DashboardCard'
import StatusBadge, { connectionTone } from '../components/ui/StatusBadge'
import CropHealthDonut from '../components/ui/CropHealthDonut'
import AlertItem, { type AlertLevel } from '../components/ui/AlertItem'

declare const ROSLIB: typeof import('roslib')

const API_BASE = import.meta.env.VITE_API_URL ?? ''

interface ZoneSummary {
  zone: string
  total: number
  normal: number
  abnormal: number
  image_count: number
}

interface RobotState {
  zone: string
  x: number
  y: number
  isRunning: boolean
}

interface AlertEntry {
  level: AlertLevel
  icon: React.ReactNode
  title: string
  desc?: string
  time?: string
}

const ZONE_COLORS = ['#43C04A', '#6FD173', '#E7A23B', '#5B8DEF', '#8BD98F', '#C7A33B']

export default function Home() {
  const navigate = useNavigate()
  const { ros, status } = useRos()
  const battery = useBattery(ros, status)
  const diagnostics = useDiagnostics(ros, status, 5)
  const driveManager = useDriveManagerStatus(ros, status)
  const publishRobotCommand = useRobotCommand(ros, status, driveManager.teleopActive)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [robot, setRobot] = useState<RobotState>({ zone: '---', x: 0, y: 0, isRunning: false })
  const [zoneSummary, setZoneSummary] = useState<ZoneSummary[]>([])

  // zone별 집계 (총/정상/이상) 로드 — /api/zones/summary
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/zones/summary`)
        const data = await res.json()
        if (!cancelled) setZoneSummary(data.zones || [])
      } catch (e) {
        console.error('zone 집계 조회 실패:', e)
      }
    }
    load()
    const t = setInterval(load, 10000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  const totals = zoneSummary.reduce(
    (acc, z) => { acc.total += z.total; acc.normal += z.normal; acc.abnormal += z.abnormal; return acc },
    { total: 0, normal: 0, abnormal: 0 }
  )

  // drive_manager의 통합 /robot_pose 구독 → Zone 판별
  useEffect(() => {
    if (!ros || status !== 'connected') return
    const poseTopic = new ROSLIB.Topic({
      ros,
      name: TOPICS.ROBOT_POSE.name,
      messageType: TOPICS.ROBOT_POSE.messageType,
      throttle_rate: 100,
      queue_length: 1,
    } as any)
    poseTopic.subscribe((message: any) => {
      const pos = message.pose?.pose?.position
      if (pos) {
        const zone = getZoneName(pos.x, pos.y)
        setRobot({ x: pos.x, y: pos.y, zone, isRunning: true })
      }
    })
    return () => poseTopic.unsubscribe()
  }, [ros, status])

  const connected = status === 'connected'
  const missionCommandEnabled = connected && driveManager.teleopActive === false
  const batteryLow = !!battery && battery.percentage <= 20
  const conn = connectionTone(status)

  const sendMissionCommand = (command: 'START' | 'HOME') => {
    setCommandError(null)
    if (!publishRobotCommand(command)) {
      setCommandError('수동 조종 해제(active=false)를 확인한 뒤 실행할 수 있습니다.')
    }
  }

  // ── 알림 수집 (아이콘 + 제목 + 설명 + 시간 구조) ──
  const alerts: AlertEntry[] = []
  if (!connected) alerts.push({ level: 'critical', icon: <WifiOff size={18} />, title: 'Connection Lost', desc: '로봇 연결이 끊겼습니다 — rosbridge 확인 필요', time: 'now' })
  if (commandError) alerts.push({ level: 'warning', icon: <AlertTriangle size={18} />, title: 'Command Blocked', desc: commandError })
  if (driveManager.teleopActive) alerts.push({ level: 'warning', icon: <Hand size={18} />, title: 'Manual Control Active', desc: 'START/HOME이 잠겨 있습니다' })
  if (driveManager.teleopStatus?.startsWith('ERROR')) alerts.push({ level: 'critical', icon: <AlertTriangle size={18} />, title: 'Teleop Error', desc: driveManager.teleopStatus })
  if (batteryLow) alerts.push({ level: 'critical', icon: <Battery size={18} />, title: 'Low Battery', desc: `배터리 ${battery!.percentage}% — 충전이 필요합니다` })
  diagnostics.forEach((d) => alerts.push({
    level: d.level >= 2 ? 'critical' : 'warning',
    icon: <Activity size={18} />,
    title: d.name,
    desc: d.message,
  }))
  if (connected) alerts.push({ level: 'info', icon: <Activity size={18} />, title: 'System Telemetry', desc: `위치: ${driveManager.robotPoseSource} · TELEOP: ${driveManager.teleopStatus}` })

  const visibleAlerts = alerts.slice(0, 3)

  // zone 목록: 집계가 있으면 집계, 없으면 기본 zone 안내
  const zoneRows = zoneSummary.length > 0
    ? zoneSummary.map((z, i) => ({ name: z.zone, normal: z.normal, abnormal: z.abnormal, color: ZONE_COLORS[i % ZONE_COLORS.length], hasData: true }))
    : (ZONES.length > 0 ? ZONES : [{ name: 'Zone A', color: '#43C04A' } as any, { name: 'Zone B', color: '#6FD173' } as any])
        .map((z: any) => ({ name: z.name, normal: 0, abnormal: 0, color: z.color, hasData: false }))

  return (
    <div className="page">
      <AppHeader
        title="Smart Farm"
        subtitle="Today's Overview"
        right={<StatusBadge tone={conn.tone} label={conn.label} />}
      />

      <div className="page-content">
        {/* 01. Robot Control */}
        <DashboardCard label="Robot Control">
          <div className="robot-card-top">
            <span className="robot-zone-pill"><MapPin size={14} />{robot.zone}</span>
            <StatusBadge
              tone={connected ? (robot.isRunning ? 'success' : 'primary') : 'neutral'}
              label={connected ? driveManager.robotStatus : 'OFFLINE'}
            />
          </div>

          <div className="battery-block">
            <span className={`battery-pct ${batteryLow ? 'low' : ''}`}>
              {battery ? `${battery.percentage}%` : '--'}
            </span>
            <div className="battery-meta">
              <span className="battery-volt">{battery ? `${battery.voltage.toFixed(1)} V` : 'Battery Power'}</span>
              <span className={`battery-state ${battery?.isCharging ? 'charging' : batteryLow ? 'low' : ''}`}>
                {battery?.isCharging
                  ? <><BatteryCharging size={12} style={{ verticalAlign: -2 }} /> Charging</>
                  : batteryLow ? 'Low Battery' : 'Normal'}
              </span>
            </div>
          </div>

          <div className="battery-track">
            <div
              className="battery-fill"
              style={{
                width: battery ? `${battery.percentage}%` : '0%',
                background: batteryLow ? 'var(--danger)' : battery?.isCharging ? 'var(--success)' : 'var(--primary)',
              }}
            />
          </div>

          <div className="robot-actions">
            <button className="btn btn-primary" onClick={() => sendMissionCommand('START')} disabled={!missionCommandEnabled}>
              <Play size={15} /> START
            </button>
            <button className="btn btn-secondary" onClick={() => sendMissionCommand('HOME')} disabled={!missionCommandEnabled}>
              <HomeIcon size={15} /> HOME
            </button>
            <button
              className="btn btn-danger-outline"
              onClick={() => publishRobotCommand('ESTOP')}
              disabled={!connected}
              aria-label="EMERGENCY"
              title="EMERGENCY STOP"
            >
              <OctagonAlert size={18} />
            </button>
          </div>
        </DashboardCard>

        {/* 02. Alerts */}
        <DashboardCard
          label="Alerts"
          action={alerts.length > 0 ? <button className="card-link">View all <ChevronRight size={13} /></button> : undefined}
        >
          {visibleAlerts.length > 0 ? (
            <div className="alert-list">
              {visibleAlerts.map((a, i) => (
                <AlertItem key={i} level={a.level} icon={a.icon} title={a.title} desc={a.desc} time={a.time} />
              ))}
            </div>
          ) : (
            <div className="alert-empty">
              <div className="alert-empty-icon"><CheckCircle2 size={24} /></div>
              <div className="alert-empty-title">Everything looks good</div>
              <div className="alert-empty-desc">No active alerts</div>
            </div>
          )}
        </DashboardCard>

        {/* 03. Overall Crop Health */}
        <DashboardCard
          label="Overall Crop Health"
          action={
            <button className="card-link" onClick={() => navigate('/crops')} aria-label="작물 전체 보기">
              <ChevronRight size={18} color="var(--text-muted)" />
            </button>
          }
        >
          <div className="crop-health">
            <CropHealthDonut normal={totals.normal} abnormal={totals.abnormal} />
            <div className="health-summary">
              <div className="health-stat">
                <span className="legend-dot green" />
                <span className="health-stat-num">{totals.normal}</span>
                <span className="health-stat-label">Healthy</span>
              </div>
              <div className="health-stat">
                <span className="legend-dot red" />
                <span className="health-stat-num">{totals.abnormal}</span>
                <span className="health-stat-label">Abnormal</span>
              </div>
            </div>
          </div>

          <div className="zone-list">
            {zoneRows.map((z, i) => (
              <div key={i} className="zone-row" onClick={() => navigate('/crops', { state: { zone: z.name } })}>
                <span className="zone-dot" style={{ background: z.abnormal > 0 ? 'var(--danger)' : z.color }} />
                <span className={`zone-name ${robot.zone === z.name ? 'active-robot' : ''}`}>
                  {z.name}{robot.zone === z.name && ' · 로봇 위치'}
                </span>
                <span className="zone-counts">
                  {z.hasData
                    ? <><span className="n-normal">{z.normal} Healthy</span> · <span className="n-abnormal">{z.abnormal} Abnormal</span></>
                    : <span style={{ color: 'var(--text-muted)' }}>데이터 없음</span>}
                </span>
                <ChevronRight size={14} color="var(--text-muted)" />
              </div>
            ))}
          </div>
        </DashboardCard>

        {/* 04. Scheduling Info — 스케줄 API 미연동, 빈 상태 표시 */}
        <DashboardCard label="Scheduling Info">
          <div className="schedule-empty">
            <div className="schedule-empty-icon"><CalendarClock size={24} /></div>
            <p>예정된 순찰이 없습니다</p>
          </div>
        </DashboardCard>
      </div>
    </div>
  )
}
