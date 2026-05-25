import { useCallback } from 'react'
import type { UseRosReturn } from './useRos'
import { TOPICS } from '../config/rosTopics'

declare const ROSLIB: typeof import('roslib')

export type RobotCommand = 'START' | 'HOME' | 'ESTOP'

export function useRobotCommand(
  ros: UseRosReturn['ros'],
  status: UseRosReturn['status'],
) {
  return useCallback((command: RobotCommand) => {
    if (!ros || status !== 'connected') return false

    const topic = new ROSLIB.Topic({
      ros,
      name: TOPICS.ROBOT_COMMAND.name,
      messageType: TOPICS.ROBOT_COMMAND.messageType,
    })

    topic.publish({ data: command } as any)
    return true
  }, [ros, status])
}
