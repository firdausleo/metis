import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { UserProvider, useUser } from './context/UserContext'
import { useAuth } from './hooks/useAuth'
import NavBar from './components/NavBar'
import LoadingScreen from './components/LoadingScreen'
import Dashboard from './pages/Dashboard'
import Matches from './pages/Matches'
import MatchAnalysis from './pages/MatchAnalysis'
import MatchOdds from './pages/MatchOdds'
import BetRecommendations from './pages/BetRecommendations'
import MyBets from './pages/MyBets'
import Settings from './pages/Settings'
import Auth from './pages/Auth'
import TeamProfile from './pages/TeamProfile'
import ModelPerformance from './pages/ModelPerformance'
import Pending from './pages/Pending'
import AdminUsers from './pages/AdminUsers'
import AdminKnockout from './pages/AdminKnockout'
import FAQ from './pages/FAQ'
import Simulator from './pages/Simulator'
import MetisWizard from './pages/Metis'
import MetisSettings from './pages/MetisSettings'

function ProtectedRoute({ children, adminOnly = false }) {
  const { session, sessionLoading, profile, profileLoading, tier } = useUser()

  if (sessionLoading || profileLoading) return <LoadingScreen />

  if (!session) return <Navigate to="/auth" replace />

  if (!profile || profile.status === 'pending') return <Navigate to="/pending" replace />

  if (profile.status === 'rejected') return <Navigate to="/pending" replace />

  if (adminOnly && tier !== 'admin') return <Navigate to="/" replace />

  return children
}

function Layout({ children }) {
  const location = useLocation()
  const showNav = location.pathname !== '/auth' && location.pathname !== '/pending'
  const { user, signOut } = useAuth()
  const { tier } = useUser()
  const isAdmin = tier === 'admin'

  return (
    <>
      {showNav && <NavBar user={user} isAdmin={isAdmin} onLogout={signOut} />}
      <div className={showNav ? 'app-content' : undefined}>
        {children}
      </div>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <UserProvider>
        <Layout>
          <Routes>
            <Route path="/auth"    element={<Auth />} />
            <Route path="/pending" element={<Pending />} />

            <Route path="/" element={<Navigate to="/metis" replace />} />
            <Route path="/metis" element={<ProtectedRoute><MetisWizard /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/matches" element={<ProtectedRoute><Matches /></ProtectedRoute>} />
            <Route path="/matches/:id" element={<ProtectedRoute><MatchAnalysis /></ProtectedRoute>} />
            <Route path="/matches/:id/odds" element={<ProtectedRoute><MatchOdds /></ProtectedRoute>} />
            <Route path="/matches/:id/bets" element={<ProtectedRoute><BetRecommendations /></ProtectedRoute>} />
            <Route path="/recommendations" element={<ProtectedRoute><BetRecommendations /></ProtectedRoute>} />
            <Route path="/my-bets" element={<ProtectedRoute><MyBets /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/team/:teamCode" element={<ProtectedRoute><TeamProfile /></ProtectedRoute>} />
            <Route path="/model-performance" element={<ProtectedRoute><ModelPerformance /></ProtectedRoute>} />
            <Route path="/faq" element={<ProtectedRoute><FAQ /></ProtectedRoute>} />
            <Route path="/simulator" element={<ProtectedRoute><Simulator /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute adminOnly><AdminUsers /></ProtectedRoute>} />
            <Route path="/admin/knockout" element={<ProtectedRoute adminOnly><AdminKnockout /></ProtectedRoute>} />
            <Route path="/settings/metis" element={<ProtectedRoute adminOnly><MetisSettings /></ProtectedRoute>} />
          </Routes>
        </Layout>
      </UserProvider>
    </BrowserRouter>
  )
}
