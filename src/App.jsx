import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Dashboard from './pages/Dashboard'
import Matches from './pages/Matches'
import MatchAnalysis from './pages/MatchAnalysis'
import MatchOdds from './pages/MatchOdds'
import BetRecommendations from './pages/BetRecommendations'
import MyBets from './pages/MyBets'
import Settings from './pages/Settings'
import Auth from './pages/Auth'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <span style={{ color: 'var(--color-text-secondary)' }}>Loading...</span>
      </div>
    )
  }

  if (!user) return <Navigate to="/auth" replace />

  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/matches" element={<ProtectedRoute><Matches /></ProtectedRoute>} />
        <Route path="/matches/:id" element={<ProtectedRoute><MatchAnalysis /></ProtectedRoute>} />
        <Route path="/matches/:id/odds" element={<ProtectedRoute><MatchOdds /></ProtectedRoute>} />
        <Route path="/matches/:id/bets" element={<ProtectedRoute><BetRecommendations /></ProtectedRoute>} />
        <Route path="/my-bets" element={<ProtectedRoute><MyBets /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  )
}
