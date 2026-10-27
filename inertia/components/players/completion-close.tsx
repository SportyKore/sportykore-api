import { useEffect, useState } from 'react'

/** Browsers may refuse to close tabs that were opened outside JavaScript. */
export function CompletionClose() {
  const [attempted, setAttempted] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAttempted(true)
      window.close()
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <p className="registration-hint" role="status">
      {attempted
        ? 'All done. If this tab is still open, you can close it safely.'
        : 'All done. This tab will try to close automatically in 5 seconds.'}{' '}
      <a href="https://sportykore.com" rel="noreferrer">
        Visit SportyKore
      </a>
    </p>
  )
}
