import { Head } from '@inertiajs/react'
import { publicLayout, RegistrationShell } from '~/components/players/public-registration'

type Props = {
  message: string
}

export default function Unavailable({ message }: Props) {
  return (
    <RegistrationShell leagueName="Player registration" teamName={null}>
      <Head title="Invitation unavailable" />
      <h1>This invitation is unavailable.</h1>
      <p className="registration-intro">
        {message || 'This registration link is invalid or has expired.'}
      </p>
      <p className="registration-intro">
        Ask your league or team organizer for a fresh registration link.
      </p>
      <p className="registration-hint">
        You can close this page and return when you have a new link.
      </p>
    </RegistrationShell>
  )
}

Unavailable.layout = publicLayout
