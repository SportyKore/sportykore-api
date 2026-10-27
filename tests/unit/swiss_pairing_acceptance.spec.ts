import { test } from '@japa/runner'

import Country from '#models/country'
import Game from '#models/game'
import League from '#models/league'
import Season from '#models/season'
import StageGroup from '#models/stage_group'
import Team from '#models/team'
import User from '#models/user'
import Venue from '#models/venue'
import SwissPairingService from '#services/swiss_pairing_service'
import type { SwissStageConfig } from '#types/stage'
import { withFreshDatabaseAndCountries } from '../helpers/migration.js'

async function createOwnerLeagueSeasonTeams(teamCount: number, label = 'swiss') {
  const owner = await User.create({
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@swiss.test`,
    password: 'password1',
    fullName: `${label} Owner`,
  })
  const ng = await Country.findByOrFail('code', 'ng')
  const league = await League.create({
    userId: owner.id,
    name: `${label} League`,
    countryId: ng.id,
  })
  const season = await Season.create({ leagueId: league.id, name: '2026', status: 'active' })
  const teams: Team[] = []
  for (let i = 0; i < teamCount; i++) {
    teams.push(
      await Team.create({
        leagueId: league.id,
        name: `Team ${String(i + 1).padStart(2, '0')}`,
        addedBy: owner.id,
      })
    )
  }
  return { owner, league, season, teams }
}

function swissConfig(overrides: Partial<SwissStageConfig> = {}): SwissStageConfig {
  return {
    format: { rounds: 3, byeHandling: 'warn', seed: 7 },
    qualification: { directCount: 1, playoffRankFrom: 2, playoffRankTo: 5 },
    ...overrides,
  }
}

test.group('SwissPairingService acceptance', (group) => {
  withFreshDatabaseAndCountries(group)

  test('round 1: 8 teams produce 4 pairs, no team paired twice', async ({ assert }) => {
    const { league, season, teams } = await createOwnerLeagueSeasonTeams(8, 'r1')
    const service = new SwissPairingService()

    const { stage, groups } = await service.createSwissStage(league.id, season.id, {
      name: 'Opening Stage',
      groupNames: ['Ikole Campus'],
      config: swissConfig(),
    })

    await service.assignTeams(stage.id, { mode: 'auto', teamIds: teams.map((t) => t.id) })

    const proposal = await service.proposeRound(stage.id, groups[0]!.id, 1, { mode: 'auto' })
    assert.lengthOf(proposal.fixtures, 4)
    assert.lengthOf(proposal.conflicts, 0)
    assert.isNull(proposal.byeTeamId)

    const seen = new Set<number>()
    for (const fixture of proposal.fixtures) {
      assert.isFalse(seen.has(fixture.homeTeamId))
      assert.isFalse(seen.has(fixture.awayTeamId))
      seen.add(fixture.homeTeamId)
      seen.add(fixture.awayTeamId)
    }
  })

  test('round 2 never repeats round 1 pairings', async ({ assert }) => {
    const { league, season, teams } = await createOwnerLeagueSeasonTeams(8, 'r2')
    const service = new SwissPairingService()

    const { stage, groups } = await service.createSwissStage(league.id, season.id, {
      name: 'Opening Stage',
      groupNames: ['Oye Campus'],
      config: swissConfig(),
    })
    const stageGroup = groups[0]!
    await service.assignTeams(stage.id, { mode: 'auto', teamIds: teams.map((t) => t.id) })

    const round1 = await service.proposeRound(stage.id, stageGroup.id, 1, { mode: 'auto' })
    await service.confirmRound(stage.id, stageGroup.id, 1, { fixtures: round1.fixtures })

    // Finish round 1 games so round 2 generation is allowed.
    const round1Games = await Game.query().where('stage_id', stage.id).where('round_number', 1)
    for (const g of round1Games) {
      g.status = 'full_time'
      g.homeScore = 2
      g.awayScore = 1
      await g.save()
    }

    const round2 = await service.proposeRound(stage.id, stageGroup.id, 2, { mode: 'auto' })
    assert.lengthOf(round2.conflicts, 0)

    const round1Pairs = new Set(
      round1.fixtures.map((f) => [f.homeTeamId, f.awayTeamId].sort().join('-'))
    )
    for (const fixture of round2.fixtures) {
      const key = [fixture.homeTeamId, fixture.awayTeamId].sort().join('-')
      assert.isFalse(round1Pairs.has(key))
    }
  })

  test('round 2 is blocked while round 1 games are unfinished', async ({ assert }) => {
    const { league, season, teams } = await createOwnerLeagueSeasonTeams(8, 'block')
    const service = new SwissPairingService()

    const { stage, groups } = await service.createSwissStage(league.id, season.id, {
      name: 'Opening Stage',
      groupNames: ['Ikole Campus'],
      config: swissConfig(),
    })
    const stageGroup = groups[0]!
    await service.assignTeams(stage.id, { mode: 'auto', teamIds: teams.map((t) => t.id) })

    const round1 = await service.proposeRound(stage.id, stageGroup.id, 1, { mode: 'auto' })
    await service.confirmRound(stage.id, stageGroup.id, 1, { fixtures: round1.fixtures })

    await assert.rejects(() => service.proposeRound(stage.id, stageGroup.id, 2, { mode: 'auto' }))
  })

  test('manual confirm with a rematch is blocked without forceOverride, allowed with it', async ({
    assert,
  }) => {
    const { league, season, teams } = await createOwnerLeagueSeasonTeams(4, 'manual')
    const service = new SwissPairingService()

    const { stage, groups } = await service.createSwissStage(league.id, season.id, {
      name: 'Opening Stage',
      groupNames: ['Ikole Campus'],
      config: swissConfig(),
    })
    const stageGroup = groups[0]!
    const teamIds = teams.map((t) => t.id)
    await service.assignTeams(stage.id, { mode: 'auto', teamIds })

    const [a, b, c, d] = teamIds as [number, number, number, number]

    await service.confirmRound(stage.id, stageGroup.id, 1, {
      fixtures: [
        { homeTeamId: a, awayTeamId: b },
        { homeTeamId: c, awayTeamId: d },
      ],
    })
    const round1Games = await Game.query().where('stage_id', stage.id).where('round_number', 1)
    for (const g of round1Games) {
      g.status = 'full_time'
      g.homeScore = 1
      g.awayScore = 0
      await g.save()
    }

    // Admin manually re-enters the exact same pairing for round 2 — a rematch.
    await assert.rejects(() =>
      service.confirmRound(stage.id, stageGroup.id, 2, {
        fixtures: [
          { homeTeamId: a, awayTeamId: b },
          { homeTeamId: c, awayTeamId: d },
        ],
      })
    )

    const confirmed = await service.confirmRound(stage.id, stageGroup.id, 2, {
      fixtures: [
        { homeTeamId: a, awayTeamId: b },
        { homeTeamId: c, awayTeamId: d },
      ],
      forceOverride: true,
    })
    assert.equal(confirmed.count, 2)
  })

  test('createSwissStage names groups after campuses, not letters', async ({ assert }) => {
    const { league, season } = await createOwnerLeagueSeasonTeams(0, 'names')
    const service = new SwissPairingService()

    const { groups } = await service.createSwissStage(league.id, season.id, {
      name: 'Opening Stage',
      groupNames: ['Ikole Campus', 'Oye Campus'],
      config: swissConfig(),
    })

    const savedGroups = await StageGroup.query().where('stage_id', groups[0]!.stageId)
    const names = savedGroups.map((g) => g.name)
    assert.includeMembers(names, ['Ikole Campus', 'Oye Campus'])
  })

  test('confirmRound snapshots a venueId from the league onto every created game', async ({
    assert,
  }) => {
    const { league, season, teams } = await createOwnerLeagueSeasonTeams(4, 'venue')
    const service = new SwissPairingService()
    const venue = await Venue.create({ name: 'Agbowo Pitch', leagueId: league.id })

    const { stage, groups } = await service.createSwissStage(league.id, season.id, {
      name: 'Opening Stage',
      groupNames: ['Ikole Campus'],
      config: swissConfig(),
    })
    const stageGroup = groups[0]!
    const teamIds = teams.map((t) => t.id)
    await service.assignTeams(stage.id, { mode: 'auto', teamIds })

    const round1 = await service.proposeRound(stage.id, stageGroup.id, 1, { mode: 'auto' })
    await service.confirmRound(stage.id, stageGroup.id, 1, {
      fixtures: round1.fixtures,
      venueId: venue.id,
    })

    const games = await Game.query().where('stage_id', stage.id)
    for (const g of games) {
      assert.equal(g.venueId, venue.id)
      assert.equal(g.venueName, 'Agbowo Pitch')
    }
  })

  test('confirmRound rejects a venueId from another league', async ({ assert }) => {
    const { league, season, teams } = await createOwnerLeagueSeasonTeams(4, 'otherleague')
    const otherOwner = await User.create({
      email: `other-${Date.now()}@swiss.test`,
      password: 'password1',
      fullName: 'Other Owner',
    })
    const ng = await Country.findByOrFail('code', 'ng')
    const otherLeague = await League.create({
      userId: otherOwner.id,
      name: 'Other League',
      countryId: ng.id,
    })
    const foreignVenue = await Venue.create({ name: 'Foreign Pitch', leagueId: otherLeague.id })

    const service = new SwissPairingService()
    const { stage, groups } = await service.createSwissStage(league.id, season.id, {
      name: 'Opening Stage',
      groupNames: ['Ikole Campus'],
      config: swissConfig(),
    })
    const stageGroup = groups[0]!
    await service.assignTeams(stage.id, { mode: 'auto', teamIds: teams.map((t) => t.id) })
    const round1 = await service.proposeRound(stage.id, stageGroup.id, 1, { mode: 'auto' })

    await assert.rejects(() =>
      service.confirmRound(stage.id, stageGroup.id, 1, {
        fixtures: round1.fixtures,
        venueId: foreignVenue.id,
      })
    )
  })
})
