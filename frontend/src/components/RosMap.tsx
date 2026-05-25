import { useRef, useEffect, useState, useCallback } from 'react'
import { Check, Crosshair, X } from 'lucide-react'
import type { UseRosReturn } from '../hooks/useRos'
import { TOPICS } from '../config/rosTopics'

declare const ROSLIB: typeof import('roslib')

interface MapMeta {
  width: number
  height: number
  resolution: number
  origin: { x: number; y: number }
}

interface RosMapProps {
  ros: UseRosReturn['ros']
  status: UseRosReturn['status']
  robotPose?: { x: number; y: number } | null
}

interface PoseEstimate {
  x: number
  y: number
  yaw: number
}

type InitialPoseStatus =
  | { state: 'idle' }
  | { state: 'pending'; x: number; y: number; sentAt: number }
  | { state: 'confirmed'; x: number; y: number }
  | { state: 'timeout'; x: number; y: number }

// 색상 팔레트 — 깔끔한 느낌
const COLOR_FREE = [255, 255, 255]       // 흰색 (이동 가능)
const COLOR_OCCUPIED = [30, 41, 59]      // 진한 남색 (벽/장애물)
const COLOR_UNKNOWN = [226, 232, 240]    // 연한 회색 (미탐색)
const MAP_THROTTLE_MS = Number(import.meta.env.VITE_MAP_THROTTLE_MS ?? 1000)

const INITIAL_POSE_COVARIANCE = [
  0.25, 0, 0, 0, 0, 0,
  0, 0.25, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0.06853892326654787,
]

export default function RosMap({ ros, status, robotPose }: RosMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mapDataRef = useRef<ImageData | null>(null)
  const [mapMeta, setMapMeta] = useState<MapMeta | null>(null)
  const [connected, setConnected] = useState(false)
  const [poseMode, setPoseMode] = useState(false)
  const [poseDraft, setPoseDraft] = useState<PoseEstimate | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [initialPoseStatus, setInitialPoseStatus] = useState<InitialPoseStatus>({ state: 'idle' })

  const drawRobot = useCallback((ctx: CanvasRenderingContext2D, pose: { x: number; y: number }, meta: MapMeta) => {
    const px = (pose.x - meta.origin.x) / meta.resolution
    const py = meta.height - (pose.y - meta.origin.y) / meta.resolution

    // 외부 글로우
    ctx.beginPath()
    ctx.arc(px, py, 10, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(59, 91, 219, 0.2)'
    ctx.fill()

    // 중간 링
    ctx.beginPath()
    ctx.arc(px, py, 6, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(59, 91, 219, 0.4)'
    ctx.fill()

    // 코어 점
    ctx.beginPath()
    ctx.arc(px, py, 4, 0, Math.PI * 2)
    ctx.fillStyle = '#3b5bdb'
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }, [])

  const worldToCanvas = useCallback((pose: { x: number; y: number }, meta: MapMeta) => ({
    x: (pose.x - meta.origin.x) / meta.resolution,
    y: meta.height - (pose.y - meta.origin.y) / meta.resolution,
  }), [])

  const canvasToWorld = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current
    if (!canvas || !mapMeta) return null

    const rect = canvas.getBoundingClientRect()
    const px = (clientX - rect.left) * (canvas.width / rect.width)
    const py = (clientY - rect.top) * (canvas.height / rect.height)

    return {
      x: px * mapMeta.resolution + mapMeta.origin.x,
      y: (mapMeta.height - py) * mapMeta.resolution + mapMeta.origin.y,
    }
  }, [mapMeta])

  const drawPoseEstimate = useCallback((ctx: CanvasRenderingContext2D, pose: PoseEstimate, meta: MapMeta) => {
    const p = worldToCanvas(pose, meta)
    const arrowLength = 26
    const endX = p.x + Math.cos(pose.yaw) * arrowLength
    const endY = p.y - Math.sin(pose.yaw) * arrowLength

    ctx.beginPath()
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(34, 197, 94, 0.18)'
    ctx.fill()
    ctx.strokeStyle = '#16a34a'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(endX, endY)
    ctx.strokeStyle = '#16a34a'
    ctx.lineWidth = 3
    ctx.stroke()

    ctx.save()
    ctx.translate(endX, endY)
    ctx.rotate(-pose.yaw + Math.PI / 2)
    ctx.beginPath()
    ctx.moveTo(0, -7)
    ctx.lineTo(5, 5)
    ctx.lineTo(-5, 5)
    ctx.closePath()
    ctx.fillStyle = '#16a34a'
    ctx.fill()
    ctx.restore()
  }, [worldToCanvas])

  const redrawMap = useCallback(() => {
    if (!mapMeta || !canvasRef.current || !mapDataRef.current) return
    const ctx = canvasRef.current.getContext('2d')!
    ctx.putImageData(mapDataRef.current, 0, 0)
    if (robotPose) drawRobot(ctx, robotPose, mapMeta)
    if (poseDraft) drawPoseEstimate(ctx, poseDraft, mapMeta)
  }, [drawPoseEstimate, drawRobot, mapMeta, poseDraft, robotPose])

  useEffect(() => {
    if (!ros || status !== 'connected') {
      setConnected(false)
      return
    }
    setConnected(true)

    const mapTopic = new ROSLIB.Topic({
      ros,
      name: TOPICS.MAP.name,
      messageType: TOPICS.MAP.messageType,
      throttle_rate: MAP_THROTTLE_MS,
      queue_length: 1,
    } as any)

    mapTopic.subscribe((message: any) => {
      const { info, data } = message
      const width: number = info.width
      const height: number = info.height
      const resolution: number = info.resolution
      const origin = { x: info.origin.position.x, y: info.origin.position.y }

      setMapMeta({ width, height, resolution, origin })

      const canvas = canvasRef.current
      if (!canvas) return

      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      const imgData = ctx.createImageData(width, height)

      for (let i = 0; i < data.length; i++) {
        const val = data[i]
        const row = height - 1 - Math.floor(i / width)
        const col = i % width
        const idx = (row * width + col) * 4

        let r: number, g: number, b: number

        if (val === -1) {
          [r, g, b] = COLOR_UNKNOWN
        } else if (val === 0) {
          [r, g, b] = COLOR_FREE
        } else {
          // 장애물: 값이 클수록 진하게
          const t = val / 100
          r = Math.round(COLOR_FREE[0] + (COLOR_OCCUPIED[0] - COLOR_FREE[0]) * t)
          g = Math.round(COLOR_FREE[1] + (COLOR_OCCUPIED[1] - COLOR_FREE[1]) * t)
          b = Math.round(COLOR_FREE[2] + (COLOR_OCCUPIED[2] - COLOR_FREE[2]) * t)
        }

        imgData.data[idx] = r
        imgData.data[idx + 1] = g
        imgData.data[idx + 2] = b
        imgData.data[idx + 3] = 255
      }

      ctx.putImageData(imgData, 0, 0)
      mapDataRef.current = imgData
    })

    return () => mapTopic.unsubscribe()
  }, [ros, status])

  useEffect(() => {
    redrawMap()
  }, [redrawMap])

  useEffect(() => {
    if (initialPoseStatus.state !== 'pending' || !robotPose) return

    const dx = robotPose.x - initialPoseStatus.x
    const dy = robotPose.y - initialPoseStatus.y
    const distance = Math.hypot(dx, dy)

    if (distance <= 0.5) {
      setInitialPoseStatus({
        state: 'confirmed',
        x: initialPoseStatus.x,
        y: initialPoseStatus.y,
      })
    }
  }, [initialPoseStatus, robotPose])

  useEffect(() => {
    if (initialPoseStatus.state !== 'pending') return

    const timeout = window.setTimeout(() => {
      setInitialPoseStatus((current) => (
        current.state === 'pending'
          ? { state: 'timeout', x: current.x, y: current.y }
          : current
      ))
    }, 8000)

    return () => window.clearTimeout(timeout)
  }, [initialPoseStatus])

  useEffect(() => {
    if (initialPoseStatus.state !== 'confirmed' && initialPoseStatus.state !== 'timeout') return

    const timeout = window.setTimeout(() => {
      setInitialPoseStatus({ state: 'idle' })
    }, 3500)

    return () => window.clearTimeout(timeout)
  }, [initialPoseStatus])

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!poseMode) return
    const start = canvasToWorld(event.clientX, event.clientY)
    if (!start) return

    event.currentTarget.setPointerCapture(event.pointerId)
    setDragStart(start)
    setPoseDraft({ ...start, yaw: 0 })
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!poseMode || !dragStart) return
    const current = canvasToWorld(event.clientX, event.clientY)
    if (!current) return

    const dx = current.x - dragStart.x
    const dy = current.y - dragStart.y
    const yaw = Math.hypot(dx, dy) > 0.02 ? Math.atan2(dy, dx) : 0
    setPoseDraft({ ...dragStart, yaw })
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!poseMode || !dragStart) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    setDragStart(null)
  }

  const publishInitialPose = () => {
    if (!ros || status !== 'connected' || !poseDraft) return

    const now = Date.now()
    const secs = Math.floor(now / 1000)
    const nsecs = (now % 1000) * 1_000_000
    const halfYaw = poseDraft.yaw / 2

    const initialPoseTopic = new ROSLIB.Topic({
      ros,
      name: TOPICS.INITIAL_POSE.name,
      messageType: TOPICS.INITIAL_POSE.messageType,
    })

    initialPoseTopic.publish({
      header: {
        stamp: { sec: secs, nanosec: nsecs },
        frame_id: 'map',
      },
      pose: {
        pose: {
          position: { x: poseDraft.x, y: poseDraft.y, z: 0 },
          orientation: {
            x: 0,
            y: 0,
            z: Math.sin(halfYaw),
            w: Math.cos(halfYaw),
          },
        },
        covariance: INITIAL_POSE_COVARIANCE,
      },
    } as any)

    setPoseMode(false)
    setPoseDraft(null)
    setInitialPoseStatus({
      state: 'pending',
      x: poseDraft.x,
      y: poseDraft.y,
      sentAt: now,
    })
  }

  const cancelPoseEstimate = () => {
    setPoseMode(false)
    setPoseDraft(null)
    setDragStart(null)
  }

  return (
    <div className="ros-map-container">
      {!connected && (
        <div className="ros-map-placeholder">
          <div className="ros-map-icon">MAP</div>
          <p>ROS 맵 대기 중</p>
          <p className="ros-map-hint">rosbridge 연결 후 /map 토픽 수신 시 표시됩니다</p>
        </div>
      )}
      {connected && (
        <div className="ros-map-toolbar">
          <button
            type="button"
            className={`ros-map-tool ${poseMode ? 'active' : ''}`}
            onClick={() => {
              setPoseMode((current) => !current)
              setPoseDraft(null)
              setDragStart(null)
            }}
            title="2D Pose Estimate"
          >
            <Crosshair size={15} />
            <span>2D Pose</span>
          </button>
          {poseMode && (
            <>
              <button
                type="button"
                className="ros-map-icon-btn confirm"
                onClick={publishInitialPose}
                disabled={!poseDraft}
                title="Publish initial pose"
              >
                <Check size={15} />
              </button>
              <button
                type="button"
                className="ros-map-icon-btn"
                onClick={cancelPoseEstimate}
                title="Cancel"
              >
                <X size={15} />
              </button>
            </>
          )}
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`ros-map-canvas ${poseMode ? 'pose-mode' : ''}`}
        style={{ display: connected ? 'block' : 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      {connected && poseMode && (
        <div className="ros-map-pose-hint">
          지도를 누른 뒤 진행 방향으로 드래그하세요
        </div>
      )}
      {connected && initialPoseStatus.state !== 'idle' && !poseMode && (
        <div className={`ros-map-pose-status ${initialPoseStatus.state}`}>
          {initialPoseStatus.state === 'pending' && '2D Pose 전송됨. AMCL 위치 갱신 확인 중...'}
          {initialPoseStatus.state === 'confirmed' && 'AMCL 위치가 지정한 좌표 근처로 갱신됨'}
          {initialPoseStatus.state === 'timeout' && 'AMCL 위치 갱신 확인 실패. /amcl_pose를 확인하세요'}
        </div>
      )}
      {connected && robotPose && (
        <div className="ros-map-coords">
          X: {robotPose.x.toFixed(2)} | Y: {robotPose.y.toFixed(2)}
        </div>
      )}
    </div>
  )
}
