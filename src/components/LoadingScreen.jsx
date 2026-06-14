export default function LoadingScreen() {
  return (
    <>
      <style>{`
        @keyframes metis-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .loading-screen {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #FAFAF8;
        }
        .loading-wordmark {
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 32px;
          font-weight: 600;
          letter-spacing: 0.15em;
          color: #C9A84C;
          animation: metis-pulse 1.5s ease-in-out infinite;
        }
      `}</style>
      <div className="loading-screen">
        <div className="loading-wordmark">METIS</div>
      </div>
    </>
  )
}
