import { CompletionClose } from '~/components/players/completion-close'
import { Head } from '@inertiajs/react'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { publicLayout, RegistrationShell } from '~/components/players/public-registration'

type Props = { token: string; available: boolean }
type ApiResult = {
  message?: string
  requiresSignup?: boolean
  data?: { auth?: { token?: { value?: string } }; playerId?: number }
}

export default function Claim({ token, available }: Props) {
  const accessToken = useRef<string | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'signup' | 'code' | 'confirm' | 'done'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function post(path: string, body: object, bearer?: string): Promise<ApiResult> {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    })
    if (response.status === 204) return {}
    const result = (await response.json()) as ApiResult
    if (response.status === 428 && result.requiresSignup) {
      setStep('signup')
      return result
    }
    if (!response.ok) throw new Error(result.message || 'Unable to continue. Please try again.')
    return result
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (step === 'email' || step === 'signup') {
        const result = await post('/api/v1/auth/request-otp', {
          email,
          ...(step === 'signup' ? { name } : {}),
        })
        if (!result.requiresSignup) setStep('code')
      } else if (step === 'code') {
        const result = await post('/api/v1/auth/verify-otp', { email, code })
        const bearer = result.data?.auth?.token?.value
        if (!bearer) throw new Error('Sign-in could not be completed. Please try again.')
        accessToken.current = bearer
        setCode('')
        setStep('confirm')
      } else if (step === 'confirm' && accessToken.current) {
        await post(
          `/api/v1/player-claims/${encodeURIComponent(token)}/redeem`,
          {},
          accessToken.current
        )
        const bearer = accessToken.current
        accessToken.current = null
        setStep('done')
        // Best-effort revocation of the temporary browser login after a successful claim.
        void post('/api/v1/auth/logout', {}, bearer).catch(() => {})
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <RegistrationShell
      leagueName="Your player profile"
      teamName={null}
      footer="Your game. Your team. Your SportyKore."
    >
      <Head title="Claim your player profile">
        <meta name="referrer" content="no-referrer" />
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <section aria-labelledby="claim-heading">
        {step === 'done' && (
          <div className="registration-success-mark" aria-hidden="true">
            ✓
          </div>
        )}
        <h1 id="claim-heading">
          {!available
            ? 'This link is unavailable'
            : step === 'done'
              ? 'Your profile is linked'
              : 'Claim your player profile'}
        </h1>
        {!available ? (
          <p>
            This link has expired, been replaced, or already been used. Ask your league or team
            administrator for a new link.
          </p>
        ) : step === 'done' ? (
          <div role="status">
            <p className="registration-intro">
              Your player profile, match history, and stats are now linked to your account.
            </p>
            <p className="registration-intro">
              Sign in to the SportyKore app with <strong>{email}</strong> to continue. Don’t have
              the app yet? Download it below.
            </p>
            <a className="registration-action" href="https://sportykore.com/download">
              Download SportyKore
            </a>
            <CompletionClose />
          </div>
        ) : (
          <>
            <p>
              Connect the player profile your administrator created to your account. Your match
              history and stats stay together.
            </p>
            <form onSubmit={submit} aria-busy={busy}>
              {(step === 'email' || step === 'signup') && (
                <label>
                  Email address
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                  />
                </label>
              )}
              {step === 'signup' && (
                <>
                  <p>Let’s create your account first.</p>
                  <label>
                    Your name
                    <input
                      autoComplete="name"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                </>
              )}
              {step === 'code' && (
                <>
                  <p>Enter the six-digit code sent to {email}.</p>
                  <label>
                    Verification code
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                </>
              )}
              {step === 'confirm' && (
                <p>
                  Signed in as <strong>{email}</strong>. Only continue if this link was issued for
                  your player profile. Accounts with an existing player profile cannot claim
                  another.
                </p>
              )}
              {error && <p role="alert">{error}</p>}
              <button disabled={busy} type="submit">
                {busy
                  ? 'Please wait…'
                  : step === 'confirm'
                    ? 'Claim my profile'
                    : step === 'code'
                      ? 'Verify and continue'
                      : 'Send verification code'}
              </button>
              {step === 'code' && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setCode('')
                    setError('')
                    setStep('email')
                  }}
                >
                  Change email or request another code
                </button>
              )}
            </form>
            <p>
              <small>Claim links expire after 48 hours and can only be used once.</small>
            </p>
          </>
        )}
      </section>
    </RegistrationShell>
  )
}

Claim.layout = publicLayout
