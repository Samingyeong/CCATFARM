import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { Check, Crosshair, X, Grid3X3, Info, Home as HomeIcon, Leaf, Flag } from 'lucide-react'
import type { UseRosReturn } from '../hooks/useRos'
import { TOPICS } from '../config/rosTopics'
import { ZONES, generateZonesFromMap, getZoneFromPose, type ZoneBounds } from '../utils/zoneMap'
import { loadSavedZones } from './ZoneEditor'
import {
  buildInitialPoseMessage,
  canSetManualInitialPose,
  isNewManualNav2Ready,
  yawFromDrag,
  type PoseEstimate,
} from '../utils/initialPose'

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
  robotPose?: { x: number; y: number; yaw?: number; receivedAt?: number } | null
  /** true일 때만 2D Pose Estimate를 차단 */
  teleopActive?: boolean | null
  robotStatus?: string
  robotStatusSequence?: number
  onManualPosePendingChange?: (pending: boolean) => void
  /** 지나온 경로 (Zone name 배열, 예: ['Zone A', 'Zone B']) */
  patrolRoute?: string[]
  /** /mission_route_points에서 파싱된 미션 경로 JSON (전체 순찰 waypoint의 원천) */
  missionRoute?: Record<string, unknown> | null
  /** 로봇이 Zone을 변경했을 때 콜백 */
  onZoneChange?: (zoneName: string) => void
}

interface Waypoint { x: number; y: number; name?: string }

/**
 * /mission_route_points JSON에서 waypoint 배열을 유연하게 추출한다.
 * 로봇 포맷을 모르므로 흔한 형태들을 모두 수용한다:
 *  - { points: [{x,y,name?}, ...] }
 *  - { route: [[x,y], ...] } / { waypoints: [...] }
 *  - [ {x,y}, ... ] 또는 [ [x,y], ... ]
 * 추출 실패 시 빈 배열.
 */
function parseMissionWaypoints(route: Record<string, unknown> | null | undefined): Waypoint[] {
  if (!route) return []
  const candidate: any =
    Array.isArray(route) ? route
      : (route as any).points ?? (route as any).waypoints ?? (route as any).route ?? (route as any).path
  if (!Array.isArray(candidate)) return []
  const out: Waypoint[] = []
  for (const item of candidate) {
    if (Array.isArray(item) && item.length >= 2 && typeof item[0] === 'number' && typeof item[1] === 'number') {
      out.push({ x: item[0], y: item[1] })
    } else if (item && typeof item === 'object' && typeof item.x === 'number' && typeof item.y === 'number') {
      out.push({ x: item.x, y: item.y, name: typeof item.name === 'string' ? item.name : undefined })
    }
  }
  return out
}

/** 미션 JSON에서 home/dock 좌표 추출 (있으면) */
function parseMissionHome(route: Record<string, unknown> | null | undefined): Waypoint | null {
  if (!route || Array.isArray(route)) return null
  const h: any = (route as any).home ?? (route as any).dock ?? (route as any).station
  if (h && typeof h.x === 'number' && typeof h.y === 'number') return { x: h.x, y: h.y }
  if (Array.isArray(h) && typeof h[0] === 'number' && typeof h[1] === 'number') return { x: h[0], y: h[1] }
  return null
}

type InitialPoseStatus =
  | { state: 'idle' }
  | { state: 'pending'; statusSequenceAtSend: number }
  | { state: 'ready' }

// OccupancyGrid 팔레트 — Smart Farm Navigation (raw b/w가 아닌 농업 테마)
const COLOR_UNKNOWN = [247, 249, 246]    // #F7F9F6 미탐색
const COLOR_FREE = [238, 243, 236]       // #EEF3EC 자유 공간
const COLOR_OCCUPIED = [200, 210, 199]   // #C8D2C7 장애물
const COLOR_STRONG = [174, 188, 175]     // #AEBCAF 강한 장애물(벽)

// 시맨틱 레이어 색
const GREEN = '#4F8F46'                   // primary green (로봇/활성)
const GREEN_RGB = '79, 143, 70'
const ROUTE_PAST = '#9DB29B'              // 지나온 경로 (muted gray-green)
const ROUTE_FUTURE = 'rgba(79,143,70,0.45)' // 예정 경로 (medium-opacity green)
const ZONE_BORDER = 'rgba(120, 140, 120, 0.5)' // muted gray-green 1px border

const MAP_THROTTLE_MS = Number(import.meta.env.VITE_MAP_THROTTLE_MS ?? 1000)

export default function RosMap({
  ros,
  status,
  robotPose,
  teleopActive = null,
  robotStatus = 'UNKNOWN',
  robotStatusSequence = 0,
  onManualPosePendingChange,
  patrolRoute,
  missionRoute,
  onZoneChange,
}: RosMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mapDataRef = useRef<ImageData | null>(null)
  const [mapMeta, setMapMeta] = useState<MapMeta | null>(null)
  const [activeZones, setActiveZones] = useState<ZoneBounds[]>(ZONES)
  const [stationPos, setStationPos] = useState<{ x: number; y: number } | null>(null)
  const stationCaptured = useRef(false)
  const [hasMap, setHasMap] = useState(false)
  const [poseMode, setPoseMode] = useState(false)
  const [zoneEditMode, setZoneEditMode] = useState(false)
  const [zoneDraft, setZoneDraft] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null)
  // 드래그 완료 후 확인/수정 모달에 띄울 pending zone (바로 반영하지 않음)
  const [pendingZone, setPendingZone] = useState<{ name: string; xMin: string; xMax: string; yMin: string; yMax: string } | null>(null)
  const [cursorCoord, setCursorCoord] = useState<{ x: number; y: number } | null>(null)
  const [poseDraft, setPoseDraft] = useState<PoseEstimate | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [initialPoseStatus, setInitialPoseStatus] = useState<InitialPoseStatus>({ state: 'idle' })

  // 현재 로봇이 위치한 Zone (활성 Zone 하이라이트용) — 좌표 재계산 아님, 기존 판정 로직 사용
  const activeZoneName = useMemo(() => {
    if (!robotPose) return null
    const z = getZoneFromPose(robotPose.x, robotPose.y, activeZones)
    return z ? z.name : null
  }, [robotPose, activeZones])

  // 미션 waypoint (전체/예정 경로의 원천). 없으면 빈 배열 → 기존 zone 기반 경로로 폴백
  const missionWaypoints = useMemo(() => parseMissionWaypoints(missionRoute), [missionRoute])
  const missionHome = useMemo(() => parseMissionHome(missionRoute), [missionRoute])

  // 하단 상태바용: 다음 waypoint(가장 가까운) 인덱스/거리, 미션 진행도
  const navSummary = useMemo(() => {
    if (missionWaypoints.length === 0 || !robotPose) return null
    let targetIdx = 0, best = Infinity
    for (let i = 0; i < missionWaypoints.length; i++) {
      const d = Math.hypot(missionWaypoints[i].x - robotPose.x, missionWaypoints[i].y - robotPose.y)
      if (d < best) { best = d; targetIdx = i }
    }
    return {
      targetIdx,
      distance: best,
      total: missionWaypoints.length,
      // 진행도: 현재 target 이전까지 완료한 것으로 간주
      done: targetIdx,
    }
  }, [missionWaypoints, robotPose])

  const drawRobot = useCallback((ctx: CanvasRenderingContext2D, pose: { x: number; y: number; yaw?: number }, meta: MapMeta) => {
    const px = (pose.x - meta.origin.x) / meta.resolution
    const py = meta.height - (pose.y - meta.origin.y) / meta.resolution

    ctx.save()
    ctx.translate(px, py)

    // 은은한 외부 헤일로 (로봇을 가장 눈에 띄게)
    ctx.beginPath()
    ctx.arc(0, 0, 14, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${GREEN_RGB}, 0.12)`
    ctx.fill()

    // Heading arrow — quaternion→yaw 방향의 채워진 삼각형 (바라보는 방향)
    if (typeof pose.yaw === 'number') {
      ctx.save()
      ctx.rotate(-pose.yaw)
      ctx.beginPath()
      ctx.moveTo(20, 0)      // 끝점(전방)
      ctx.lineTo(10, -5.5)
      ctx.lineTo(10, 5.5)
      ctx.closePath()
      ctx.fillStyle = GREEN
      ctx.fill()
      ctx.restore()
    }

    // 흰 테두리 링 (밝은 맵 대비)
    ctx.beginPath()
    ctx.arc(0, 0, 8, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()

    // 코어 원 (브랜드 그린)
    ctx.beginPath()
    ctx.arc(0, 0, 6.5, 0, Math.PI * 2)
    ctx.fillStyle = GREEN
    ctx.fill()

    // 내부 밝은 점
    ctx.beginPath()
    ctx.arc(0, 0, 2.4, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
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

  // Zone 레이어: 기본은 투명 + 1px muted border, 로봇이 있는 활성 Zone만 연한 green fill
  const drawZoneOverlays = useCallback((ctx: CanvasRenderingContext2D, meta: MapMeta, activeName: string | null) => {
    for (const zone of activeZones) {
      const topLeft = worldToCanvas({ x: zone.xMin, y: zone.yMax }, meta)
      const bottomRight = worldToCanvas({ x: zone.xMax, y: zone.yMin }, meta)
      const w = bottomRight.x - topLeft.x
      const h = bottomRight.y - topLeft.y
      const isActive = zone.name === activeName

      // 활성 Zone만 연한 green highlight
      if (isActive) {
        ctx.fillStyle = `rgba(${GREEN_RGB}, 0.12)`
        ctx.fillRect(topLeft.x, topLeft.y, w, h)
      }

      // 1px border — 활성은 green, 나머지는 muted gray-green
      ctx.strokeStyle = isActive ? `rgba(${GREEN_RGB}, 0.65)` : ZONE_BORDER
      ctx.lineWidth = 1
      ctx.strokeRect(topLeft.x, topLeft.y, w, h)

      // 좌상단 작은 라벨 (글자 작게, 활성만 진하게)
      const label = zone.name
      ctx.font = `600 7px -apple-system, sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillStyle = isActive ? GREEN : 'rgba(120, 138, 120, 0.65)'
      ctx.fillText(label, topLeft.x + 4, topLeft.y + 4)
    }
  }, [activeZones, worldToCanvas])

  // 폴리라인 유틸
  const strokePolyline = (ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) => {
    if (pts.length < 2) return
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke()
  }

  // ① 지나온 경로 (muted gray-green) — 방문한 Zone 중심을 이은 선
  const drawPastRoute = useCallback((ctx: CanvasRenderingContext2D, meta: MapMeta) => {
    if (!patrolRoute || patrolRoute.length < 2) return
    const pts = patrolRoute
      .map((name) => activeZones.find((z) => z.name === name))
      .filter((z): z is ZoneBounds => !!z)
      .map((z) => worldToCanvas({ x: (z.xMin + z.xMax) / 2, y: (z.yMin + z.yMax) / 2 }, meta))
    if (pts.length < 2) return
    ctx.save()
    ctx.strokeStyle = ROUTE_PAST
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    strokePolyline(ctx, pts)
    ctx.restore()
  }, [patrolRoute, activeZones, worldToCanvas])

  // ② 예정 경로 (medium-opacity green) + ③ 활성 가이던스 (robot→next, dashed primary)
  //    + waypoint 마커 (target만 filled, 나머지 white+green outline)
  const drawMissionRoute = useCallback((ctx: CanvasRenderingContext2D, meta: MapMeta, pose: { x: number; y: number } | null) => {
    if (missionWaypoints.length === 0) return
    const wpCanvas = missionWaypoints.map((w) => worldToCanvas(w, meta))

    // 로봇에서 가장 가까운 waypoint를 "다음 target"으로 간주
    let targetIdx = 0
    if (pose) {
      let best = Infinity
      for (let i = 0; i < missionWaypoints.length; i++) {
        const d = Math.hypot(missionWaypoints[i].x - pose.x, missionWaypoints[i].y - pose.y)
        if (d < best) { best = d; targetIdx = i }
      }
    }

    // 예정 경로 전체 (medium-opacity green)
    ctx.save()
    ctx.strokeStyle = ROUTE_FUTURE
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    strokePolyline(ctx, wpCanvas)
    ctx.restore()

    // 활성 가이던스: robot → next waypoint (dashed primary green)
    if (pose && wpCanvas[targetIdx]) {
      const p = worldToCanvas(pose, meta)
      ctx.save()
      ctx.strokeStyle = GREEN
      ctx.lineWidth = 2.5
      ctx.setLineDash([6, 5])
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(wpCanvas[targetIdx].x, wpCanvas[targetIdx].y)
      ctx.stroke()
      ctx.restore()
    }

    // waypoint 마커 — 작은 원 (지름 ~20px)
    wpCanvas.forEach((p, i) => {
      const isTarget = i === targetIdx
      ctx.beginPath()
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2)
      if (isTarget) {
        ctx.fillStyle = GREEN
        ctx.fill()
      } else {
        ctx.fillStyle = '#ffffff'
        ctx.fill()
        ctx.strokeStyle = GREEN
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      ctx.font = '700 8px -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = isTarget ? '#ffffff' : GREEN
      ctx.fillText(String(i + 1), p.x, p.y + 0.5)
    })
  }, [missionWaypoints, worldToCanvas])

  const redrawMap = useCallback(() => {
    if (!mapMeta || !canvasRef.current || !mapDataRef.current) return
    const ctx = canvasRef.current.getContext('2d')!
    ctx.putImageData(mapDataRef.current, 0, 0)

    // 레이어 순서 (아래→위):
    // Base map(이미 putImageData) → Zone border → Active zone highlight(zone 함수 내) →
    // Past route → Future route + Active guidance + Waypoint → Home/Dock → Robot
    drawZoneOverlays(ctx, mapMeta, activeZoneName)
    drawPastRoute(ctx, mapMeta)
    drawMissionRoute(ctx, mapMeta, robotPose ?? null)

    // Home/Dock 마커 — 로봇 마커와 동일 계열(링+코어)이되 hollow로 구분
    const homePos = missionHome ?? stationPos
    if (homePos) {
      const hp = worldToCanvas(homePos, mapMeta)
      ctx.save()
      // 흰 테두리 링 (로봇 마커와 동일한 대비 처리)
      ctx.beginPath()
      ctx.arc(hp.x, hp.y, 7, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      // 그린 링 (hollow — 로봇은 filled, home은 outline으로 구분)
      ctx.beginPath()
      ctx.arc(hp.x, hp.y, 5.5, 0, Math.PI * 2)
      ctx.strokeStyle = GREEN
      ctx.lineWidth = 2
      ctx.stroke()
      // 중앙 작은 그린 점
      ctx.beginPath()
      ctx.arc(hp.x, hp.y, 2, 0, Math.PI * 2)
      ctx.fillStyle = GREEN
      ctx.fill()
      // 작은 라벨
      ctx.font = '600 7px -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = GREEN
      ctx.fillText('HOME', hp.x, hp.y + 9)
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
  }, [drawPoseEstimate, drawRobot, drawZoneOverlays, drawPastRoute, drawMissionRoute, activeZoneName, missionHome, mapMeta, poseDraft, robotPose, stationPos, zoneDraft, worldToCanvas])

  useEffect(() => {
    if (!ros || status !== 'connected') {
      // 연결 끊기면 Home Zone 초기화 (재연결 시 새로 캡처)
      stationCaptured.current = false
      setStationPos(null)
      return
    }

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
          [r, g, b] = COLOR_UNKNOWN           // 미탐색
        } else if (val === 0) {
          [r, g, b] = COLOR_FREE              // 자유 공간
        } else if (val < 65) {
          // 약한 장애물: free→occupied 보간
          const t = val / 65
          r = Math.round(COLOR_FREE[0] + (COLOR_OCCUPIED[0] - COLOR_FREE[0]) * t)
          g = Math.round(COLOR_FREE[1] + (COLOR_OCCUPIED[1] - COLOR_FREE[1]) * t)
          b = Math.round(COLOR_FREE[2] + (COLOR_OCCUPIED[2] - COLOR_FREE[2]) * t)
        } else {
          // 강한 장애물(벽): occupied→strong 보간
          const t = (val - 65) / 35
          r = Math.round(COLOR_OCCUPIED[0] + (COLOR_STRONG[0] - COLOR_OCCUPIED[0]) * t)
          g = Math.round(COLOR_OCCUPIED[1] + (COLOR_STRONG[1] - COLOR_OCCUPIED[1]) * t)
          b = Math.round(COLOR_OCCUPIED[2] + (COLOR_STRONG[2] - COLOR_OCCUPIED[2]) * t)
        }

        imgData.data[idx] = r
        imgData.data[idx + 1] = g
        imgData.data[idx + 2] = b
        imgData.data[idx + 3] = 255
      }

      ctx.putImageData(imgData, 0, 0)
      mapDataRef.current = imgData
      setHasMap(true)
    })

    return () => mapTopic.unsubscribe()
  }, [ros, status])

  useEffect(() => {
    redrawMap()
  }, [redrawMap])

  // 맵 메타 수신 시 Zone 결정: 저장된 사용자 Zone > 코드 ZONES > 자동 생성
  useEffect(() => {
    if (!mapMeta) return
    const saved = loadSavedZones()
    if (saved.length > 0) {
      setActiveZones(saved)
    } else if (ZONES.length > 0) {
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

  const manualPosePending = initialPoseStatus.state === 'pending'
  const canSetInitialPose = canSetManualInitialPose(
    status === 'connected',
    teleopActive,
    manualPosePending,
  )
  const poseGuardMessage = manualPosePending
    ? '수동 초기화 준비 중입니다. MANUAL_NAV2_READY를 기다리세요.'
    : status !== 'connected'
      ? 'ROS 연결 후 2D Pose를 사용할 수 있습니다.'
      : teleopActive === true
        ? '수동 조종 해제(active=false)를 확인한 뒤 위치를 설정하세요.'
        : '수동 2D Pose는 테스트/복구용입니다. START를 누르면 도크 출발 위치로 다시 자동 초기화됩니다.'

  useEffect(() => {
    onManualPosePendingChange?.(manualPosePending)
  }, [manualPosePending, onManualPosePendingChange])

  useEffect(() => {
    setInitialPoseStatus((current) => {
      if (current.state !== 'pending') return current
      return isNewManualNav2Ready(
        robotStatus,
        robotStatusSequence,
        current.statusSequenceAtSend,
      ) ? { state: 'ready' } : current
    })
  }, [robotStatus, robotStatusSequence])

  useEffect(() => {
    if (canSetInitialPose) return
    setPoseMode(false)
    setPoseDraft(null)
    setDragStart(null)
  }, [canSetInitialPose])

  useEffect(() => {
    if (initialPoseStatus.state !== 'ready') return

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

    setPoseDraft({ ...dragStart, yaw: yawFromDrag(dragStart, current) })
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Zone 편집 완료 → 바로 반영하지 않고 확인/수정 모달을 띄운다
    if (zoneEditMode && zoneDraft) {
      event.currentTarget.releasePointerCapture(event.pointerId)
      const xMin = Math.min(zoneDraft.start.x, zoneDraft.end.x)
      const xMax = Math.max(zoneDraft.start.x, zoneDraft.end.x)
      const yMin = Math.min(zoneDraft.start.y, zoneDraft.end.y)
      const yMax = Math.max(zoneDraft.start.y, zoneDraft.end.y)
      // 너무 작은 영역은 무시
      if (Math.abs(xMax - xMin) > 0.1 && Math.abs(yMax - yMin) > 0.1) {
        const nextLetter = String.fromCharCode(65 + activeZones.length) // A, B, C...
        setPendingZone({
          name: `Zone ${nextLetter}`,
          xMin: xMin.toFixed(2),
          xMax: xMax.toFixed(2),
          yMin: yMin.toFixed(2),
          yMax: yMax.toFixed(2),
        })
      }
      setZoneDraft(null)
      return
    }

    if (!poseMode || !dragStart) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const end = canvasToWorld(event.clientX, event.clientY)
    if (end) setPoseDraft({ ...dragStart, yaw: yawFromDrag(dragStart, end) })
    setDragStart(null)
  }

  const publishInitialPose = () => {
    if (!ros || status !== 'connected' || !poseDraft || !canSetInitialPose) return

    const initialPoseTopic = new ROSLIB.Topic({
      ros,
      name: TOPICS.INITIAL_POSE.name,
      messageType: TOPICS.INITIAL_POSE.messageType,
    })

    initialPoseTopic.publish(buildInitialPoseMessage(poseDraft) as any)

    setPoseMode(false)
    setPoseDraft(null)
    setInitialPoseStatus({
      state: 'pending',
      statusSequenceAtSend: robotStatusSequence,
    })
  }

  const cancelPoseEstimate = () => {
    setPoseMode(false)
    setPoseDraft(null)
    setDragStart(null)
  }

  // 모달에서 확인 → activeZones에 추가 + localStorage 저장
  const confirmPendingZone = () => {
    if (!pendingZone) return
    const xMin = parseFloat(pendingZone.xMin)
    const xMax = parseFloat(pendingZone.xMax)
    const yMin = parseFloat(pendingZone.yMin)
    const yMax = parseFloat(pendingZone.yMax)
    const name = pendingZone.name.trim()
    if (!name || [xMin, xMax, yMin, yMax].some((v) => Number.isNaN(v))) return

    const palette = ['#43C04A', '#6FD173', '#E7A23B', '#5B8DEF', '#8BD98F', '#C7A33B']
    const newZone: ZoneBounds = {
      name,
      xMin: Math.min(xMin, xMax),
      xMax: Math.max(xMin, xMax),
      yMin: Math.min(yMin, yMax),
      yMax: Math.max(yMin, yMax),
      color: palette[activeZones.length % palette.length],
    }
    const updated = [...activeZones, newZone]
    setActiveZones(updated)
    try { localStorage.setItem('ccatfarm_zones', JSON.stringify(updated)) } catch {}
    setPendingZone(null)
  }

  return (
    <div className="ros-map-wrap">
    <div className="ros-map-container">
      {!hasMap && (
        <div className="ros-map-placeholder">
          <div className="ros-map-icon"><Grid3X3 size={28} /></div>
          <p>맵 대기 중</p>
          <p className="ros-map-hint">
            {status === 'connected'
              ? '/map 토픽을 구독하고 있습니다'
              : 'rosbridge 연결 후 /map 토픽을 자동 구독합니다'}
          </p>
        </div>
      )}
      {hasMap && (
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
            disabled={!canSetInitialPose}
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
          {!poseMode && !zoneEditMode && stationPos && (
            <span className="ros-map-tool home" style={{ marginLeft: 'auto', cursor: 'default' }} title="Home / Dock 위치">
              <HomeIcon size={15} />
              <span>Home</span>
              <span className="tool-sub">{stationPos.x.toFixed(1)}, {stationPos.y.toFixed(1)}</span>
            </span>
          )}
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`ros-map-canvas ${poseMode ? 'pose-mode' : ''} ${zoneEditMode ? 'zone-edit-mode' : ''}`}
        style={{ display: hasMap ? 'block' : 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      {hasMap && poseMode && (
        <div className="ros-map-pose-hint">
          클릭은 기본 방향(yaw 0), 드래그는 드래그 방향으로 설정합니다
        </div>
      )}
      {hasMap && poseGuardMessage && !poseMode && (
        <div className="ros-map-pose-guard">
          <Info size={12} />
          <span>{poseGuardMessage}</span>
        </div>
      )}
      {hasMap && zoneEditMode && (
        <div className="ros-map-pose-hint zone-edit-hint">
          드래그로 Zone 영역을 지정하면 확인 창이 열립니다
          {cursorCoord && (
            <span className="cursor-coord">
              커서: X={cursorCoord.x.toFixed(2)}, Y={cursorCoord.y.toFixed(2)}
            </span>
          )}
        </div>
      )}
      {hasMap && initialPoseStatus.state !== 'idle' && !poseMode && (
        <div className={`ros-map-pose-status ${initialPoseStatus.state}`}>
          {initialPoseStatus.state === 'pending' && '2D Pose 전송됨. MANUAL_NAV2_READY 대기 중...'}
          {initialPoseStatus.state === 'ready' && 'MANUAL_NAV2_READY 확인됨. START와 2D Pose를 사용할 수 있습니다.'}
        </div>
      )}
      {hasMap && robotPose && (
        <div className="ros-map-coords">
          X {robotPose.x.toFixed(2)} · Y {robotPose.y.toFixed(2)}
        </div>
      )}
      {hasMap && mapMeta && zoneEditMode && (
        <div className="ros-map-meta">
          맵 범위: X[{mapMeta.origin.x.toFixed(1)} ~ {(mapMeta.origin.x + mapMeta.width * mapMeta.resolution).toFixed(1)}]
          Y[{mapMeta.origin.y.toFixed(1)} ~ {(mapMeta.origin.y + mapMeta.height * mapMeta.resolution).toFixed(1)}]
          | 해상도: {mapMeta.resolution}m/px
        </div>
      )}
    </div>

    {/* 하단 내비게이션 상태 바 — Current Zone / Next Waypoint / Mission Progress */}
    {hasMap && (
      <div className="nav-status-bar">
        <div className="nav-stat">
          <div className="nav-stat-icon zone"><Leaf size={15} /></div>
          <div className="nav-stat-body">
            <span className="nav-stat-label">Current Zone</span>
            <span className="nav-stat-value">{activeZoneName ?? '—'}</span>
          </div>
        </div>
        <div className="nav-stat-divider" />
        <div className="nav-stat">
          <div className="nav-stat-icon wp">
            {navSummary ? navSummary.targetIdx + 1 : <Flag size={14} />}
          </div>
          <div className="nav-stat-body">
            <span className="nav-stat-label">Next Waypoint</span>
            <span className="nav-stat-value">
              {navSummary ? `${navSummary.distance.toFixed(1)} m` : '—'}
            </span>
          </div>
        </div>
        <div className="nav-stat-divider" />
        <div className="nav-stat progress">
          <span className="nav-stat-label">Mission Progress</span>
          <div className="nav-progress-track">
            <div
              className="nav-progress-fill"
              style={{ width: navSummary && navSummary.total > 0 ? `${(navSummary.done / navSummary.total) * 100}%` : '0%' }}
            />
          </div>
          <span className="nav-progress-text">
            {navSummary ? `${navSummary.done} / ${navSummary.total}` : '0 / 0'}
          </span>
        </div>
      </div>
    )}

    {/* Zone 설정 확인/수정 모달 — 드래그 좌표를 수동으로 다듬어 확정 */}
    {pendingZone && (
      <div className="zone-modal-backdrop" onClick={() => setPendingZone(null)}>
        <div className="zone-modal" onClick={(e) => e.stopPropagation()}>
          <div className="zone-modal-head">
            <span>Zone 설정 확인</span>
            <button className="zone-modal-close" onClick={() => setPendingZone(null)}><X size={16} /></button>
          </div>
          <p className="zone-modal-desc">드래그한 영역의 좌표입니다. 필요하면 직접 수정한 뒤 저장하세요.</p>

          <label className="zone-modal-field">
            <span>이름</span>
            <input
              value={pendingZone.name}
              onChange={(e) => setPendingZone({ ...pendingZone, name: e.target.value })}
              placeholder="Zone A"
            />
          </label>

          <div className="zone-modal-grid">
            {(['xMin', 'xMax', 'yMin', 'yMax'] as const).map((k) => (
              <label key={k} className="zone-modal-field">
                <span>{k}</span>
                <input
                  type="number" step="0.1" inputMode="decimal"
                  value={pendingZone[k]}
                  onChange={(e) => setPendingZone({ ...pendingZone, [k]: e.target.value })}
                />
              </label>
            ))}
          </div>

          <div className="zone-modal-actions">
            <button className="btn btn-secondary" onClick={() => setPendingZone(null)}>취소</button>
            <button className="btn btn-primary" onClick={confirmPendingZone}>저장</button>
          </div>
        </div>
      </div>
    )}
    </div>
  )
}
