import type { ReactElement, ReactNode } from 'react'
import './registration.css'

export function publicLayout(page: ReactElement) {
  return page
}

export function RegistrationShell({
  leagueName,
  teamName,
  children,
  footer = 'Player registration · No account needed',
}: {
  leagueName: string
  teamName: string | null
  children: ReactNode
  footer?: string
}) {
  return (
    <div className="player-registration">
      <div className="registration-sheet">
        <header className="registration-header">
          <div className="registration-logo">
            <img src="/images/sportykore-logo.png" alt="SportyKore" width="80" height="80" />
          </div>
          <p className="registration-league">{leagueName}</p>
          {teamName && <p className="registration-team">Team: {teamName}</p>}
        </header>
        <main className="registration-main">{children}</main>
        <footer className="registration-footer">{footer}</footer>
      </div>
    </div>
  )
}
