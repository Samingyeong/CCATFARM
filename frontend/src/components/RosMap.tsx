import { useRef, useEffect, useState, useCallback } from 'react'
import { Check, Crosshair, X, Grid3X3 } from 'lucide-react'
import type { UseRosReturn } from '../hooks/useRos'
import { TOPICS } from '../config/rosTopics'
import { ZONES, generateZonesFromMap, getZoneFromPose, type ZoneBounds } from '../utils/zoneMap'

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
  /** 순회 경로 (Zone name 배열, 예: ['Zone A', 'Zone B']) */
  patrolRoute?: string[]
  /** 로봇이 Zone을 변경했을 때 콜백 */
  onZoneChange?: (zoneName: string) => void
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

// 색상 팔레트 — 원본 맵 색상 (밝게)
const COLOR_FREE = [255, 255, 255]       // 흰색 (이동 가능)
const COLOR_OCCUPIED = [40, 50, 70]      // 어두운 (벽/장애물)
const COLOR_UNKNOWN = [200, 210, 220]    // 연한 회색 (미탐색)
const MAP_THROTTLE_MS = Number(import.meta.env.VITE_MAP_THROTTLE_MS ?? 1000)

const INITIAL_POSE_COVARIANCE = [
  0.25, 0, 0, 0, 0, 0,
  0, 0.25, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0.06853892326654787,
]

export default function RosMap({ ros, status, robotPose, patrolRoute, onZoneChange }: RosMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mapDataRef = useRef<ImageData | null>(null)
  const [mapMeta, setMapMeta] = useState<MapMeta | null>(null)
  const [activeZones, setActiveZones] = useState<ZoneBounds[]>(ZONES)
  const [stationPos, setStationPos] = useState<{ x: number; y: number } | null>(null)
  const stationCaptured = useRef(false)
  const [connected, setConnected] = useState(false)
  const [poseMode, setPoseMode] = useState(false)
  const [zoneEditMode, setZoneEditMode] = useState(false)
  const [zoneDraft, setZoneDraft] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null)
  const [cursorCoord, setCursorCoord] = useState<{ x: number; y: number } | null>(null)
  const [poseDraft, setPoseDraft] = useState<PoseEstimate | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [initialPoseStatus, setInitialPoseStatus] = useState<InitialPoseStatus>({ state: 'idle' })

  const drawRobot = useCallback((ctx: CanvasRenderingContext2D, pose: { x: number; y: number }, meta: MapMeta) => {
    const px = (pose.x - meta.origin.x) / meta.resolution
    const py = meta.height - (pose.y - meta.origin.y) / meta.resolution

    ctx.save()
    ctx.translate(px, py)

    // 바닥 그림자 (3D 느낌)
    ctx.beginPath()
    ctx.ellipse(0, 6, 10, 4, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'
    ctx.fill()

    // 몸체 하단 (어두운 면 — 3D 깊이감)
    ctx.beginPath()
    ctx.roundRect(-9, -4, 18, 16, 4)
    ctx.fillStyle = '#1d4ed8'
    ctx.fill()

    // 몸체 상단 (밝은 면)
    ctx.beginPath()
    ctx.roundRect(-9, -8, 18, 14, 4)
    ctx.fillStyle = '#3b82f6'
    ctx.fill()

    // 몸체 하이라이트 (상단 반사광)
    ctx.beginPath()
    ctx.roundRect(-7, -7, 14, 5, 3)
    ctx.fillStyle = 'rgba(147, 197, 253, 0.4)'
    ctx.fill()

    // 얼굴 패널 (어두운 스크린)
    ctx.beginPath()
    ctx.roundRect(-6, -4, 12, 7, 2)
    ctx.fillStyle = '#1e293b'
    ctx.fill()

    // 눈 (LED 느낌 — 발광)
    ctx.shadowColor = '#60a5fa'
    ctx.shadowBlur = 4
    ctx.fillStyle = '#93c5fd'
    ctx.beginPath()
    ctx.arc(-2.5, -1, 1.8, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(2.5, -1, 1.8, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0

    // 안테나
    ctx.beginPath()
    ctx.moveTo(0, -8)
    ctx.lineTo(0, -14)
    ctx.strokeStyle = '#64748b'
    ctx.lineWidth = 1.5
    ctx.lineCap = 'round'
    ctx.stroke()

    // 안테나 끝 (발광 구)
    ctx.shadowColor = '#22c55e'
    ctx.shadowBlur = 6
    ctx.beginPath()
    ctx.arc(0, -15, 2, 0, Math.PI * 2)
    ctx.fillStyle = '#22c55e'
    ctx.fill()
    ctx.shadowBlur = 0

    // 바퀴 (양쪽)
    ctx.fillStyle = '#334155'
    ctx.beginPath()
    ctx.roundRect(-11, 2, 3, 6, 1)
    ctx.fill()
    ctx.beginPath()
    ctx.roundRect(8, 2, 3, 6, 1)
    ctx.fill()

    ctx.restore()
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

  const drawZoneOverlays = useCallback((ctx: CanvasRenderingContext2D, meta: MapMeta) => {
    for (const zone of activeZones) {
      const topLeft = worldToCanvas({ x: zone.xMin, y: zone.yMax }, meta)
      const bottomRight = worldToCanvas({ x: zone.xMax, y: zone.yMin }, meta)
      const w = bottomRight.x - topLeft.x
      const h = bottomRight.y - topLeft.y

      // 반투명 배경 (잘 보이게)
      ctx.fillStyle = zone.color + '20'
      ctx.fillRect(topLeft.x, topLeft.y, w, h)

      // 테두리 (실선, 두껍게)
      ctx.save()
      ctx.strokeStyle = zone.color + 'bb'
      ctx.lineWidth = 2
      ctx.strokeRect(topLeft.x, topLeft.y, w, h)
      ctx.restore()

      // Zone 라벨 (배경 포함, 잘 보이게)
      const cx = topLeft.x + w / 2
      const cy = topLeft.y + h / 2
      const label = zone.name
      ctx.font = 'bold 11px -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const tw = ctx.measureText(label).width
      // 라벨 배경
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.beginPath()
      ctx.roundRect(cx - tw / 2 - 6, cy - 8, tw + 12, 16, 4)
      ctx.fill()
      // 라벨 텍스트
      ctx.fillStyle = zone.color
      ctx.fillText(label, cx, cy)
    }
  }, [activeZones, worldToCanvas])

  const drawPatrolRoute = useCallback((ctx: CanvasRenderingContext2D, meta: MapMeta, currentPose: { x: number; y: number } | null) => {
    if (!patrolRoute || patrolRoute.length === 0) return

    // 각 Zone의 중심 좌표 계산
    const getZoneCenter = (zoneName: string): { x: number; y: number } | null => {
      const zone = activeZones.find((z) => z.name === zoneName)
      if (!zone) return null
      return { x: (zone.xMin + zone.xMax) / 2, y: (zone.yMin + zone.yMax) / 2 }
    }

    // 경로 포인트 수집 (현재 위치 → 각 Zone 중심)
    const points: { x: number; y: number }[] = []
    if (currentPose) {
      points.push(worldToCanvas(currentPose, meta))
    }
    for (const zoneName of patrolRoute) {
      const center = getZoneCenter(zoneName)
      if (center) points.push(worldToCanvas(center, meta))
    }

    if (points.length < 2) return

    // 점선 경로 그리기
    ctx.save()
    ctx.setLineDash([8, 5])
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y)
    }
    ctx.stroke()
    ctx.restore()

    // 각 경유지에 작은 원 표시
    for (let i = 1; i < points.length; i++) {
      ctx.beginPath()
      ctx.arc(points[i].x, points[i].y, 5, 0, Math.PI * 2)
      ctx.fillStyle = '#3b82f6'
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      ctx.stroke()

      // 순서 번호
      ctx.font = 'bold 7px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#fff'
      ctx.fillText(String(i), points[i].x, points[i].y)
    }

  }, [activeZones, patrolRoute, worldToCanvas])

  const redrawMap = useCallback(() => {
    if (!mapMeta || !canvasRef.current || !mapDataRef.current) return
    const ctx = canvasRef.current.getContext('2d')!
    ctx.putImageData(mapDataRef.current, 0, 0)

    // 맵 배경만 연하게 — 반투명 밝은 오버레이 (이 위의 Zone/로봇/경로는 선명하게 보임)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height)

    drawZoneOverlays(ctx, mapMeta)
    drawPatrolRoute(ctx, mapMeta, robotPose ?? null)

    // Home Zone 마커 (최초 연결 위치)
    if (stationPos) {
      const hp = worldToCanvas(stationPos, mapMeta)
      ctx.save()
      ctx.beginPath()
      ctx.arc(hp.x, hp.y, 10, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(34, 197, 94, 0.15)'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(hp.x, hp.y, 6, 0, Math.PI * 2)
      ctx.strokeStyle = '#22c55e'
      ctx.lineWidth = 1.5
      ctx.setLineDash([3, 2])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(hp.x, hp.y, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = '#22c55e'
      ctx.fill()
      ctx.font = 'bold 8px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = '#22c55e'
      ctx.fillText('HOME', hp.x, hp.y - 13)
      ctx.restore()
    }

    if (robotPose) drawRobot(ctx, robotPose, mapMeta)
    if (poseDraft) drawPoseEstimate(ctx, poseDraft, mapMeta)

    // Zone 편집 드래그 영역 표시
    if (zoneDraft && mapMeta) {
      const tl = worldToCanvas(
        { x: Math.min(zoneDraft.start.x, zoneDraft.end.x), y: Math.max(zoneDraft.start.y, zoneDraft.end.y) },
        mapMeta
      )
      const br = worldToCanvas(
        { x: Math.max(zoneDraft.start.x, zoneDraft.end.x), y: Math.min(zoneDraft.start.y, zoneDraft.end.y) },
        mapMeta
      )
      ctx.save()
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 2
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
      ctx.fillStyle = 'rgba(245, 158, 11, 0.1)'
      ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
      ctx.restore()

      // 좌표 라벨
      const xMin = Math.min(zoneDraft.start.x, zoneDraft.end.x).toFixed(2)
      const xMax = Math.max(zoneDraft.start.x, zoneDraft.end.x).toFixed(2)
      const yMin = Math.min(zoneDraft.start.y, zoneDraft.end.y).toFixed(2)
      const yMax = Math.max(zoneDraft.start.y, zoneDraft.end.y).toFixed(2)
      ctx.font = '9px monospace'
      ctx.fillStyle = '#f59e0b'
      ctx.textAlign = 'left'
      ctx.fillText(`(${xMin}, ${yMax})`, tl.x + 3, tl.y + 11)
      ctx.textAlign = 'right'
      ctx.fillText(`(${xMax}, ${yMin})`, br.x - 3, br.y - 3)
    }
  }, [drawPoseEstimate, drawRobot, drawZoneOverlays, drawPatrolRoute, mapMeta, poseDraft, robotPose, stationPos, zoneDraft, worldToCanvas])

  useEffect(() => {
    if (!ros || status !== 'connected') {
      setConnected(false)
      // 연결 끊기면 Home Zone 초기화 (재연결 시 새로 캡처)
      stationCaptured.current = false
      setStationPos(null)
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

  // 맵 메타 수신 시 Zone 자동 생성 (수동 설정이 없을 때)
  useEffect(() => {
    if (!mapMeta) return
    if (ZONES.length > 0) {
      setActiveZones(ZONES)
    } else {
      const generated = generateZonesFromMap(
        mapMeta.origin.x,
        mapMeta.origin.y,
        mapMeta.width,
        mapMeta.height,
        mapMeta.resolution
      )
      setActiveZones(generated)
    }
  }, [mapMeta])

  // 처음 연결 시 로봇 위치를 Home Zone으로 캡처
  useEffect(() => {
    if (stationCaptured.current) return
    if (status === 'connected' && robotPose) {
      setStationPos({ x: robotPose.x, y: robotPose.y })
      stationCaptured.current = true
      console.log(`[Home Zone 캡처] X: ${robotPose.x.toFixed(2)}, Y: ${robotPose.y.toFixed(2)}`)
    }
  }, [status, robotPose])

  // 로봇 Zone 변경 감지 → 콜백 호출
  const lastZoneRef = useRef<string | null>(null)
  useEffect(() => {
    if (!robotPose || activeZones.length === 0 || !onZoneChange) return
    const zone = getZoneFromPose(robotPose.x, robotPose.y, activeZones)
    const zoneName = zone ? zone.name : null
    if (zoneName && zoneName !== lastZoneRef.current) {
      lastZoneRef.current = zoneName
      onZoneChange(zoneName)
    }
  }, [robotPose, activeZones, onZoneChange])

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
    // Zone 편집 모드
    if (zoneEditMode) {
      const start = canvasToWorld(event.clientX, event.clientY)
      if (!start) return
      event.currentTarget.setPointerCapture(event.pointerId)
      setZoneDraft({ start, end: start })
      return
    }
    if (!poseMode) return
    const start = canvasToWorld(event.clientX, event.clientY)
    if (!start) return

    event.currentTarget.setPointerCapture(event.pointerId)
    setDragStart(start)
    setPoseDraft({ ...start, yaw: 0 })
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // 항상 커서 좌표 업데이트 (좌표 확인용)
    const coord = canvasToWorld(event.clientX, event.clientY)
    if (coord) setCursorCoord(coord)

    // Zone 편집 드래그
    if (zoneEditMode && zoneDraft) {
      const current = canvasToWorld(event.clientX, event.clientY)
      if (current) setZoneDraft({ start: zoneDraft.start, end: current })
      return
    }

    if (!poseMode || !dragStart) return
    const current = canvasToWorld(event.clientX, event.clientY)
    if (!current) return

    const dx = current.x - dragStart.x
    const dy = current.y - dragStart.y
    const yaw = Math.hypot(dx, dy) > 0.02 ? Math.atan2(dy, dx) : 0
    setPoseDraft({ ...dragStart, yaw })
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Zone 편집 완료
    if (zoneEditMode && zoneDraft) {
      event.currentTarget.releasePointerCapture(event.pointerId)
      const xMin = Math.min(zoneDraft.start.x, zoneDraft.end.x)
      const xMax = Math.max(zoneDraft.start.x, zoneDraft.end.x)
      const yMin = Math.min(zoneDraft.start.y, zoneDraft.end.y)
      const yMax = Math.max(zoneDraft.start.y, zoneDraft.end.y)
      // 너무 작은 영역은 무시
      if (Math.abs(xMax - xMin) > 0.1 && Math.abs(yMax - yMin) > 0.1) {
        console.log(`[Zone 설정] xMin: ${xMin.toFixed(2)}, xMax: ${xMax.toFixed(2)}, yMin: ${yMin.toFixed(2)}, yMax: ${yMax.toFixed(2)}`)
        console.log(`→ zoneMap.ts에 추가:`)
        console.log(`  { name: 'Zone ?', xMin: ${xMin.toFixed(1)}, xMax: ${xMax.toFixed(1)}, yMin: ${yMin.toFixed(1)}, yMax: ${yMax.toFixed(1)}, color: '#22c55e' },`)
      }
      setZoneDraft(null)
      return
    }

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
              setZoneEditMode(false)
              setPoseDraft(null)
              setDragStart(null)
            }}
            title="2D Pose Estimate"
          >
            <Crosshair size={15} />
            <span>2D Pose</span>
          </button>
          <button
            type="button"
            className={`ros-map-tool ${zoneEditMode ? 'active' : ''}`}
            onClick={() => {
              setZoneEditMode((current) => !current)
              setPoseMode(false)
              setPoseDraft(null)
              setZoneDraft(null)
            }}
            title="Zone 영역 설정 (드래그로 영역 지정)"
          >
            <Grid3X3 size={15} />
            <span>Zone 설정</span>
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
        className={`ros-map-canvas ${poseMode ? 'pose-mode' : ''} ${zoneEditMode ? 'zone-edit-mode' : ''}`}
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
      {connected && zoneEditMode && (
        <div className="ros-map-pose-hint zone-edit-hint">
          드래그로 Zone 영역을 지정하세요 (좌표는 콘솔에 출력됩니다)
          {cursorCoord && (
            <span className="cursor-coord">
              커서: X={cursorCoord.x.toFixed(2)}, Y={cursorCoord.y.toFixed(2)}
            </span>
          )}
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
      {connected && stationPos && !zoneEditMode && (
        <div className="home-zone-badge">
          HOME: ({stationPos.x.toFixed(1)}, {stationPos.y.toFixed(1)})
        </div>
      )}
      {connected && mapMeta && zoneEditMode && (
        <div className="ros-map-meta">
          맵 범위: X[{mapMeta.origin.x.toFixed(1)} ~ {(mapMeta.origin.x + mapMeta.width * mapMeta.resolution).toFixed(1)}]
          Y[{mapMeta.origin.y.toFixed(1)} ~ {(mapMeta.origin.y + mapMeta.height * mapMeta.resolution).toFixed(1)}]
          | 해상도: {mapMeta.resolution}m/px
        </div>
      )}
    </div>
  )
}
