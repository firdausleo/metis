import { useState, useEffect } from 'react'

const translations = {
  en: {
    'nav.dashboard': 'Dashboard',
    'nav.matches': 'Matches',
    'nav.myBets': 'My Bets',
    'nav.settings': 'Settings',
    'nav.logout': 'Logout',
    'auth.login': 'Login',
    'auth.signup': 'Sign Up',
    'auth.createAccount': 'Create Account',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.subtitle': 'World Cup 2026 · Bet Intelligence',
    'auth.noAccount': "Don't have an account?",
    'auth.hasAccount': 'Already have an account?',
    'auth.error.invalid': 'Invalid email or password',
    'auth.error.signup': 'Could not create account. Try a different email.',
    'common.loading': 'Loading...',
    'common.error': 'Something went wrong',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'dashboard.welcome': 'Welcome to Metis',
    'dashboard.coming': 'World Cup 2026 analysis coming soon',
    'dashboard.matchesAnalyzed': 'Matches Analyzed',
    'dashboard.activeBets': 'Active Bets',
    'dashboard.totalPnl': 'Total P&L',
    'matches.title': 'Matches',
    'matches.today': "Today's Matches",
    'matches.groupStage': 'Group Stage',
    'matches.knockout': 'Knockout Stage',
    'matches.noToday': 'No matches today',
    'matches.analyze': 'Analyze',
    'matches.filter.all': 'All',
    'matches.filter.group': 'Groups',
    'matches.filter.knockout': 'Knockout',
    'matches.tbd': 'TBD',
    'matches.r32': 'Round of 32',
    'matches.r16': 'Round of 16',
    'matches.qf': 'Quarter Final',
    'matches.sf': 'Semi Final',
    'matches.final': 'Final',
    'match.upcoming': 'Upcoming',
    'match.live': 'Live',
    'match.completed': 'Completed',
    'match.analyzed': 'Analyzed',
    'match.today': 'Today',
    'match.tbdTeam': 'TBD',
  },
  zh: {
    'nav.dashboard': '首页',
    'nav.matches': '赛程',
    'nav.myBets': '我的投注',
    'nav.settings': '设置',
    'nav.logout': '退出',
    'auth.login': '登录',
    'auth.signup': '注册',
    'auth.createAccount': '创建账户',
    'auth.email': '邮箱',
    'auth.password': '密码',
    'auth.subtitle': 'World Cup 2026 · 投注智能',
    'auth.noAccount': '没有账户？',
    'auth.hasAccount': '已有账户？',
    'auth.error.invalid': '邮箱或密码错误',
    'auth.error.signup': '无法创建账户，请尝试其他邮箱。',
    'common.loading': '加载中...',
    'common.error': '出错了',
    'common.save': '保存',
    'common.cancel': '取消',
    'dashboard.welcome': '欢迎使用 Metis',
    'dashboard.coming': 'World Cup 2026 分析即将上线',
    'dashboard.matchesAnalyzed': '已分析赛事',
    'dashboard.activeBets': '进行中投注',
    'dashboard.totalPnl': '总盈亏',
    'matches.title': '赛程',
    'matches.today': '今日赛事',
    'matches.groupStage': '小组赛',
    'matches.knockout': '淘汰赛',
    'matches.noToday': '今日无赛事',
    'matches.analyze': '分析',
    'matches.filter.all': '全部',
    'matches.filter.group': '小组',
    'matches.filter.knockout': '淘汰',
    'matches.tbd': '待定',
    'matches.r32': '32强',
    'matches.r16': '16强',
    'matches.qf': '四分之一决赛',
    'matches.sf': '半决赛',
    'matches.final': '决赛',
    'match.upcoming': '未开始',
    'match.live': '进行中',
    'match.completed': '已结束',
    'match.analyzed': '已分析',
    'match.today': '今日',
    'match.tbdTeam': '待定',
  },
}

export function setLanguage(lang) {
  localStorage.setItem('lang', lang)
  window.dispatchEvent(new Event('langchange'))
}

export function useTranslation() {
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'en')

  useEffect(() => {
    const handler = () => setLang(localStorage.getItem('lang') || 'en')
    window.addEventListener('langchange', handler)
    return () => window.removeEventListener('langchange', handler)
  }, [])

  function t(key) {
    return translations[lang]?.[key] ?? translations['en'][key] ?? key
  }

  return { t, lang }
}
