import { useState, useEffect } from 'react'

const translations = {
  en: {
    'nav.dashboard': 'Dashboard',
    'nav.matches': 'Matches',
    'nav.myBets': 'My Bets',
    'nav.settings': 'Settings',
    'auth.login': 'Login',
    'auth.signup': 'Sign Up',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'common.loading': 'Loading...',
    'common.error': 'Something went wrong',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
  },
  zh: {
    'nav.dashboard': '首页',
    'nav.matches': '赛程',
    'nav.myBets': '我的投注',
    'nav.settings': '设置',
    'auth.login': '登录',
    'auth.signup': '注册',
    'auth.email': '邮箱',
    'auth.password': '密码',
    'common.loading': '加载中...',
    'common.error': '出错了',
    'common.save': '保存',
    'common.cancel': '取消',
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
