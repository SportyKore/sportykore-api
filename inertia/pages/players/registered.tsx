import { CompletionClose } from '~/components/players/completion-close'
import { Head } from '@inertiajs/react'
import { publicLayout, RegistrationShell } from '~/components/players/public-registration'

type Props = {
  leagueName: string
  teamName: string | null
  status: string | null
}

export default function Registered({ leagueName, teamName, status }: Props) {
  const pending = status === 'pending'
  const active = status === 'active'
  return (
    <RegistrationShell leagueName={leagueName} teamName={teamName}>
      <Head title="Registration status">
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <div className="registration-success-mark" aria-hidden="true">
        ✓
      </div>
      <h1>
        {pending ? 'You’re on the list.' : active ? 'You’re on the roster.' : 'Registration update'}
      </h1>
      <p className="registration-intro">
        {pending
          ? 'Your registration has been received and is waiting for organizer approval.'
          : active
            ? 'Your player registration is complete. Welcome to the league.'
            : 'Contact your organizer for details about your registration.'}
      </p>
      <dl className="registration-receipt">
        <div>
          <dt>League</dt>
          <dd>{leagueName}</dd>
        </div>
        {teamName && (
          <div>
            <dt>Team</dt>
            <dd>{teamName}</dd>
          </div>
        )}
        <div>
          <dt>Status</dt>
          <dd>
            {pending
              ? 'Pending approval'
              : active
                ? teamName
                  ? 'Active'
                  : 'Awaiting team assignment'
                : (status ?? 'Contact organizer')}
          </dd>
        </div>
      </dl>
      <p className="registration-intro">
        {pending
          ? 'Your organizer will review your details. You don’t need to register again.'
          : 'Your organizer can help with match details and next steps.'}
      </p>
      {(active || pending) && <CompletionClose />}
    </RegistrationShell>
  )
}

Registered.layout = publicLayout
