/**
 * Mock ROS — 실제 로봇/rosbridge 없이 지도·위치·상태를 흉내 내는 가짜 Ros 객체.
 * 디자인/UI 확인 전용. 기본은 꺼져 있고 VITE_MOCK_ROS=1 일 때만 활성화된다.
 *
 * 사용: `npm run dev:mock` (포트 5174, mock 켜짐)
 *       `npm run dev`      (실제 데이터, mock 꺼짐)
 *
 * ROSLIB.Topic은 내부적으로 `ros.on(topicName, cb)`로 메시지를 수신하고
 * 구독 시 `ros.callOnConnection(...)`을 호출한다. 여기서는 그 둘을 가짜로 구현해
 * 실제 ROSLIB.Topic / 기존 훅 코드를 그대로 동작시킨다.
 */

type Listener = (msg: any) => void

class MockRos {
  private listeners = new Map<string, Set<Listener>>()
  private timers: number[] = []
  isConnected = true
  idCounter = 0

  constructor() {
    // 연결 이벤트를 다음 틱에 발생 (useRos가 'connection' 리스너를 걸 시간 확보)
    setTimeout(() => this.emit('connection', {}), 0)
    this.startPublishing()
  }

  on(eventName: string, cb: Listener) {
    if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set())
    this.listeners.get(eventName)!.add(cb)
  }

  off(eventName: string, cb?: Listener) {
    if (!cb) { this.listeners.delete(eventName); return }
    this.listeners.get(eventName)?.delete(cb)
  }

  emit(eventName: string, msg: any) {
    this.listeners.get(eventName)?.forEach((cb) => {
      try { cb(msg) } catch (e) { console.error('[MockRos] listener error', eventName, e) }
    })
  }

  // ROSLIB.Topic.subscribe / advertise 가 호출
  callOnConnection() { /* no-op: 이미 연결된 것으로 간주 */ }

  close() {
    this.timers.forEach((t) => window.clearInterval(t))
    this.timers = []
    this.isConnected = false
    this.emit('close', {})
  }
  connect() { /* no-op */ }

  // ── 더미 데이터 퍼블리시 ──
  private startPublishing() {
    const yawOf = (t: number) => Math.sin(t / 6) * Math.PI

    // 지도: 구독 타이밍을 놓치지 않도록 2초마다 재발행 (정적 OccupancyGrid)
    const mapMsg = buildMockMap()
    const mapTimer = window.setInterval(() => this.emit('/map', mapMsg), 2000)
    this.timers.push(mapTimer)
    setTimeout(() => this.emit('/map', mapMsg), 100)

    // 로봇 위치: 맵 안에서 원을 그리며 이동
    let t = 0
    const poseTimer = window.setInterval(() => {
      t += 1
      const radius = 1.6
      const x = Math.cos(t / 10) * radius
      const y = Math.sin(t / 10) * radius
      const yaw = yawOf(t) + t / 10 + Math.PI / 2
      const qz = Math.sin(yaw / 2)
      const qw = Math.cos(yaw / 2)
      const poseMsg = {
        header: { frame_id: 'map' },
        pose: {
          pose: {
            position: { x, y, z: 0 },
            orientation: { x: 0, y: 0, z: qz, w: qw },
          },
          covariance: new Array(36).fill(0),
        },
      }
      this.emit('/robot_pose', poseMsg)
      this.emit('/amcl_pose', poseMsg)
    }, 500)
    this.timers.push(poseTimer)

    // 미션 경로(waypoint) + home — 전체 순찰 경로 시각화 확인용
    const missionRoute = JSON.stringify({
      home: { x: -2.0, y: -1.5 },
      points: [
        { x: -1.2, y: 1.0, name: 'WP1' },
        { x: 1.0, y: 1.4, name: 'WP2' },
        { x: 1.6, y: -0.6, name: 'WP3' },
        { x: -0.4, y: -1.4, name: 'WP4' },
      ],
    })

    // 상태 토픽들: 구독 타이밍 보장 위해 주기적으로 재발행
    const emitStatus = () => {
      this.emit('/robot_pose_status', { data: 'AMCL (MOCK)' })
      this.emit('/robot_status', { data: 'IDLE' })
      this.emit('/web_teleop/status', { data: 'SAFE' })
      this.emit('/web_teleop/active', { data: false })
      this.emit('/mission_route_points', { data: missionRoute })
    }
    const statusTimer = window.setInterval(emitStatus, 2000)
    this.timers.push(statusTimer)
    setTimeout(emitStatus, 100)

    // 배터리: 천천히 변하는 값
    let soc = 0.78
    const battTimer = window.setInterval(() => {
      soc = Math.max(0.2, soc - 0.001)
      this.emit('/battery_state', {
        percentage: soc,
        voltage: 24 + soc * 1.5,
        current: -1.2,
        power_supply_status: 2,
      })
      this.emit('/sk120/voltage_out', { data: 24 + soc * 1.5 })
    }, 2000)
    this.timers.push(battTimer)
  }
}

// 2D OccupancyGrid 더미: 테두리 벽 + 내부 몇 개 장애물
function buildMockMap() {
  const width = 160
  const height = 120
  const resolution = 0.05
  const data = new Array(width * height).fill(0)

  const set = (col: number, row: number, v: number) => {
    if (col < 0 || col >= width || row < 0 || row >= height) return
    data[row * width + col] = v
  }

  for (let c = 0; c < width; c++) { set(c, 0, 100); set(c, height - 1, 100) }
  for (let r = 0; r < height; r++) { set(0, r, 100); set(width - 1, r, 100) }
  for (let r = 30; r < 45; r++) for (let c = 40; c < 55; c++) set(c, r, 100)
  for (let r = 70; r < 90; r++) for (let c = 100; c < 120; c++) set(c, r, 100)

  const origin = {
    position: { x: -(width * resolution) / 2, y: -(height * resolution) / 2, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  }

  return {
    header: { frame_id: 'map' },
    info: { width, height, resolution, origin },
    data,
  }
}

export function createMockRos(): any {
  return new MockRos()
}

export const MOCK_ROS_ENABLED = import.meta.env.VITE_MOCK_ROS === '1'
