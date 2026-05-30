import { useEffect, useState } from 'react'

/**
 * 해가 떠있으면 light, 해가 지면 dark
 * 일출 06:00 ~ 일몰 19:00 기준 (한국 평균)
 */
function getThemeByTime(): 'light' | 'dark' {
  const hour = new Date().getHours()
  return (hour >= 6 && hour < 19) ? 'light' : 'dark'
}

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getThemeByTime)

  useEffect(() => {
    // 초기 적용
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // 매 분마다 시간 체크
  useEffect(() => {
    const interval = setInterval(() => {
      const newTheme = getThemeByTime()
      setTheme((prev) => prev !== newTheme ? newTheme : prev)
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  return { theme, setTheme }
}
