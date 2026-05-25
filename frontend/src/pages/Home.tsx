import { useEffect, useState } from 'react'
import { Bell, ChevronRight, BatteryCharging, Battery } from 'lucide-react'
import { useRos } from '../hooks/useRos'
import { useBattery } from '../hooks/useBattery'
import { useDiagnostics } from '../hooks/useDiagnostics'
import { useRobotCommand } from '../hooks/useRobotCommand'
import { getZoneName, ZONES } from '../utils/zoneMap'

declare const ROSLIB: typeof import('roslib')

interface RobotState {
  zone: string
  x: number
  y: number
  isRunning: boolean
}

export default function Home() {
  const { ros, status } = useRos()
  const battery = useBattery(ros, status)
  const diagnostics = useDiagnostics(ros, status, 5)
  const publishRobotCommand = useRobotCommand(ros, status)
  const [robot, setRobot] = useState<RobotState>({
    zone: '---',
    x: 0,
    y: 0,
    isRunning: false,
  })

  // /amcl_pose 구독 → Zone 판별
  useEffect(() => {
    if (!ros || status !== 'connected') return

    const poseTopic = new ROSLIB.Topic({
      ros,
      name: '/amcl_pose',
      messageType: 'geometry_msgs/msg/PoseWithCovarianceStamped',
    })

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
  const batteryLow = battery && battery.percentage <= 20

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">CCATFARM ROBOT</h1>
        <Bell size={20} className="header-icon" />
      </header>

      <div className="page-content">
        {/* Robot Control Card */}
        <div className="card">
          <p className="card-label">CCATFARM ROBOT</p>
          <div className="robot-controls">
            <button className="ctrl-btn zone" style={{ fontWeight: 700 }}>
              {robot.zone}
            </button>
            <button className={`ctrl-btn ${connected && robot.isRunning ? 'running' : ''}`}>
              {connected ? (robot.isRunning ? 'RUNNING' : 'IDLE') : 'OFFLINE'}
            </button>
            <button className={`ctrl-btn off ${batteryLow ? 'battery-low' : ''}`}>
              {battery ? (
                <>
                  {battery.isCharging ? <BatteryCharging size={14} /> : <Battery size={14} />}
                  {' '}{battery.percentage}%
                </>
              ) : (
                'OFF'
              )}
              <br /><span>{battery ? `${battery.voltage.toFixed(1)}V` : 'Battery Power'}</span>
            </button>
          </div>
          <div className="progress-bar-wrap">
            <div
              className="progress-bar"
              style={{
                width: battery ? `${battery.percentage}%` : '0%',
                background: batteryLow ? '#ef4444' : battery?.isCharging ? '#22c55e' : '#3b5bdb',
              }}
            />
          </div>
          <div className="robot-actions">
            <button
              className="action-btn start"
              onClick={() => publishRobotCommand('START')}
              disabled={!connected}
            >
              START
            </button>
            <button
              className="action-btn home"
              onClick={() => publishRobotCommand('HOME')}
              disabled={!connected}
            >
              HOME
            </button>
            <button
              className="action-btn emergency"
              onClick={() => publishRobotCommand('ESTOP')}
              disabled={!connected}
            >
              EMERGENCY
            </button>
          </div>
        </div>

        {/* Alerts Card */}
        <div className="card">
          <p className="card-label">ALERTS</p>
          <div className="alert-list">
            {!connected && (
              <div className="alert-item red">
                ⚠ 로봇 연결 끊김 — rosbridge 확인 필요
              </div>
            )}
            {batteryLow && (
              <div className="alert-item red">
                🔋 배터리 부족 ({battery!.percentage}%) — 충전 필요
              </div>
            )}
            {diagnostics.map((d, i) => (
              <div key={i} className={`alert-item ${d.level >= 2 ? 'red' : 'warn'}`}>
                {d.level >= 2 ? '❌' : '⚠'} [{d.name}] {d.message}
              </div>
            ))}
            {connected && !batteryLow && diagnostics.length === 0 && (
              <div style={{ padding: '8px', fontSize: 12, color: '#22c55e' }}>
                ✓ 시스템 정상
              </div>
            )}
          </div>
        </div>

        {/* Overall Crop Health Card */}
        <div className="card">
          <div className="card-header-row">
            <p className="card-label">OVERALL CROP HEALTH</p>
            <ChevronRight size={16} />
          </div>
          <div className="crop-health">
            <div className="donut-wrap">
              <svg viewBox="0 0 80 80" width="80" height="80">
                <circle cx="40" cy="40" r="30" fill="none" stroke="#e5e7eb" strokeWidth="10" />
                <circle cx="40" cy="40" r="30" fill="none" stroke="#22c55e" strokeWidth="10"
                  strokeDasharray="120 69" strokeLinecap="round" transform="rotate(-90 40 40)" />
                <circle cx="40" cy="40" r="30" fill="none" stroke="#ef4444" strokeWidth="10"
                  strokeDasharray="30 159" strokeLinecap="round" transform="rotate(60 40 40)" />
              </svg>
              <div className="donut-label"><span className="donut-num">--</span><br />CROPS</div>
            </div>
            <div className="zone-list">
              {ZONES.map((z, i) => (
                <div key={i} className="zone-row">
                  <span className="zone-dot" style={{ background: z.color }} />
                  <span className="zone-name" style={{
                    fontWeight: robot.zone === z.name ? 700 : 400,
                    color: robot.zone === z.name ? z.color : undefined,
                  }}>
                    {z.name} {robot.zone === z.name && '← 로봇'}
                  </span>
                  <ChevronRight size={12} />
                </div>
              ))}
            </div>
          </div>
          <div className="legend">
            <span className="legend-dot green" /> NORMAL
            <span className="legend-dot red" style={{ marginLeft: 12 }} /> ABNORMAL
          </div>
        </div>

        {/* Scheduling Info */}
        <div className="card">
          <p className="card-label">SCHEDULING INFO.</p>
          <div className="schedule-box" />
        </div>
      </div>
    </div>
  )
}
