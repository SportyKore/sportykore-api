import { test } from '@japa/runner'
import env from '#start/env'
import { publicWebOrigin, publicWebUrl } from '#helpers/public_web_url'

test.group('publicWebUrl', () => {
  test('falls back to APP_URL and builds join/claim links', ({ assert }) => {
    const origin = (env.get('PUBLIC_WEB_URL') ?? env.get('APP_URL')).replace(/\/$/, '')
    assert.equal(publicWebOrigin(), origin)
    assert.equal(publicWebUrl('/join/abc'), `${origin}/join/abc`)
    assert.equal(publicWebUrl('claim/def'), `${origin}/claim/def`)
  })
})
