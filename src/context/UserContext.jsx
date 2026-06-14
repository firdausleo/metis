import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const UserContext = createContext(null)

export function UserProvider({ children }) {
  const { user, loading: authLoading } = useAuth()
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)

  const refreshProfile = useCallback(async () => {
    if (!user) {
      setProfile(null)
      setProfileLoading(false)
      return
    }
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    setProfile(data || null)
    setProfileLoading(false)
  }, [user])

  useEffect(() => {
    if (authLoading) return
    setProfileLoading(true)
    refreshProfile()
  }, [authLoading, refreshProfile])

  return (
    <UserContext.Provider value={{
      profile,
      tier: profile?.tier ?? null,
      credits: profile?.credits_remaining ?? 0,
      status: profile?.status ?? null,
      profileLoading,
      refreshProfile,
    }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  return useContext(UserContext)
}
