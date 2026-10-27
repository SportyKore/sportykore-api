import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import Country from '#models/country'
import PlayerClaimService from '#services/player_claim_service'
import { withFreshDatabaseAndCountries } from '../helpers/migration.js'

test.group('Player claims transactional service', (group) => {
  // This helper replaces SQLite. Run in the main task's isolated copy only.
  withFreshDatabaseAndCountries(group)
  const service = new PlayerClaimService()
  const tokenOf = (link: string) => new URL(link).pathname.split('/').pop()!
  function insertedRow(value: unknown): { id: number } {
    const rawId = typeof value === 'object' && value !== null && 'id' in value ? value.id : value
    const id = Number(rawId)
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Insert did not return a valid ID')
    return { id }
  }
  async function issueToken(
    userId: number,
    input: { playerId: number; leagueId: number; seasonId: number }
  ) {
    const result = await service.issue(userId, input)
    return tokenOf(result.claimLink)
  }
  async function fixture() {
    const owner = await User.create({ email: 'owner@test.com', password: 'password1' })
    const claimant = await User.create({ email: 'claimant@test.com', password: 'password1' })
    const other = await User.create({ email: 'other@test.com', password: 'password1' })
    const country = await Country.findByOrFail('code', 'ng')
    const [leagueResult] = await db
      .table('leagues')
      .insert({ name: 'League', user_id: owner.id })
      .returning('id')
    const league = insertedRow(leagueResult)
    const [seasonResult] = await db
      .table('seasons')
      .insert({ name: 'Season', league_id: league.id, status: 'active' })
      .returning('id')
    const season = insertedRow(seasonResult)
    const [teamResult] = await db
      .table('teams')
      .insert({ name: 'Team', league_id: league.id, added_by: owner.id })
      .returning('id')
    const team = insertedRow(teamResult)
    const [playerResult] = await db
      .table('players')
      .insert({
        name: 'Original',
        country_id: country.id,
        user_id: null,
        bio: 'Original biography',
      })
      .returning('id')
    const player = insertedRow(playerResult)
    const [membershipResult] = await db
      .table('league_players')
      .insert({
        player_id: player.id,
        league_id: league.id,
        season_id: season.id,
        team_id: team.id,
        status: 'active',
        jersey_number: '10',
      })
      .returning('id')
    const membership = insertedRow(membershipResult)
    return {
      owner,
      claimant,
      other,
      country,
      team,
      membership,
      input: {
        playerId: Number(player.id),
        leagueId: Number(league.id),
        seasonId: Number(season.id),
      },
    }
  }

  test('hashes secrets, revokes earlier links, preserves player and roster, and rejects replay', async ({
    assert,
  }) => {
    const f = await fixture()
    const first = await issueToken(f.owner.id, f.input)
    const token = await issueToken(f.owner.id, f.input)
    assert.isFalse(await service.isAvailable(first))
    const row = await db.from('player_claims').whereNull('revoked_at').firstOrFail()
    assert.notEqual(row.token_hash, token)
    assert.equal(row.issued_by, f.owner.id)
    await assert.rejects(() => service.redeem(first, f.claimant.id))
    assert.deepEqual(await service.redeem(token, f.claimant.id), { playerId: f.input.playerId })
    const player = await db.from('players').where('id', f.input.playerId).firstOrFail()
    assert.equal(player.user_id, f.claimant.id)
    assert.equal(player.bio, 'Original biography')
    const roster = await db.from('league_players').where('id', f.membership.id).firstOrFail()
    assert.equal(roster.jersey_number, '10')
    assert.equal(roster.player_id, player.id)
    await assert.rejects(() => service.redeem(token, f.other.id))
  })

  test('expiry rolls back linkage and consumption', async ({ assert }) => {
    const f = await fixture()
    const token = await issueToken(f.owner.id, f.input)
    await db.from('player_claims').update({ expires_at: new Date(Date.now() - 1000) })
    await assert.rejects(() => service.redeem(token, f.claimant.id), /expired/)
    const unchangedPlayer = await db.from('players').where('id', f.input.playerId).firstOrFail()
    assert.isNull(unchangedPlayer.user_id)
    const unchangedClaim = await db.from('player_claims').firstOrFail()
    assert.isNull(unchangedClaim.redeemed_at)
  })

  test('rejects unrelated users, wrong-team admins, pending memberships and wrong seasons', async ({
    assert,
  }) => {
    const f = await fixture()
    await assert.rejects(() => service.issue(f.other.id, f.input))
    const [teamResult] = await db
      .table('teams')
      .insert({ name: 'Other team', league_id: f.input.leagueId, added_by: f.owner.id })
      .returning('id')
    const team = insertedRow(teamResult)
    await db
      .table('team_admins')
      .insert({ team_id: team.id, league_id: f.input.leagueId, user_id: f.other.id })
    await assert.rejects(() => service.issue(f.other.id, f.input))
    await assert.rejects(() => service.issue(f.owner.id, { ...f.input, seasonId: 999999 }))
    await db.from('league_players').where('id', f.membership.id).update({ status: 'pending' })
    await assert.rejects(() => service.issue(f.owner.id, f.input))
  })

  test('own-team admin may issue but removed authority cannot redeem', async ({ assert }) => {
    const f = await fixture()
    await db
      .table('team_admins')
      .insert({ team_id: f.team.id, league_id: f.input.leagueId, user_id: f.other.id })
    const token = await issueToken(f.other.id, f.input)
    await db.from('team_admins').update({ removed_at: new Date() })
    await assert.rejects(() => service.redeem(token, f.claimant.id))
    const unchangedPlayer = await db.from('players').where('id', f.input.playerId).firstOrFail()
    assert.isNull(unchangedPlayer.user_id)
    const unchangedClaim = await db.from('player_claims').firstOrFail()
    assert.isNull(unchangedClaim.redeemed_at)
  })

  test('deleted leagues reject issuance and invalidate existing claims', async ({ assert }) => {
    const f = await fixture()
    const token = await issueToken(f.owner.id, f.input)
    await db.from('leagues').where('id', f.input.leagueId).update({ status: 'deleted' })
    await assert.rejects(() => service.issue(f.owner.id, f.input))
    await assert.rejects(() => service.redeem(token, f.claimant.id))
    const unchangedPlayer = await db.from('players').where('id', f.input.playerId).firstOrFail()
    assert.isNull(unchangedPlayer.user_id)
  })

  test('existing profiles cannot merge; already-linked players cannot be claimed', async ({
    assert,
  }) => {
    const f = await fixture()
    await db
      .table('players')
      .insert({ name: 'Existing', country_id: f.country.id, user_id: f.claimant.id })
    const token = await issueToken(f.owner.id, f.input)
    await assert.rejects(
      () => service.redeem(token, f.claimant.id),
      /already have a player profile/
    )
    assert.isTrue(await service.isAvailable(token))
    await service.redeem(token, f.other.id)
    await assert.rejects(() => service.issue(f.owner.id, f.input), /already linked/)
  })

  test('concurrent redemption has exactly one winner', async ({ assert }) => {
    const f = await fixture()
    const token = await issueToken(f.owner.id, f.input)
    const results = await Promise.allSettled([
      service.redeem(token, f.claimant.id),
      service.redeem(token, f.other.id),
    ])
    assert.lengthOf(
      results.filter((result) => result.status === 'fulfilled'),
      1
    )
    const player = await db.from('players').where('id', f.input.playerId).firstOrFail()
    const claim = await db.from('player_claims').firstOrFail()
    assert.equal(player.user_id, claim.redeemed_by)
    assert.isNotNull(claim.redeemed_at)
  })

  test('concurrent issuance leaves exactly one usable link', async ({ assert }) => {
    const f = await fixture()
    const links = await Promise.all([
      service.issue(f.owner.id, f.input),
      service.issue(f.owner.id, f.input),
    ])
    const available = await Promise.all(
      links.map((link) => service.isAvailable(tokenOf(link.claimLink)))
    )
    assert.lengthOf(available.filter(Boolean), 1)
  })
})
