import { useState } from 'react'
import { ArrowLeft, Maximize2, AlertTriangle, CheckCircle2 } from 'lucide-react'

interface Condition {
  type: string
  confidence: number
  severity?: string
  description: string
  bbox?: { x: number; y: number; w: number; h: number }
}

interface CropResult {
  id?: number
  zone: string
  status: string
  conditions: Condition[]
  overall: string
  recommendation?: string
  filename?: string
  analyzed_at?: string
  annotationUrl?: string
  camera?: string
  runId?: string
  captureId?: string
  capturedAt?: string
  pose?: { x: number; y: number; yaw: number; source?: string } | null
}

interface CropDetailProps {
  crop: CropResult
  onBack: () => void
}

const API_BASE = import.meta.env.VITE_API_URL ?? ''

const CONDITION_LABELS: Record<string, string> = {
  chlorosis: 'Chlorosis (황화)',
  insect_hole: 'Insect Damage (해충)',
  leaf: 'Leaf (정상 잎)',
  normal: 'Normal',
}

const SEVERITY_LABELS: Record<string, { text: string; cls: string }> = {
  high: { text: 'High Risk', cls: 'high' },
  medium: { text: 'Caution', cls: 'medium' },
  low: { text: 'Mild', cls: 'low' },
}

const isAbnormalClass = (type: string) => type === 'insect_hole' || type === 'chlorosis'

/**
 * severity 결정: 백엔드가 severity를 주면 그대로, 없으면 신뢰도로 산출.
 * 정상(leaf/normal)은 severity 배지를 띄우지 않으므로 null 반환.
 * 이상 클래스는 confidence 0.8↑ High, 0.5~0.8 Caution, 그 미만 Mild.
 */
function resolveSeverity(type: string, confidence: number, given?: string) {
  if (!isAbnormalClass(type)) return null
  const key = given && SEVERITY_LABELS[given]
    ? given
    : confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low'
  return SEVERITY_LABELS[key]
}

export default function CropDetail({ crop, onBack }: CropDetailProps) {
  const [imageZoom, setImageZoom] = useState(false)

  const isAbnormal = crop.status === 'Abnormal'
  const imgSrc = crop.annotationUrl ? `${API_BASE}${crop.annotationUrl}` : undefined

  return (
    <div className="page">
      <div className="detail-header">
        <button className="detail-back" onClick={onBack}><ArrowLeft size={18} /></button>
        <h1>진단 상세</h1>
      </div>

      {/* 요약 */}
      <div className="detail-section">
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isAbnormal ? <AlertTriangle size={18} color="var(--danger)" /> : <CheckCircle2 size={18} color="var(--success)" />}
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                {crop.zone} · {isAbnormal ? '이상 감지' : '정상'}
              </span>
            </div>
            {crop.camera && <span className="pill">{crop.camera === 'left' ? 'LEFT CAM' : crop.camera === 'right' ? 'RIGHT CAM' : crop.camera}</span>}
          </div>
          {crop.overall && <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.5 }}>{crop.overall}</p>}
        </div>
      </div>

      {/* 어노테이션 이미지 */}
      <div className="detail-section">
        <p className="detail-section-title">Annotation</p>
        <div className="detail-image-wrap">
          {imgSrc ? (
            <>
              <img src={imgSrc} alt="분석 이미지" onClick={() => setImageZoom(true)} style={{ cursor: 'pointer' }} />
              <button className="detail-expand" onClick={() => setImageZoom(true)}><Maximize2 size={13} /> Expand</button>
            </>
          ) : <div className="detail-image-empty">이미지 없음</div>}
        </div>
        <div className="detail-meta-row">
          <span>촬영: {crop.capturedAt || crop.analyzed_at || '-'}</span>
          <span>구역: {crop.zone}</span>
          {crop.runId && <span>run: {crop.runId}</span>}
          {crop.pose && <span>pose: ({crop.pose.x.toFixed(2)}, {crop.pose.y.toFixed(2)})</span>}
        </div>
      </div>

      {/* AI 분석 */}
      <div className="detail-section">
        <p className="detail-section-title">AI Analysis</p>
        {crop.conditions?.map((cond, i) => {
          const sev = resolveSeverity(cond.type, cond.confidence ?? 0, cond.severity)
          const conf = typeof cond.confidence === 'number' ? Math.round(cond.confidence * 100) : null
          return (
            <div key={i} className={`diagnosis-card ${cond.type}`}>
              <div className="diagnosis-top">
                <span className="diagnosis-name">{CONDITION_LABELS[cond.type] || cond.type}</span>
                {sev && <span className={`severity-badge ${sev.cls}`}>{sev.text}</span>}
              </div>
              {cond.description && <p className="diagnosis-desc">{cond.description}</p>}
              {conf !== null && (
                <div className="conf-row">
                  <div className="conf-bar"><div className="conf-fill" style={{ width: `${conf}%` }} /></div>
                  <span className="conf-text">{conf}% Confidence</span>
                </div>
              )}
            </div>
          )
        })}

        {crop.overall && (
          <div className="detail-overall">
            <div className="detail-overall-label">종합 소견</div>
            <div className="detail-overall-text">{crop.overall}</div>
          </div>
        )}
      </div>

      {imageZoom && imgSrc && (
        <div className="image-modal" onClick={() => setImageZoom(false)}>
          <img src={imgSrc} />
        </div>
      )}
    </div>
  )
}
