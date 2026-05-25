import { useEffect, useState } from 'react'
import type { UseRosReturn } from './useRos'
import { TOPICS } from '../config/rosTopics'

declare const ROSLIB: typeof import('roslib')

/**
 * /camera/camera/color/image_raw/compressed 구독
 * base64 인코딩된 JPEG 이미지를 반환
 */
export function useCamera(
  ros: UseRosReturn['ros'],
  status: UseRosReturn['status'],
): string | null {
  const [imageSrc, setImageSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!ros || status !== 'connected') return

    const topic = new ROSLIB.Topic({
      ros,
      name: TOPICS.CAMERA_COLOR_COMPRESSED.name,
      messageType: TOPICS.CAMERA_COLOR_COMPRESSED.messageType,
    })

    topic.subscribe((msg: any) => {
      // rosbridge는 data를 base64 문자열로 전달
      if (msg.data) {
        setImageSrc(`data:image/jpeg;base64,${msg.data}`)
      }
    })

    return () => topic.unsubscribe()
  }, [ros, status])

  return imageSrc
}
