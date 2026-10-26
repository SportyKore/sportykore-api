import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import Country from '#models/country'
import League from '#models/league'
import Season from '#models/season'
import Team from '#models/team'
import TeamAdmin from '#models/team_admin'
import Invite from '#models/invite'
import Player from '#models/player'
import LeaguePlayer from '#models/league_player'
import PublicPlayerService from '#services/public_player_service'
import PlayerClaimService from '#services/player_claim_service'
import RosterService from '#services/roster_service'
import { withFreshDatabaseAndCountries } from '../helpers/migration.js'

async function fixture() {
  const [owner, admin, playerUser, otherUser] = await User.createMany([
    { email: 'owner@registration.test' },
    { email: 'admin@registration.test' },
    { email: 'player@registration.test' },
    { email: 'other@registration.test' },
  ])
  const country = await Country.findByOrFail('code', 'ng')
  const league = await League.create({
    name: 'Sunday League',
    userId: owner.id,
    countryId: country.id,
  })
  const season = await Season.create({ name: '2026', leagueId: league.id, status: 'active' })
  const team = await Team.create({ name: 'United', leagueId: league.id, addedBy: owner.id })
  const teamAdmin = await TeamAdmin.create({
    leagueId: league.id,
    teamId: team.id,
    userId: admin.id,
    assignedBy: owner.id,
  })
  const invite = await Invite.create({
    token: randomUUID(),
    leagueId: league.id,
    seasonId: season.id,
    teamId: null,
    invitedUserId: null,
    expiresAt: DateTime.utc().plus({ days: 7 }),
    status: 'pending',
  })
  return {
    owner,
    admin,
    playerUser,
    otherUser,
    country,
    league,
    season,
    team,
    teamAdmin,
    invite,
    publicPlayers: new PublicPlayerService(),
    claims: new PlayerClaimService(),
    roster: new RosterService(),
  }
}

function claimToken(link: string) {
  return new URL(link).pathname.split('/').pop()!
}

async function linkedUser(playerId: number) {
  const player = await Player.findOrFail(playerId)
  return player.userId
}
async function issueToken(
  service: PlayerClaimService,
  userId: number,
  input: { playerId: number; leagueId: number; seasonId: number }
) {
  const issued = await service.issue(userId, input)
  return claimToken(issued.claimLink)
}

test.group('Public player registration and claiming', (group) => {
  withFreshDatabaseAndCountries(group)

  test('anonymous league registration creates a pending unassigned profile; retry preserves identity', async ({
    assert,
  }) => {
    const f = await fixture()
    await db
      .from('leagues')
      .where('id', f.league.id)
      .update({ public_registration_requires_approval: true })
    const input = { name: '  Alex   Doe  ', countryId: f.country.id, requestId: randomUUID() }
    const first = await f.publicPlayers.register(f.invite.token, input)
    assert.isFalse(first.duplicate)
    if (first.duplicate) return
    assert.equal(first.roster.status, 'pending')
    assert.isNull(first.roster.teamId)
    const player = await Player.findOrFail(first.roster.playerId)
    assert.isNull(player.userId)
    assert.equal(player.name, 'Alex Doe')
    const retry = await f.publicPlayers.register(f.invite.token, input)
    assert.isFalse(retry.duplicate)
    if (!retry.duplicate) assert.equal(retry.roster.id, first.roster.id)
    assert.lengthOf(await Player.all(), 1)
    await assert.rejects(
      () => f.publicPlayers.register(f.invite.token, { ...input, name: 'Different' }),
      /already been used/
    )
  })

  test('duplicate names need explicit confirmation but may create distinct people', async ({
    assert,
  }) => {
    const f = await fixture()
    const input = { name: 'Alex Doe', countryId: f.country.id, requestId: randomUUID() }
    await f.publicPlayers.register(f.invite.token, input)
    const second = { ...input, name: 'ＡＬＥＸ  DOE', requestId: randomUUID() }
    const duplicate = await f.publicPlayers.register(f.invite.token, second)
    assert.isTrue(duplicate.duplicate)
    assert.lengthOf(await Player.all(), 1)
    const confirmed = await f.publicPlayers.register(f.invite.token, {
      ...second,
      confirmDuplicate: true,
    })
    assert.isFalse(confirmed.duplicate)
    assert.lengthOf(await Player.all(), 2)
  })

  test('team registration honors automatic admission and rejects expired or account-specific invites', async ({
    assert,
  }) => {
    const f = await fixture()
    f.invite.teamId = f.team.id
    await f.invite.save()
    await f.roster.settings(f.owner.id, f.league.id, false)
    const result = await f.publicPlayers.register(f.invite.token, {
      name: 'Alex',
      countryId: f.country.id,
      requestId: randomUUID(),
    })
    if (result.duplicate) return assert.fail('Unexpected duplicate')
    assert.equal(result.roster.status, 'active')
    assert.equal(result.roster.teamId, f.team.id)
    f.invite.expiresAt = DateTime.utc().minus({ seconds: 1 })
    await f.invite.save()
    await assert.rejects(() => f.publicPlayers.context(f.invite.token))
    f.invite.expiresAt = DateTime.utc().plus({ days: 1 })
    f.invite.invitedUserId = f.playerUser.id
    await f.invite.save()
    await assert.rejects(() => f.publicPlayers.context(f.invite.token), /invited account/)
    assert.lengthOf(await Player.all(), 1)
  })

  test('concurrent public submissions cannot bypass the duplicate warning', async ({ assert }) => {
    const f = await fixture()
    const results = await Promise.all([
      f.publicPlayers.register(f.invite.token, {
        name: 'Same',
        countryId: f.country.id,
        requestId: randomUUID(),
      }),
      f.publicPlayers.register(f.invite.token, {
        name: 'Same',
        countryId: f.country.id,
        requestId: randomUUID(),
      }),
    ])
    assert.lengthOf(
      results.filter((result) => !result.duplicate),
      1
    )
    assert.lengthOf(await Player.all(), 1)
  })

  test('claiming links the original player and membership and consumes the token once', async ({
    assert,
  }) => {
    const f = await fixture()
    const [row] = await f.roster.create(f.admin.id, f.league.id, f.season.id, {
      teamId: f.team.id,
      names: ['Alex'],
      requestId: randomUUID(),
    })
    const input = { playerId: row.playerId, leagueId: f.league.id, seasonId: f.season.id }
    const issued = await f.claims.issue(f.admin.id, input)
    const token = claimToken(issued.claimLink)
    const stored = await db.from('player_claims').firstOrFail()
    assert.notEqual(stored.token_hash, token)
    assert.isTrue(await f.claims.isAvailable(token))
    assert.deepEqual(await f.claims.redeem(token, f.playerUser.id), { playerId: row.playerId })
    assert.equal(await linkedUser(row.playerId), f.playerUser.id)
    const membership = await LeaguePlayer.findOrFail(row.id)
    assert.equal(membership.playerId, row.playerId)
    assert.lengthOf(await Player.all(), 1)
    assert.isFalse(await f.claims.isAvailable(token))
    await assert.rejects(() => f.claims.redeem(token, f.otherUser.id))
  })

  test('claim reissue revokes old links; expired links and revoked admins cannot claim', async ({
    assert,
  }) => {
    const f = await fixture()
    const [row] = await f.roster.create(f.admin.id, f.league.id, f.season.id, {
      teamId: f.team.id,
      names: ['Alex'],
      requestId: randomUUID(),
    })
    const input = { playerId: row.playerId, leagueId: f.league.id, seasonId: f.season.id }
    await assert.rejects(() => f.claims.issue(f.otherUser.id, input), /administrator/)
    const first = await issueToken(f.claims, f.admin.id, input)
    const second = await issueToken(f.claims, f.admin.id, input)
    assert.isFalse(await f.claims.isAvailable(first))
    await assert.rejects(() => f.claims.redeem(first, f.playerUser.id))
    f.teamAdmin.removedAt = DateTime.utc()
    await f.teamAdmin.save()
    await assert.rejects(() => f.claims.redeem(second, f.playerUser.id), /administrator/)
    assert.isNull(await linkedUser(row.playerId))
    const third = await issueToken(f.claims, f.owner.id, input)
    await db.from('player_claims').update({ expires_at: new Date(0) })
    await assert.rejects(() => f.claims.redeem(third, f.playerUser.id))
    assert.isNull(await linkedUser(row.playerId))
  })

  test('existing profile conflicts roll back consumption; concurrent claims have one winner', async ({
    assert,
  }) => {
    const f = await fixture()
    const [row] = await f.roster.create(f.owner.id, f.league.id, f.season.id, {
      teamId: null,
      names: ['Alex'],
      requestId: randomUUID(),
    })
    await Player.create({ name: 'Other profile', userId: f.otherUser.id })
    const token = await issueToken(f.claims, f.owner.id, {
      playerId: row.playerId,
      leagueId: f.league.id,
      seasonId: f.season.id,
    })
    await assert.rejects(
      () => f.claims.redeem(token, f.otherUser.id),
      /already have a player profile/
    )
    assert.isNull(await linkedUser(row.playerId))
    assert.isTrue(await f.claims.isAvailable(token))
    const results = await Promise.allSettled([
      f.claims.redeem(token, f.playerUser.id),
      f.claims.redeem(token, f.admin.id),
    ])
    assert.lengthOf(
      results.filter((result) => result.status === 'fulfilled'),
      1
    )
  })
})
