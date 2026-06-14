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
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
  }
}

export function isToday(utcDate) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })
  return fmt.format(new Date(utcDate)) === fmt.format(new Date())
}

export function isUpcoming(utcDate) {
  return new Date(utcDate) > new Date()
}
