interface CropHealthDonutProps {
  normal: number
  abnormal: number
  size?: number
}

/** 작물 건강도 SVG 도넛. 중앙에 건강도 % 표시 */
export default function CropHealthDonut({ normal, abnormal, size = 108 }: CropHealthDonutProps) {
  const total = normal + abnormal
  const R = 46
  const C = 2 * Math.PI * R
  const healthRatio = total > 0 ? normal / total : 0
  const pct = Math.round(healthRatio * 100)

  return (
    <div className="donut-wrap" style={{ width: size, height: size }}>
      <svg viewBox="0 0 108 108" width={size} height={size}>
        {/* 트랙(이상=빨강, 데이터 없으면 연한 회녹색) */}
        <circle cx="54" cy="54" r={R} fill="none" stroke={total > 0 ? '#E75858' : '#E4F7E5'} strokeWidth="11" />
        {/* 정상(초록) 비율 */}
        {total > 0 && (
          <circle
            cx="54" cy="54" r={R} fill="none" stroke="#43C04A" strokeWidth="11"
            strokeDasharray={`${C * healthRatio} ${C}`}
            transform="rotate(-90 54 54)"
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="donut-label">
        <span className="donut-num">{total > 0 ? `${pct}%` : '--'}</span>
        <span className="donut-sub">Healthy</span>
      </div>
    </div>
  )
}
