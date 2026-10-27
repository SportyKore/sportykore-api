import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import env from '#start/env'
import { publicWebUrl } from '#helpers/public_web_url'
import User from '#models/user'
import Country from '#models/country'
import League from '#models/league'
import Season from '#models/season'
import Team from '#models/team'
import TeamAdmin from '#models/team_admin'
import Invite from '#models/invite'
import Player from '#models/player'
import LeaguePlayer from '#models/league_player'
import { withFreshDatabaseAndCountries } from '../helpers/migration.js'

const url = (path: string) => new URL(path, env.get('APP_URL')).href
const json = { 'Content-Type': 'application/json', 'Accept': 'application/json' }
async function fixture() {
  const [owner, admin] = await User.createMany([
    { email: 'http-owner@test.com' },
    { email: 'http-admin@test.com' },
  ])
  const access = await User.accessTokens.create(owner)
  const adminAccess = await User.accessTokens.create(admin)
  const country = await Country.findByOrFail('code', 'ng')
  const league = await League.create({
    name: 'HTTP League',
    userId: owner.id,
    countryId: country.id,
  })
  const season = await Season.create({ name: 'Current', leagueId: league.id, status: 'active' })
  const team = await Team.create({ name: 'HTTP Team', leagueId: league.id, addedBy: owner.id })
  await TeamAdmin.create({
    teamId: team.id,
    leagueId: league.id,
    userId: admin.id,
    assignedBy: owner.id,
  })
  const invite = await Invite.create({
    token: randomUUID(),
    leagueId: league.id,
    seasonId: season.id,
    teamId: null,
    invitedUserId: null,
    status: 'pending',
    expiresAt: DateTime.utc().plus({ days: 1 }),
  })
  return {
    owner,
    admin,
    country,
    league,
    season,
    team,
    invite,
    headers: { ...json, Authorization: `Bearer ${access.value!.release()}` },
    adminHeaders: { ...json, Authorization: `Bearer ${adminAccess.value!.release()}` },
  }
}

test.group('Roster and registration HTTP routes', (group) => {
  withFreshDatabaseAndCountries(group)
  test('mobile contracts cover add, settings, pool assignment, and claim sharing', async ({
    assert,
  }) => {
    const f = await fixture()
    const base = `/api/v1/roster/${f.league.id}/${f.season.id}`
    const unauthenticated = await fetch(url(base), { headers: json })
    assert.equal(unauthenticated.status, 401)
    const created = await fetch(url(`${base}/players`), {
      method: 'POST',
      headers: f.headers,
      body: JSON.stringify({ teamId: null, names: ['Taylor'], requestId: randomUUID() }),
    })
    assert.equal(created.status, 201)
    const body = (await created.json()) as {
      data: { id: number; position: string | null; player: { id: number; userId: number | null } }[]
    }
    assert.isNull(body.data[0].player.userId)
    assert.isNull(body.data[0].position)
    const settings = await fetch(url(`/api/v1/roster/${f.league.id}/settings`), {
      headers: f.headers,
    })
    assert.deepEqual(await settings.json(), { requiresApproval: false })
    const updated = await fetch(url(`/api/v1/roster/${f.league.id}/settings`), {
      method: 'PATCH',
      headers: f.headers,
      body: JSON.stringify({ requiresApproval: true }),
    })
    assert.deepEqual(await updated.json(), { requiresApproval: true })
    const assigned = await fetch(url(`${base}/assign`), {
      method: 'POST',
      headers: f.adminHeaders,
      body: JSON.stringify({ teamId: f.team.id, rosterIds: [body.data[0].id] }),
    })
    assert.equal(assigned.status, 200)
    const claim = await fetch(url('/api/v1/player-claims'), {
      method: 'POST',
      headers: f.adminHeaders,
      body: JSON.stringify({
        leagueId: f.league.id,
        seasonId: f.season.id,
        playerId: body.data[0].player.id,
      }),
    })
    assert.equal(claim.status, 201)
    assert.match(
      ((await claim.json()) as { claimLink: string }).claimLink,
      /\/claim\/[a-f0-9]{64}$/
    )
    const invite = await fetch(
      url(
        `/api/v1/invites/generate?leagueId=${f.league.id}&seasonId=${f.season.id}&teamId=${f.team.id}`
      ),
      { headers: f.adminHeaders }
    )
    assert.equal(invite.status, 200)
    assert.match(
      ((await invite.json()) as { inviteLink: string }).inviteLink,
      /^https?:\/\/.+\/join\/[0-9a-f-]{36}$/i
    )
    const denied = await fetch(
      url(`/api/v1/invites/generate?leagueId=${f.league.id}&seasonId=${f.season.id}`),
      { headers: f.adminHeaders }
    )
    assert.equal(denied.status, 403)
  })

  test('public form renders without login, protects POST with CSRF, and registers via its browser contract', async ({
    assert,
  }) => {
    const f = await fixture()
    const path = `/join/${f.invite.token}`
    const page = await fetch(url(path), { headers: { Accept: 'text/html' } })
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.include(html, '<meta property="og:title" content="Join HTTP League | SportyKore"')
    assert.include(html, '<meta property="og:site_name" content="SportyKore"')
    assert.include(html, 'No sign-in required.')
    assert.include(html, publicWebUrl('/images/sportykore-logo.png'))
    assert.notInclude(html, 'AdonisJS')
    const encoded = html.match(/data-page="([^"]+)"/)?.[1]
    assert.isString(encoded)
    const data = JSON.parse(
      encoded!
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
    )
    assert.equal(data.component, 'players/register')
    assert.equal(data.props.leagueName, 'HTTP League')
    assert.isFalse(data.props.requiresApproval)
    const requestBody = {
      name: 'Browser Player',
      countryId: f.country.id,
      requestId: data.props.requestId,
    }
    const withoutCsrf = await fetch(url(path), {
      method: 'POST',
      headers: json,
      body: JSON.stringify(requestBody),
      redirect: 'manual',
    })
    assert.equal(withoutCsrf.status, 302)
    assert.notInclude(withoutCsrf.headers.get('location') ?? '', '/complete/')
    assert.lengthOf(await Player.all(), 0)
    const cookies = page.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ')
    const xsrf = page.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('XSRF-TOKEN='))
      ?.split(';')[0]
      .slice('XSRF-TOKEN='.length)
    assert.isString(xsrf)
    const submitted = await fetch(url(path), {
      method: 'POST',
      headers: { ...json, 'Cookie': cookies, 'X-XSRF-TOKEN': decodeURIComponent(xsrf!) },
      body: JSON.stringify(requestBody),
      redirect: 'manual',
    })
    assert.equal(submitted.status, 302)
    assert.include(submitted.headers.get('location')!, '/complete/')
    const row = await LeaguePlayer.query().preload('player').firstOrFail()
    assert.equal(row.status, 'active')
    assert.isNull(row.teamId)
    assert.isNull(row.player.userId)
    const confirmation = await fetch(url(submitted.headers.get('location')!), {
      headers: {
        'X-Inertia': 'true',
        'X-Inertia-Version': data.version,
        'Accept': 'text/html, application/xhtml+xml',
      },
    })
    const receipt = (await confirmation.json()) as { component: string; props: { status: string } }
    assert.equal(receipt.component, 'players/registered')
    assert.equal(receipt.props.status, 'active')
    const duplicate = await fetch(url(path), {
      method: 'POST',
      headers: {
        ...json,
        'Cookie': cookies,
        'X-XSRF-TOKEN': decodeURIComponent(xsrf!),
      },
      body: JSON.stringify({ ...requestBody, requestId: randomUUID() }),
      redirect: 'manual',
    })
    assert.equal(duplicate.status, 302)
    assert.equal(duplicate.headers.get('location'), path)
    const feedbackResponse = await fetch(url(path), {
      headers: {
        'Cookie': cookies,
        'X-Inertia': 'true',
        'X-Inertia-Version': data.version,
        'Accept': 'text/html, application/xhtml+xml',
      },
    })
    const feedback = (await feedbackResponse.json()) as {
      props: { duplicateName: boolean; errors: { name: string } }
    }
    assert.isTrue(feedback.props.duplicateName)
    assert.include(feedback.props.errors.name, 'already exists')
    assert.lengthOf(await Player.all(), 1)
  })
})
