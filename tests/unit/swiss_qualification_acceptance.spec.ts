import { test } from '@japa/runner'

import Country from '#models/country'
import Game from '#models/game'
import League from '#models/league'
import Season from '#models/season'
import Stage from '#models/stage'
import Team from '#models/team'
import Tie from '#models/tie'
import User from '#models/user'
import SwissPairingService from '#services/swiss_pairing_service'
import SwissQualificationService, { rankCrossPair } from '#services/swiss_qualification_service'
import type { SwissStageConfig } from '#types/stage'
import { withFreshDatabaseAndCountries } from '../helpers/migration.js'

async function createOwnerLeagueSeasonTeams(teamCount: number, label = 'swq') {
  const owner = await User.create({
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@swq.test`,
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
    format: { rounds: 1, byeHandling: 'warn', seed: 7 },
    qualification: { directCount: 1, playoffRankFrom: 2, playoffRankTo: 5 },
    ...overrides,
  }
}

/** Lower seed (by join order) always beats higher seed so a group's table is decisive. */
async function playAllGamesBySeed(stageId: number, stageGroupId: number) {
  const games = await Game.query().where('stage_id', stageId).where('stage_group_id', stageGroupId)
  for (const g of games) {
    const homeWins = g.homeTeamId < g.awayTeamId
    g.status = 'full_time'
    if (homeWins) {
      g.homeScore = 2
      g.awayScore = 0
      g.winnerTeamId = g.homeTeamId
    } else {
      g.homeScore = 0
      g.awayScore = 2
      g.winnerTeamId = g.awayTeamId
    }
    await g.save()
  }
}

test.group('rankCrossPair', () => {
  test('pairs highest remaining vs lowest remaining (2v5, 3v4 style)', ({ assert }) => {
    const { fixtures, byeTeamId } = rankCrossPair([2, 3, 4, 5])
    assert.isNull(byeTeamId)
    assert.deepEqual(fixtures, [
      { homeTeamId: 2, awayTeamId: 5 },
      { homeTeamId: 3, awayTeamId: 4 },
    ])
  })

  test('Oye-style 6 candidates: 3v8, 4v7, 5v6', ({ assert }) => {
    const { fixtures, byeTeamId } = rankCrossPair([3, 4, 5, 6, 7, 8])
    assert.isNull(byeTeamId)
    assert.deepEqual(fixtures, [
      { homeTeamId: 3, awayTeamId: 8 },
      { homeTeamId: 4, awayTeamId: 7 },
      { homeTeamId: 5, awayTeamId: 6 },
    ])
  })

  test('odd candidate count gives the middle rank a bye', ({ assert }) => {
    const { fixtures, byeTeamId } = rankCrossPair([2, 3, 4])
    assert.equal(byeTeamId, 3)
    assert.deepEqual(fixtures, [{ homeTeamId: 2, awayTeamId: 4 }])
  })
})

test.group('SwissQualificationService acceptance', (group) => {
  withFreshDatabaseAndCountries(group)

  test('resolves direct, playoff and eliminated tiers for a group', async ({ assert }) => {
    const { league, season, teams } = await createOwnerLeagueSeasonTeams(8, 'tiers')
    const pairing = new SwissPairingService()
    const qualification = new SwissQualificationService()

    const { stage, groups } = await pairing.createSwissStage(league.id, season.id, {
      name: 'Opening Stage',
      groupNames: ['Ikole Campus'],
      config: swissConfig({
        qualification: { directCount: 1, playoffRankFrom: 2, playoffRankTo: 5 },
      }),
    })
    const stageGroup = groups[0]!
    const teamIds = teams.map((t) => t.id)
    await pairing.assignTeams(stage.id, { mode: 'auto', teamIds })

    const round1 = await pairing.proposeRound(stage.id, stageGroup.id, 1, { mode: 'auto' })
    await pairing.confirmRound(stage.id, stageGroup.id, 1, { fixtures: round1.fixtures })
    await playAllGamesBySeed(stage.id, stageGroup.id)

    const result = await qualification.resolveGroupQualification(stage.id, stageGroup.id)
    assert.lengthOf(result.direct, 1)
    assert.lengthOf(result.playoffCandidates, 4)
    assert.lengthOf(result.eliminated, 3)
  })

  test('full flow: swiss stage -> playoff -> knockout with correct qualifier count', async ({
    assert,
  }) => {
    const { league, season, teams } = await createOwnerLeagueSeasonTeams(8, 'flow')
    const pairing = new SwissPairingService()
    const qualification = new SwissQualificationService()

    const { stage, groups } = await pairing.createSwissStage(league.id, season.id, {
      name: 'Opening Stage',
      groupNames: ['Ikole Campus'],
      config: swissConfig({
        qualification: { directCount: 1, playoffRankFrom: 2, playoffRankTo: 5 },
      }),
    })
    const stageGroup = groups[0]!
    const teamIds = teams.map((t) => t.id)
    await pairing.assignTeams(stage.id, { mode: 'auto', teamIds })

    const round1 = await pairing.proposeRound(stage.id, stageGroup.id, 1, { mode: 'auto' })
    await pairing.confirmRound(stage.id, stageGroup.id, 1, { fixtures: round1.fixtures })
    await playAllGamesBySeed(stage.id, stageGroup.id)

    const proposal = await qualification.proposePlayoff(stage.id, stageGroup.id)
    assert.lengthOf(proposal.fixtures, 2)

    await qualification.confirmPlayoff(stage.id, stageGroup.id, { fixtures: proposal.fixtures })

    const playoffGames = await Game.query()
      .where('stage_id', stage.id)
      .where('stage_group_id', stageGroup.id)
      .where('round_number', 2)
    assert.lengthOf(playoffGames, 2)
    for (const g of playoffGames) {
      g.status = 'full_time'
      g.homeScore = 1
      g.awayScore = 0
      g.winnerTeamId = g.homeTeamId
      await g.save()
    }

    const qualifiers = await qualification.resolveGroupQualifiers(stage.id, stageGroup.id)
    assert.lengthOf(qualifiers, 3) // 1 direct + 2 playoff winners

    const knockout = await qualification.generateKnockoutFromSwiss(stage.id, {})
    assert.lengthOf(knockout.qualifiers, 3)
    await stage.refresh()
    assert.equal(stage.status, 'completed')

    const ties = await Tie.query().where('stage_id', knockout.stage.id)
    assert.isAbove(ties.length, 0)
  })

  test('previewKnockoutQualifiers reports not-ready groups without creating anything', async ({
    assert,
  }) => {
    const { league, season, teams } = await createOwnerLeagueSeasonTeams(8, 'preview')
    const pairing = new SwissPairingService()
    const qualification = new SwissQualificationService()

    const { stage, groups } = await pairing.createSwissStage(league.id, season.id, {
      name: 'Opening Stage',
      groupNames: ['Ikole Campus'],
      config: swissConfig({
        qualification: { directCount: 1, playoffRankFrom: 2, playoffRankTo: 5 },
      }),
    })
    const stageGroup = groups[0]!
    await pairing.assignTeams(stage.id, { mode: 'auto', teamIds: teams.map((t) => t.id) })

    const round1 = await pairing.proposeRound(stage.id, stageGroup.id, 1, { mode: 'auto' })
    await pairing.confirmRound(stage.id, stageGroup.id, 1, { fixtures: round1.fixtures })
    await playAllGamesBySeed(stage.id, stageGroup.id)

    // Playoff candidates exist but the playoff itself hasn't been generated yet.
    const before = await qualification.previewKnockoutQualifiers(stage.id)
    assert.isFalse(before.ready)
    assert.lengthOf(before.groups, 1)
    assert.isFalse(before.groups[0]!.ready)
    assert.isDefined(before.groups[0]!.reason)
    assert.lengthOf(before.qualifierTeamIds, 0)

    const proposal = await qualification.proposePlayoff(stage.id, stageGroup.id)
    await qualification.confirmPlayoff(stage.id, stageGroup.id, { fixtures: proposal.fixtures })
    const playoffGames = await Game.query()
      .where('stage_id', stage.id)
      .where('stage_group_id', stageGroup.id)
      .where('round_number', 2)
    for (const g of playoffGames) {
      g.status = 'full_time'
      g.homeScore = 1
      g.awayScore = 0
      g.winnerTeamId = g.homeTeamId
      await g.save()
    }

    const after = await qualification.previewKnockoutQualifiers(stage.id)
    assert.isTrue(after.ready)
    assert.lengthOf(after.qualifierTeamIds, 3)

    // Preview never creates a knockout stage.
    const knockoutStages = await Stage.query()
      .where('season_id', season.id)
      .where('stage_type', 'knockout')
    assert.lengthOf(knockoutStages, 0)
  })
})

test.group('Swiss write safety', (group) => {
  withFreshDatabaseAndCountries(group)

  async function setup(label: string) {
    const { league, season, teams } = await createOwnerLeagueSeasonTeams(4, label)
    const pairing = new SwissPairingService()
    const qualification = new SwissQualificationService()
    const { stage, groups } = await pairing.createSwissStage(league.id, season.id, {
      name: 'Swiss',
      groupNames: ['Group'],
      config: swissConfig({
        qualification: { directCount: 4, playoffRankFrom: 5, playoffRankTo: 6 },
      }),
    })
    await pairing.assignTeams(stage.id, { mode: 'auto', teamIds: teams.map((t) => t.id) })
    const fixtures = [
      { homeTeamId: teams[0]!.id, awayTeamId: teams[1]!.id },
      { homeTeamId: teams[2]!.id, awayTeamId: teams[3]!.id },
    ]
    return { pairing, qualification, stage, groupId: groups[0]!.id, fixtures }
  }

  test('concurrent round confirmations create one fixture set', async ({ assert }) => {
    const f = await setup('race-round')
    const results = await Promise.allSettled(
      [1, 2].map(() => f.pairing.confirmRound(f.stage.id, f.groupId, 1, { fixtures: f.fixtures }))
    )
    assert.lengthOf(
      results.filter((r) => r.status === 'fulfilled'),
      1
    )
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    assert.equal(failed.reason.status, 409)
    assert.lengthOf(await Game.query().where('stage_id', f.stage.id), 2)
  })

  test('concurrent playoff confirmations create one fixture set', async ({ assert }) => {
    const f = await setup('race-playoff')
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        f.qualification.confirmPlayoff(f.stage.id, f.groupId, { fixtures: f.fixtures })
      )
    )
    assert.lengthOf(
      results.filter((r) => r.status === 'fulfilled'),
      1
    )
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    assert.equal(failed.reason.status, 409)
    assert.lengthOf(await Game.query().where('stage_id', f.stage.id), 2)
  })

  test('concurrent and repeated knockout generation creates only one bracket', async ({
    assert,
  }) => {
    const f = await setup('race-knockout')
    const results = await Promise.allSettled(
      [1, 2].map(() => f.qualification.generateKnockoutFromSwiss(f.stage.id, {}))
    )
    assert.lengthOf(
      results.filter((r) => r.status === 'fulfilled'),
      1
    )
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    assert.equal(failed.reason.status, 409)
    const stages = await Stage.query().where('source_stage_id', f.stage.id)
    assert.lengthOf(stages, 1)
    assert.lengthOf(await Tie.query().where('stage_id', stages[0]!.id), 2)
    await assert.rejects(
      () => f.qualification.generateKnockoutFromSwiss(f.stage.id, {}),
      /already been generated/
    )
  })

  test('failed seeding rolls back new stage and source completion; retry succeeds', async ({
    assert,
  }) => {
    const f = await setup('rollback-knockout')
    await assert.rejects(
      () =>
        f.qualification.generateKnockoutFromSwiss(f.stage.id, {
          knockout: {
            format: { starting_round: 'final' },
            ties: { default: { tie_format: 'single' } },
          },
        }),
      /too small/
    )
    assert.lengthOf(await Stage.query().where('source_stage_id', f.stage.id), 0)
    await f.stage.refresh()
    assert.notEqual(f.stage.status, 'completed')
    const result = await f.qualification.generateKnockoutFromSwiss(f.stage.id, {})
    assert.lengthOf(result.ties, 2)
  })
})
