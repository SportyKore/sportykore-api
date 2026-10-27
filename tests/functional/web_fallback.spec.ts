import { test } from '@japa/runner'
import env from '#start/env'

const url = (path: string) => new URL(path, env.get('APP_URL')).href

test.group('Public website fallback', () => {
  test('redirects root and unknown web pages to the website', async ({ assert }) => {
    for (const path of ['/', '/test', '/unknown/nested']) {
      const response = await fetch(url(path), {
        headers: { Accept: 'text/html' },
        redirect: 'manual',
      })
      assert.equal(response.status, 302)
      assert.equal(response.headers.get('location'), 'https://sportykore.com')
    }
  })

  test('preserves missing API and asset errors', async ({ assert }) => {
    for (const path of ['/api/v1/not-a-route', '/images/missing.png']) {
      const response = await fetch(url(path), {
        headers: { Accept: 'text/html' },
        redirect: 'manual',
      })
      assert.equal(response.status, 404)
      assert.isNull(response.headers.get('location'))
    }
    const json = await fetch(url('/test'), {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
    })
    assert.equal(json.status, 404)
    const health = await fetch(url('/health'))
    assert.equal(health.status, 200)
  })
})
