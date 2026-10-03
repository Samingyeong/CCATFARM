import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import CropDetail from './CropDetail'
import AppHeader from '../components/ui/AppHeader'

// VITE_API_URL이 비어 있으면 상대경로('') 사용 → Vite dev 프록시가 백엔드로 전달
const API_BASE = import.meta.env.VITE_API_URL ?? ''

type Filter = 'All' | 'Normal' | 'Abnormal' | 'Error'
const zoneFilters = ['Zone A', 'Zone B', 'Zone C', 'Zone D', 'Zone E']

interface Condition {
  type: string
  confidence: number
  severity?: string
  description: string
  bbox?: { x: number; y: number; w: number; h: number }
}

interface CropResult {
  id?: number
  source?: string
  zone: string
  status: string
  conditions: Condition[]
  overall: string
  recommendation?: string
  filename?: string
  analyzed_at?: string
  annotationUrl?: string        // 파이프라인 어노테이션 이미지 (/api/annotations/{id})
  camera?: string               // 'left' | 'right'
  runId?: string
  missionId?: string
  captureId?: string
  capturedAt?: string
  pose?: { x: number; y: number; yaw: number; source?: string } | null
}

// 파이프라인 어노테이션 이미지 경로
const cropImageSrc = (c: CropResult): string | undefined =>
  c.annotationUrl ? `${API_BASE}${c.annotationUrl}` : undefined

// AI 분석 요약 한 줄
const summaryLine = (c: CropResult): string => {
  if (c.overall) return c.overall
  if (c.conditions?.length) {
    return Array.from(new Set(c.conditions.map((x) => x.type))).join(', ')
  }
  return c.filename || ''
}

// 대표 신뢰도 (가장 높은 condition)
const topConfidence = (c: CropResult): number | null => {
  if (!c.conditions?.length) return null
  const max = Math.max(...c.conditions.map((x) => x.confidence || 0))
  return Number.isFinite(max) ? max : null
}

export default function Crops() {
  const location = useLocation()
  const navState = location.state as { zone?: string; detailId?: number } | null
  // Home의 zone 행에서 넘어온 경우 해당 zone으로 초기 필터 지정
  const incomingZone = navState?.zone
  // 특정 detection을 바로 상세로 열어야 하는 경우 (알림/데이터 클릭)
  const incomingDetailId = navState?.detailId
  const [filter, setFilter] = useState<Filter>('All')
  const [selectedZones, setSelectedZones] = useState<string[]>(
    incomingZone ? [incomingZone] : []
  )
  const [crops, setCrops] = useState<CropResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedCrop, setSelectedCrop] = useState<CropResult | null>(null)
  const openedDetailRef = useRef<number | null>(null)

  // Home에서 zone 행으로 넘어오면 해당 zone으로 필터 (칩 목록에 없는 zone도 허용)
  useEffect(() => {
    if (incomingZone) {
      setSelectedZones([incomingZone])
      setFilter('All')
    }
  }, [incomingZone])

  const fetchCrops = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_BASE}/api/crops`)
      const data = await res.json()
      setCrops(data.crops || [])
    } catch (e) {
      console.error('작물 데이터 조회 실패:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchCrops() }, [])

  // detailId가 넘어오면 데이터 로드 후 해당 detection의 상세를 바로 연다
  useEffect(() => {
    if (incomingDetailId == null) return
    if (openedDetailRef.current === incomingDetailId) return
    const match = crops.find((c) => c.id === incomingDetailId)
    if (match) {
      openedDetailRef.current = incomingDetailId
      setSelectedCrop(match)
    }
  }, [incomingDetailId, crops])

  if (selectedCrop) {
    return <CropDetail crop={selectedCrop} onBack={() => setSelectedCrop(null)} />
  }

  const toggleZone = (z: string) =>
    setSelectedZones((prev) => prev.includes(z) ? prev.filter((x) => x !== z) : [...prev, z])

  const filtered = crops
    .filter((c) => {
      const statusMatch = filter === 'All' || c.status === filter
      const zoneMatch = selectedZones.length === 0 || selectedZones.includes(c.zone)
      return statusMatch && zoneMatch
    })
    // zone을 여러 개 선택했으면 선택한 순서대로 그룹핑 (A 먼저 → B 순)
    .sort((a, b) => {
      if (selectedZones.length < 2) return 0
      return selectedZones.indexOf(a.zone) - selectedZones.indexOf(b.zone)
    })

  return (
    <div className="page">
      <AppHeader
        title="Crops"
        subtitle="순찰 로봇 AI 작물 진단"
        showBell={false}
        right={
          <button className="header-bell" onClick={fetchCrops} aria-label="새로고침" title="새로고침">
            <RefreshCw size={17} className={loading ? 'spin' : ''} />
          </button>
        }
      />

      {/* 필터 */}
      <div className="crops-filter-bar">
        <div className="status-tabs">
          {(['All', 'Normal', 'Abnormal', 'Error'] as Filter[]).map((f) => (
            <button key={f} className={`status-tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        <div className="zone-chips">
          {zoneFilters.map((z) => (
            <button key={z} className={`zone-chip ${selectedZones.includes(z) ? 'active' : ''}`} onClick={() => toggleZone(z)}>
              {z}
            </button>
          ))}
          {/* 칩 목록에 없는 zone(예: Unknown)으로 필터된 경우 별도 표시 */}
          {selectedZones.filter((z) => !zoneFilters.includes(z)).map((z) => (
            <button key={z} className="zone-chip active" onClick={() => toggleZone(z)}>
              {z} ✕
            </button>
          ))}
        </div>
      </div>

      {/* 결과 목록 */}
      <div className="page-content">
        {loading && <div className="loading-text">로딩 중...</div>}

        {filtered.map((crop, i) => {
          const conf = topConfidence(crop)
          const isAbnormal = crop.status === 'Abnormal'
          const isError = crop.status === 'Error'
          return (
            <div
              key={crop.id ?? i}
              className={`crop-card ${isAbnormal ? 'abnormal' : isError ? 'error' : ''}`}
              onClick={() => setSelectedCrop(crop)}
            >
              <div className="crop-thumb">
                {cropImageSrc(crop) ? (
                  <img
                    src={cropImageSrc(crop)}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  />
                ) : <span className="crop-thumb-empty">No Image</span>}
              </div>

              <div className="crop-info">
                <div className="crop-info-top">
                  <span className="crop-zone">{crop.zone}</span>
                  {crop.camera && <span className="pill">{crop.camera === 'left' ? 'LEFT CAM' : crop.camera === 'right' ? 'RIGHT CAM' : crop.camera}</span>}
                </div>
                <p className="crop-summary">{summaryLine(crop)}</p>
                {conf !== null && <p className="crop-conf">Confidence {Math.round(conf * 100)}%</p>}
                {conf === null && crop.capturedAt && <p className="crop-conf">{crop.capturedAt}</p>}
              </div>

              {isAbnormal ? (
                <AlertTriangle size={20} color="var(--danger)" />
              ) : isError ? (
                <AlertTriangle size={20} color="var(--warning)" />
              ) : (
                <CheckCircle2 size={20} color="var(--success)" />
              )}
            </div>
          )
        })}

        {!loading && filtered.length === 0 && (
          <div className="crop-empty">
            아직 수신된 진단 결과가 없습니다.<br />
            로봇이 순찰하며 이상을 감지하면 자동으로 표시됩니다.
          </div>
        )}
      </div>
    </div>
  )
}
