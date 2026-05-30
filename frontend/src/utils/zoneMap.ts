/**
 * 맵 좌표 기반 Zone 판별
 * 로봇의 /amcl_pose 위치(x, y)를 받아 어느 Zone에 있는지 반환
 *
 * Zone 영역은 실제 SLAM 맵 좌표에 맞춰 조정 필요
 * "Zone 설정" 모드에서 드래그로 영역을 잡은 뒤 콘솔 출력값을 여기에 반영하세요.
 * 또는 ZONES를 빈 배열로 두면 RosMap에서 맵 범위 기반 자동 분할을 사용합니다.
 */

export interface ZoneBounds {
  name: string
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  color: string
}

/**
 * 수동 설정된 Zone 목록
 * 비어있으면 RosMap에서 맵 메타데이터 기반 자동 분할 사용
 * "Zone 설정" 모드에서 드래그 후 콘솔에 출력된 좌표를 여기에 붙여넣으세요.
 */
export const ZONES: ZoneBounds[] = []

const ZONE_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4']

/**
 * 맵 메타데이터를 기반으로 Zone을 자동 생성 (3열 x 2행 = 6구역, 마지막은 STATION)
 */
export function generateZonesFromMap(
  originX: number,
  originY: number,
  width: number,
  height: number,
  resolution: number
): ZoneBounds[] {
  const mapXMin = originX
  const mapXMax = originX + width * resolution
  const mapYMin = originY
  const mapYMax = originY + height * resolution

  // 약간의 마진 (맵 가장자리 벽 제외)
  const margin = 0.3
  const xMin = mapXMin + margin
  const xMax = mapXMax - margin
  const yMin = mapYMin + margin
  const yMax = mapYMax - margin

  const cols = 3
  const rows = 2
  const cellW = (xMax - xMin) / cols
  const cellH = (yMax - yMin) / rows

  const names = ['Zone A', 'Zone B', 'Zone C', 'Zone D', 'Zone E', 'Zone F']
  const zones: ZoneBounds[] = []

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      zones.push({
        name: names[idx] ?? `Zone ${idx + 1}`,
        xMin: xMin + c * cellW,
        xMax: xMin + (c + 1) * cellW,
        // 상단 행이 yMax 쪽 (맵에서 위쪽)
        yMin: yMax - (r + 1) * cellH,
        yMax: yMax - r * cellH,
        color: ZONE_COLORS[idx % ZONE_COLORS.length],
      })
    }
  }

  return zones
}

export function getZoneFromPose(x: number, y: number, zones?: ZoneBounds[]): ZoneBounds | null {
  const list = zones && zones.length > 0 ? zones : ZONES
  for (const zone of list) {
    if (x >= zone.xMin && x < zone.xMax && y >= zone.yMin && y < zone.yMax) {
      return zone
    }
  }
  return null
}

export function getZoneName(x: number, y: number, zones?: ZoneBounds[]): string {
  const zone = getZoneFromPose(x, y, zones)
  return zone ? zone.name : 'Unknown'
}
