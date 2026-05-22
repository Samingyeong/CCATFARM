import { useState, useEffect, useCallback } from 'react'
import { Bell, Wifi, WifiOff, Loader } from 'lucide-react'
import { useRos } from '../hooks/useRos'
import { useBattery } from '../hooks/useBattery'
import { useCamera } from '../hooks/useCamera'
import { getZoneName } from '../utils/zoneMap'
import Joystick from '../components/Joystick'
import RosMap from '../components/RosMap'

declare const ROSLIB: typeof import('roslib')

const zones = ['ZONE A', 'ZONE B', 'ZONE C', 'ZONE D', 'ZONE E']

interface RobotPose {
  x: number
  y: number
  z: number
}

export default function Map() {
  const [mode, setMode] = useState<'AUTO' | 'MANUAL'>('AUTO')
  const [emergency, setEmergency] = useState(false)
  const { ros, status } = useRos()
  const battery = useBattery()
  const cameraSrc = useCamera(ros, status)
  const [pose, setPose] = useState<RobotPose | null>(null)

  // /amcl_pose 구독
  useEffect(() => {
    if (!ros || status !== 'connected') return
    const poseTopic = new ROSLIB.Topic({
      ros,
      name: '/amcl_pose',
      messageType: 'geometry_msgs/msg/PoseWithCovarianceStamped',
    })
    poseTopic.subscribe((message: any) => {
      const pos = message.pose?.pose?.position
      if (pos) setPose({ x: pos.x, y: pos.y, z: pos.z })
    })
    return () => poseTopic.unsubscribe()
  }, [ros, status])

  // EMERGENCY 토글 → 활성화 시 MANUAL 모드로 전환
  const handleEmergency = () => {
    const next = !emergency
    setEmergency(next)
    if (next) setMode('MANUAL')
    else setMode('AUTO')
  }

  // cmd_vel 퍼블리시 (ROS 연결 시)
  const publishVel = useCallback((linear: number, angular: number) => {
    if (!ros || status !== 'connected') return
    const cmdVel = new ROSLIB.Topic({
      ros,
      name: '/cmd_vel',
      messageType: 'geometry_msgs/msg/Twist',
    })
    cmdVel.publish({
      linear: { x: linear, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: angular },
    } as any)
  }, [ros, status])

  const handleJoystickStop = useCallback(() => {
    publishVel(0, 0)
  }, [publishVel])

  const statusIcon = {
    connecting: <Loader size={14} className="spin" />,
    connected: <Wifi size={14} color="#22c55e" />,
    disconnected: <WifiOff size={14} color="#9ca3af" />,
    error: <WifiOff size={14} color="#ef4444" />,
  }[status]

  const statusLabel = {
    connecting: '연결 중...',
    connected: '연결됨',
    disconnected: '연결 끊김',
    error: '연결 오류',
  }[status]

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">MAP</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="ros-status-badge">
            {statusIcon}
            <span>{statusLabel}</span>
          </div>
          <Bell size={20} className="header-icon" />
        </div>
      </header>

      <div className="page-content">
        {/* Camera Feed — ROS CompressedImage */}
        <div className="camera-feed">
          {cameraSrc ? (
            <img
              src={cameraSrc}
              alt="Robot Camera"
              className="camera-stream"
            />
          ) : (
            <div className="camera-placeholder">
              {status === 'connected' ? '카메라 영상 수신 대기 중...' : 'ROS 연결 대기 중...'}
            </div>
          )}
          <div className="camera-overlay">
            <span className="camera-tag red">{pose ? `● X:${pose.x.toFixed(1)} Y:${pose.y.toFixed(1)}` : '● 위치 대기'}</span>
            <div className="camera-stats">
              <span>🔋 {battery ? `${battery.percentage}%` : '--'}</span>
              <span>{new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        </div>

        {/* ROS 실시간 맵 */}
        <RosMap robotPose={pose} />

        {/* ROS 위치 정보 */}
        <div className="card">
          <p className="card-label">ROBOT POSITION (/amcl_pose)</p>
          {status === 'connected' && pose ? (
            <div className="pose-grid">
              {(['x', 'y', 'z'] as const).map((axis) => (
                <div key={axis} className="pose-item">
                  <span className="pose-axis">{axis.toUpperCase()}</span>
                  <span className="pose-val">{pose[axis].toFixed(3)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="pose-empty">
              {status === 'connecting' && <><Loader size={14} className="spin" /> 로봇 연결 중...</>}
              {status === 'connected' && !pose && '위치 데이터 수신 대기 중...'}
              {status === 'disconnected' && '로봇과 연결되지 않았습니다.'}
              {status === 'error' && '연결 오류 — rosbridge_server를 확인하세요.'}
            </div>
          )}
        </div>

        {/* Zone Map */}
        <div className="card zone-map-card">
          <div className="zone-grid">
            {zones.slice(0, 3).map((z) => (
              <div key={z} className={`zone-box ${pose && getZoneName(pose.x, pose.y).toUpperCase() === z ? 'active' : ''}`}>{z}</div>
            ))}
          </div>
          <div className="zone-grid zone-grid-bottom">
            {zones.slice(3).map((z) => (
              <div key={z} className="zone-box">{z}</div>
            ))}
            <div className="zone-box station">STATION</div>
          </div>
          <svg className="zone-path" viewBox="0 0 300 80" preserveAspectRatio="none">
            <path d="M 50 20 Q 150 20 150 60 Q 150 60 250 60"
              stroke="#3b82f6" strokeWidth="2" fill="none" strokeDasharray="6 3" />
          </svg>
        </div>

        {/* Mode & Progress */}
        <div className="mode-row">
          <div className="mode-box">
            <span className="mode-label">MODE</span>
            <div className="mode-toggle">
              <button
                className={mode === 'AUTO' ? 'active' : ''}
                onClick={() => { if (!emergency) setMode('AUTO') }}
              >AUTO Patrol</button>
              <button
                className={mode === 'MANUAL' ? 'active' : ''}
                onClick={() => { if (!emergency) setMode('MANUAL') }}
              >Manual Ctrl</button>
            </div>
          </div>
          <div className="progress-info">
            <span className="mode-label">PROGRESS</span>
            <span className="progress-val">{battery ? `${battery.percentage}%` : '-- %'}</span>
          </div>
        </div>

        {/* 조이스틱 — EMERGENCY 활성화 시에만 표시 */}
        {emergency && (
          <div className="card dpad-card">
            <p className="card-label" style={{ textAlign: 'center', color: '#ef4444' }}>
              ⚠ MANUAL CONTROL ACTIVE
            </p>
            <Joystick
              onMove={(linear, angular) => publishVel(linear, angular)}
              onStop={handleJoystickStop}
            />
          </div>
        )}

        {/* Action Buttons */}
        <div className="robot-actions">
          <button className="action-btn start">START</button>
          <button className="action-btn home">HOME</button>
          <button
            className={`action-btn emergency ${emergency ? 'emergency-active' : ''}`}
            onClick={handleEmergency}
          >
            {emergency ? 'CANCEL' : 'EMERGENCY'}
          </button>
        </div>
      </div>
    </div>
  )
}
