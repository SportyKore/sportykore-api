import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import Country from '#models/country'
import League from '#models/league'
import Season from '#models/season'
import Team from '#models/team'
import TeamAdmin from '#models/team_admin'
import LeaguePlayer from '#models/league_player'
import Player from '#models/player'
import RosterService, { DuplicateRosterNames } from '#services/roster_service'
import { withFreshDatabaseAndCountries } from '../helpers/migration.js'

async function fixture() {
  const [owner, admin, stranger] = await User.createMany([
    { email: 'roster-owner@example.test', fullName: 'Owner' },
    { email: 'roster-admin@example.test', fullName: 'Admin' },
    { email: 'roster-stranger@example.test', fullName: 'Stranger' },
  ])
  const country = await Country.findByOrFail('code', 'ng')
  const league = await League.create({
    name: 'Roster league',
    userId: owner.id,
    countryId: country.id,
  })
  const season = await Season.create({ name: 'Current', leagueId: league.id, status: 'active' })
  const [team, other] = await Team.createMany([
    { name: 'Managed', leagueId: league.id, addedBy: owner.id },
    { name: 'Other', leagueId: league.id, addedBy: owner.id },
  ])
  const membership = await TeamAdmin.create({
    leagueId: league.id,
    teamId: team.id,
    userId: admin.id,
    assignedBy: owner.id,
  })
  return {
    owner,
    admin,
    stranger,
    league,
    season,
    team,
    other,
    membership,
    service: new RosterService(),
  }
}

test.group('Roster foundation (database)', (group) => {
  withFreshDatabaseAndCountries(group)

  test('name-only pool entries, duplicate confirmation, replay and conflicting request IDs', async ({
    assert,
  }) => {
    const f = await fixture()
    const input = { teamId: null, names: ['  Jane   DOE ', 'Ｊａｎｅ doe'], requestId: 'bulk-1' }
    try {
      await f.service.create(f.owner.id, f.league.id, f.season.id, input)
      assert.fail('Expected duplicate confirmation')
    } catch (error) {
      assert.instanceOf(error, DuplicateRosterNames)
      assert.deepEqual((error as DuplicateRosterNames).matches, [
        { normalizedName: 'jane doe', inputIndexes: [0, 1], rosterIds: [] },
      ])
    }
    assert.lengthOf(await Player.all(), 0)
    const rows = await f.service.create(f.owner.id, f.league.id, f.season.id, {
      ...input,
      confirmDuplicates: true,
    })
    assert.lengthOf(rows, 2)
    assert.isNull(rows[0].teamId)
    assert.isNull(rows[0].player.userId)
    const player = await Player.findOrFail(rows[0].playerId)
    assert.isNull(player.countryId)
    assert.deepEqual(await f.service.create(f.owner.id, f.league.id, f.season.id, input), rows)
    assert.lengthOf(await Player.all(), 2)
    await assert.rejects(
      () =>
        f.service.create(f.owner.id, f.league.id, f.season.id, { ...input, names: ['Different'] }),
      /different payload/
    )
    await assert.rejects(
      () =>
        f.service.create(f.owner.id, f.league.id, f.season.id, {
          teamId: null,
          names: ['jane doe'],
          requestId: 'bulk-2',
        }),
      /confirmation/
    )
  })

  test('team admins can read pool and own team, cannot create pool or manage other teams', async ({
    assert,
  }) => {
    const f = await fixture()
    const pool = await f.service.create(f.owner.id, f.league.id, f.season.id, {
      teamId: null,
      names: ['Pool'],
      requestId: 'pool',
    })
    await f.service.create(f.owner.id, f.league.id, f.season.id, {
      teamId: f.other.id,
      names: ['Other'],
      requestId: 'other',
    })
    const own = await f.service.create(f.admin.id, f.league.id, f.season.id, {
      teamId: f.team.id,
      names: ['Own'],
      requestId: 'own',
    })
    const visible = await f.service.list(f.admin.id, f.league.id, f.season.id)
    assert.deepEqual(
      visible.map((row) => row.id),
      [pool[0].id, own[0].id]
    )
    assert.lengthOf(await f.service.list(f.admin.id, f.league.id, f.season.id, null), 1)
    await assert.rejects(
      () => f.service.list(f.admin.id, f.league.id, f.season.id, f.other.id),
      /denied/
    )
    await assert.rejects(
      () =>
        f.service.create(f.admin.id, f.league.id, f.season.id, {
          teamId: null,
          names: ['No'],
          requestId: 'denied',
        }),
      /denied/
    )
    await assert.rejects(() => f.service.list(f.stranger.id, f.league.id, f.season.id), /denied/)
    f.membership.removedAt = DateTime.utc()
    await f.membership.save()
    await assert.rejects(() => f.service.list(f.admin.id, f.league.id, f.season.id), /denied/)
  })

  test('assignment races have one winner and mixed invalid batches roll back', async ({
    assert,
  }) => {
    const f = await fixture()
    const rows = await f.service.create(f.owner.id, f.league.id, f.season.id, {
      teamId: null,
      names: ['One', 'Two'],
      requestId: 'pool',
    })
    const outcomes = await Promise.allSettled([
      f.service.assign(f.admin.id, f.league.id, f.season.id, f.team.id, [rows[0].id]),
      f.service.assign(f.owner.id, f.league.id, f.season.id, f.other.id, [rows[0].id]),
    ])
    assert.lengthOf(
      outcomes.filter((result) => result.status === 'fulfilled'),
      1
    )
    const failure = outcomes.find((result) => result.status === 'rejected') as PromiseRejectedResult
    assert.equal(failure.reason.status, 409)
    await assert.rejects(
      () =>
        f.service.assign(f.owner.id, f.league.id, f.season.id, f.other.id, [
          rows[1].id,
          rows[0].id,
        ]),
      /no longer available/
    )
    const untouched = await LeaguePlayer.findOrFail(rows[1].id)
    assert.isNull(untouched.teamId)
  })

  test('pending approvals are scoped, rejected persists, and settings are owner only', async ({
    assert,
  }) => {
    const f = await fixture()
    const rows = await f.service.create(f.owner.id, f.league.id, f.season.id, {
      teamId: f.team.id,
      names: ['Applicant'],
      requestId: 'applicant',
    })
    await LeaguePlayer.query().where('id', rows[0].id).update({ status: 'pending' })
    const rejected = await f.service.approve(
      f.admin.id,
      f.league.id,
      f.season.id,
      rows[0].id,
      'rejected'
    )
    assert.equal(rejected.status, 'rejected')
    await assert.rejects(
      () => f.service.approve(f.admin.id, f.league.id, f.season.id, rows[0].id, 'active'),
      /already been reviewed/
    )
    assert.deepEqual(await f.service.settings(f.owner.id, f.league.id), {
      requiresApproval: false,
    })
    assert.deepEqual(await f.service.settings(f.owner.id, f.league.id, true), {
      requiresApproval: true,
    })
    await assert.rejects(() => f.service.settings(f.admin.id, f.league.id, true), /Only the owner/)
    const pool = await f.service.create(f.owner.id, f.league.id, f.season.id, {
      teamId: null,
      names: ['Pending pool'],
      requestId: 'pending-pool',
    })
    await LeaguePlayer.query().where('id', pool[0].id).update({ status: 'pending' })
    await assert.rejects(
      () => f.service.assign(f.admin.id, f.league.id, f.season.id, f.team.id, [pool[0].id]),
      /no longer available/
    )
    await assert.rejects(
      () => f.service.approve(f.admin.id, f.league.id, f.season.id, pool[0].id, 'active'),
      /denied/
    )
    const approved = await f.service.approve(
      f.owner.id,
      f.league.id,
      f.season.id,
      pool[0].id,
      'active'
    )
    assert.equal(approved.status, 'active')
  })

  test('cross-league seasons and teams are rejected and request retries recheck access', async ({
    assert,
  }) => {
    const f = await fixture()
    const country = await Country.findByOrFail('code', 'ng')
    const foreignLeague = await League.create({
      name: 'Foreign',
      userId: f.owner.id,
      countryId: country.id,
    })
    const foreignSeason = await Season.create({ name: 'Foreign', leagueId: foreignLeague.id })
    const foreignTeam = await Team.create({
      name: 'Foreign',
      leagueId: foreignLeague.id,
      addedBy: f.owner.id,
    })
    await assert.rejects(() => f.service.list(f.owner.id, f.league.id, foreignSeason.id))
    await assert.rejects(() =>
      f.service.create(f.owner.id, f.league.id, f.season.id, {
        teamId: foreignTeam.id,
        names: ['No'],
        requestId: 'cross',
      })
    )
    const input = { teamId: f.team.id, names: ['Own'], requestId: 'repeat' }
    await f.service.create(f.admin.id, f.league.id, f.season.id, input)
    f.membership.removedAt = DateTime.utc()
    await f.membership.save()
    await assert.rejects(
      () => f.service.create(f.admin.id, f.league.id, f.season.id, input),
      /denied/
    )
    assert.lengthOf(await db.from('roster_requests'), 1)
  })
})
