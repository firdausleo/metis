export function toBeijingTime(utcDate, format = 'full') {
  const date = new Date(utcDate)

  if (format === 'full') {
    return date.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }

  if (format === 'date') {
    return date.toLocaleDateString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    })
  }

  if (format === 'time') {
    return date.toLocaleTimeString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }
}

export function isToday(utcDate) {
  const beijing = new Date(
    new Date(utcDate).toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })
  )
  const now = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })
  )
  return beijing.toDateString() === now.toDateString()
}

export function isUpcoming(utcDate) {
  return new Date(utcDate) > new Date()
}
