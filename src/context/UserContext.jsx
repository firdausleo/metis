import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const UserContext = createContext(null)

export function UserProvider({ children }) {
  const [session, setSession] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)

  const fetchProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      setProfileLoading(false)
      return
    }
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    setProfile(data ?? null)
    setProfileLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setSessionLoading(false)
      setProfileLoading(true)
      fetchProfile(s?.user?.id)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setProfileLoading(true)
      fetchProfile(s?.user?.id)
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  const refreshProfile = useCallback(async () => {
    setProfileLoading(true)
    await fetchProfile(session?.user?.id)
  }, [session, fetchProfile])

  return (
    <UserContext.Provider value={{
      session,
      profile,
      tier: profile?.tier ?? 'standard',
      status: profile?.status ?? 'pending',
      credits: profile?.credits_remaining ?? 0,
      sessionLoading,
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
