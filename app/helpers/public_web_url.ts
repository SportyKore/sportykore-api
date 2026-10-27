import env from '#start/env'

/** Origin for shareable join/claim pages. Falls back to APP_URL locally. */
export function publicWebOrigin(): string {
  return (env.get('PUBLIC_WEB_URL') ?? env.get('APP_URL')).replace(/\/$/, '')
}

export function publicWebUrl(path: string): string {
  return new URL(path.startsWith('/') ? path : `/${path}`, `${publicWebOrigin()}/`).href
}
