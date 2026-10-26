import { Head, useForm } from '@inertiajs/react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { publicLayout, RegistrationShell } from '~/components/players/public-registration'

type Props = {
  token: string
  leagueName: string
  teamName: string | null
  countries: { id: number | string; name: string }[]
  requestId: string
  requiresApproval: boolean
  error?: string
  duplicateName?: boolean
}

type RegistrationData = {
  name: string
  countryId: string
  photo: File | null
  requestId: string
  confirmDuplicate: boolean
}

export default function Register({
  token,
  leagueName,
  teamName,
  countries,
  requestId,
  requiresApproval,
  error,
  duplicateName = false,
}: Props) {
  const form = useForm<RegistrationData>({
    name: '',
    countryId: '',
    photo: null,
    requestId,
    confirmDuplicate: false,
  })
  const feedback = useRef<HTMLDivElement>(null)
  const [submissionError, setSubmissionError] = useState('')
  const hasErrors = Boolean(
    error || duplicateName || submissionError || Object.keys(form.errors).length
  )

  useEffect(() => {
    if (hasErrors) feedback.current?.focus()
  }, [hasErrors, error, duplicateName, form.errors, submissionError])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (form.processing || (duplicateName && !form.data.confirmDuplicate)) return
    if (!form.data.name.trim()) {
      form.setError('name', 'Enter your name.')
      return
    }
    setSubmissionError('')
    form.transform((data) => ({
      ...data,
      name: data.name.trim(),
      requestId: data.requestId,
      confirmDuplicate: duplicateName && data.confirmDuplicate,
    }))
    form.post(`/join/${encodeURIComponent(token)}`, {
      forceFormData: true,
      preserveScroll: true,
      preserveState: true,
      onSuccess: (page) => {
        if (page.component === 'players/register') {
          form.setData('confirmDuplicate', false)
          feedback.current?.focus()
        }
      },
      onError: () => feedback.current?.focus(),
      onFinish: () => feedback.current?.focus(),
      onCancel: () => setSubmissionError('Registration was interrupted. Please try again.'),
    })
  }

  return (
    <RegistrationShell leagueName={leagueName} teamName={teamName}>
      <Head title="Player registration">
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <h1>Get on the roster.</h1>
      <p className="registration-intro">
        {requiresApproval
          ? 'Register your details for the organizer to review.'
          : 'Register your details to join the league.'}{' '}
        No sign-in needed.
      </p>
      <p className="registration-hint">Name and country are required. A photo is optional.</p>
      {hasErrors && (
        <div className="registration-feedback" role="alert" tabIndex={-1} ref={feedback}>
          <strong>
            {duplicateName ? 'Confirm this is a different player' : 'Check your registration'}
          </strong>
          {/* Duplicate feedback is deliberately generic: never echo identifying server details. */}
          <p>
            {duplicateName
              ? 'A player with this name is already registered. If you are registering a different person, confirm below.'
              : error || submissionError || 'Review the highlighted fields and try again.'}
          </p>
          {form.errors.requestId && <p>{form.errors.requestId}</p>}
        </div>
      )}
      <form onSubmit={submit} encType="multipart/form-data" aria-busy={form.processing}>
        <fieldset disabled={form.processing} className="registration-fields">
          <div>
            <label htmlFor="player-name">Player name</label>
            <input
              id="player-name"
              name="name"
              autoComplete="name"
              required
              value={form.data.name}
              onChange={(event) => {
                form.setData((data) => ({
                  ...data,
                  name: event.target.value,
                  confirmDuplicate: false,
                }))
                form.clearErrors('name')
              }}
              aria-invalid={Boolean(form.errors.name)}
              aria-describedby={form.errors.name ? 'name-error' : undefined}
            />
            {form.errors.name && (
              <p id="name-error" className="registration-error">
                {duplicateName
                  ? 'Confirm below if this is a different player with the same name.'
                  : form.errors.name}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="player-country">Country</label>
            <select
              id="player-country"
              name="countryId"
              required
              value={form.data.countryId}
              onChange={(event) => {
                form.setData('countryId', event.target.value)
                form.clearErrors('countryId')
              }}
              aria-invalid={Boolean(form.errors.countryId)}
              aria-describedby={form.errors.countryId ? 'country-error' : undefined}
            >
              <option value="" disabled>
                Select your country
              </option>
              {countries.map((country) => (
                <option key={country.id} value={country.id}>
                  {country.name}
                </option>
              ))}
            </select>
            {form.errors.countryId && (
              <p id="country-error" className="registration-error">
                {form.errors.countryId}
              </p>
            )}
            {countries.length === 0 && (
              <p className="registration-error">
                Countries are unavailable. Please try again later.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="player-photo">
              Player photo <span>(optional)</span>
            </label>
            <input
              id="player-photo"
              name="photo"
              type="file"
              accept="image/*"
              onChange={(event) => {
                form.setData('photo', event.target.files?.[0] ?? null)
                form.clearErrors('photo')
              }}
              aria-invalid={Boolean(form.errors.photo)}
              aria-describedby={form.errors.photo ? 'photo-hint photo-error' : 'photo-hint'}
            />
            <p id="photo-hint" className="registration-hint">
              Choose a clear photo so your organizer can recognize you.
            </p>
            {form.errors.photo && (
              <p id="photo-error" className="registration-error">
                {form.errors.photo}
              </p>
            )}
          </div>
          {duplicateName && (
            <div className="registration-confirm">
              <label htmlFor="confirm-duplicate">
                <input
                  id="confirm-duplicate"
                  name="confirmDuplicate"
                  type="checkbox"
                  required
                  checked={form.data.confirmDuplicate}
                  onChange={(event) => form.setData('confirmDuplicate', event.target.checked)}
                  aria-invalid={Boolean(form.errors.confirmDuplicate)}
                  aria-describedby={form.errors.confirmDuplicate ? 'duplicate-error' : undefined}
                />
                <span>
                  I am registering a different player with the same name. Create a separate player
                  registration.
                </span>
              </label>
              {form.errors.confirmDuplicate && (
                <p id="duplicate-error" className="registration-error">
                  {form.errors.confirmDuplicate}
                </p>
              )}
            </div>
          )}
          <button
            type="submit"
            disabled={countries.length === 0 || (duplicateName && !form.data.confirmDuplicate)}
          >
            {form.processing
              ? 'Registering…'
              : duplicateName
                ? 'Register a different player'
                : 'Register player'}
          </button>
        </fieldset>
        <div role="status" aria-live="polite">
          {form.processing &&
            (form.progress
              ? `Uploading photo: ${form.progress.percentage ?? 0}%`
              : 'Sending your registration…')}
        </div>
      </form>
    </RegistrationShell>
  )
}

Register.layout = publicLayout
