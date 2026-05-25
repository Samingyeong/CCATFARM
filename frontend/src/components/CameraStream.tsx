import { useEffect, useRef, useState } from 'react'
import type { UseRosReturn } from '../hooks/useRos'
import { TOPICS } from '../config/rosTopics'

declare const ROSLIB: typeof import('roslib')

interface CameraStreamProps {
  ros: UseRosReturn['ros']
  status: UseRosReturn['status']
}

const CAMERA_THROTTLE_MS = Number(import.meta.env.VITE_CAMERA_THROTTLE_MS ?? 66)

export default function CameraStream({ ros, status }: CameraStreamProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [hasFrame, setHasFrame] = useState(false)

  useEffect(() => {
    if (!ros || status !== 'connected') {
      setHasFrame(false)
      if (imgRef.current) imgRef.current.removeAttribute('src')
      return
    }

    const topic = new ROSLIB.Topic({
      ros,
      name: TOPICS.CAMERA_COLOR_COMPRESSED.name,
      messageType: TOPICS.CAMERA_COLOR_COMPRESSED.messageType,
      throttle_rate: CAMERA_THROTTLE_MS,
      queue_length: 1,
    } as any)

    topic.subscribe((msg: any) => {
      if (!msg.data || !imgRef.current) return

      imgRef.current.src = `data:image/jpeg;base64,${msg.data}`
      setHasFrame((current) => current || true)
    })

    return () => topic.unsubscribe()
  }, [ros, status])

  return (
    <>
      <img
        ref={imgRef}
        alt="Robot Camera"
        className="camera-stream"
        style={{ display: hasFrame ? 'block' : 'none' }}
      />
      {!hasFrame && (
        <div className="camera-placeholder">
          {status === 'connected' ? '카메라 영상 수신 대기 중...' : 'ROS 연결 대기 중...'}
        </div>
      )}
    </>
  )
}
