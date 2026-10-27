import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { DateTime } from 'luxon'
import env from '#start/env'

import Country from '#models/country'
import FavouriteLeague from '#models/favourite_league'
import Game from '#models/game'
import League from '#models/league'
import Season from '#models/season'
import Stage from '#models/stage'
import Team from '#models/team'
import Tie from '#models/tie'
import User from '#models/user'

import { nextRound } from '#lib/bracket_rounds'
import BracketService from '#services/bracket_service'
import StageService from '#services/stage_service'
import SwissPairingService from '#services/swiss_pairing_service'
import SwissQualificationService from '#services/swiss_qualification_service'
import TieResolver from '#services/tie_resolver'
import type { BracketRound, SwissStageConfig } from '#types/stage'

/**
 * Swiss-format test fixtures: four leagues, each 36 teams across two
 * campuses, frozen at a different point in the opening stage so the mobile
 * app's Swiss tab can be exercised at every stage without manually drawing
 * teams and playing games through the UI first.
 *
 * Run with: node ace db:seed --files database/seeders/swiss_demo_seeder.ts
 */

const TEAM_COUNT = 36
const GROUP_NAMES = ['Ikole Campus', 'Oye Campus']

type ScenarioKey =
  | 'fresh'
  | 'round1'
  | 'round2'
  | 'round3'
  | 'playoffs'
  | 'knockoutQf'
  | 'knockoutSf'
  | 'knockout'

type Scenario = {
  key: ScenarioKey
  leagueName: string
  roundsPlayed: number
  playPlayoffs: boolean
  playKnockout: boolean
  /** Stop the knockout bracket after this round completes (omit to play through the final). */
  knockoutStopAfterRound?: BracketRound
  description: string
}

const SCENARIOS: Scenario[] = [
  {
    key: 'fresh',
    leagueName: 'Swiss Demo - Fresh Draw',
    roundsPlayed: 0,
    playPlayoffs: false,
    playKnockout: false,
    description:
      'Teams are drawn into two campuses. No rounds have been generated yet - use this to test round 1 pairing.',
  },
  {
    key: 'round1',
    leagueName: 'Swiss Demo - Round 1 Complete',
    roundsPlayed: 1,
    playPlayoffs: false,
    playKnockout: false,
    description:
      'Round 1 has been generated and every game played to full time. Round 2 is ready to generate.',
  },
  {
    key: 'round2',
    leagueName: 'Swiss Demo - Round 2 Complete',
    roundsPlayed: 2,
    playPlayoffs: false,
    playKnockout: false,
    description: 'Rounds 1 and 2 are complete. Round 3 is ready to generate.',
  },
  {
    key: 'round3',
    leagueName: 'Swiss Demo - Round 3 Complete',
    roundsPlayed: 3,
    playPlayoffs: false,
    playKnockout: false,
    description:
      'All 3 rounds are complete. Qualification tiers and playoff pairing are ready to test.',
  },
  {
    key: 'playoffs',
    leagueName: 'Swiss Demo - Playoffs Complete',
    roundsPlayed: 3,
    playPlayoffs: true,
    playKnockout: false,
    description:
      "All 3 rounds and both campuses' playoffs are complete. The knockout preview and generation are ready to test.",
  },
  {
    key: 'knockoutQf',
    leagueName: 'Swiss Demo - Knockout QF Complete',
    roundsPlayed: 3,
    playPlayoffs: true,
    playKnockout: true,
    knockoutStopAfterRound: 'qf',
    description:
      'The knockout bracket has been generated and every quarter-final is complete. Semi-finals are ready to generate.',
  },
  {
    key: 'knockoutSf',
    leagueName: 'Swiss Demo - Knockout SF Complete',
    roundsPlayed: 3,
    playPlayoffs: true,
    playKnockout: true,
    knockoutStopAfterRound: 'sf',
    description:
      'Quarter-finals and semi-finals are complete. The final is ready to generate, then the stage can be marked complete.',
  },
  {
    key: 'knockout',
    leagueName: 'Swiss Demo - Knockout Complete',
    roundsPlayed: 3,
    playPlayoffs: true,
    playKnockout: true,
    description:
      'The full competition has been played through: rounds, playoffs, and the knockout bracket (including the final) are all complete.',
  },
]

function swissConfig(): SwissStageConfig {
  return {
    format: { rounds: 3, byeHandling: 'warn' },
    qualification: { directCount: 1, playoffRankFrom: 2, playoffRankTo: 5 },
  }
}

export default class SwissDemoSeeder extends BaseSeeder {
  private pairing = new SwissPairingService()
  private qualification = new SwissQualificationService()
  private tieResolver = new TieResolver()
  private bracketService = new BracketService(new StageService(), this.tieResolver)

  async run() {
    if (env.get('NODE_ENV') === 'production' && env.get('ALLOW_DEMO_SEED') !== true) {
      throw new Error(
        'SwissDemoSeeder blocked in production. Set ALLOW_DEMO_SEED=true to run intentionally.'
      )
    }

    const adminEmail = env.get('REVIEW_ADMIN_EMAIL')
    if (!adminEmail) {
      throw new Error(
        'SwissDemoSeeder requires REVIEW_ADMIN_EMAIL so the seeded leagues are owned by the OTP-bypass account.'
      )
    }

    const country = await Country.firstOrCreate({ code: 'ng' }, { name: 'Nigeria', code: 'ng' })
    const admin = await User.updateOrCreate(
      { email: adminEmail },
      { email: adminEmail, fullName: 'Review Admin' }
    )

    for (const scenario of SCENARIOS) {
      await this.seedScenario(admin.id, country.id, scenario)
    }

    console.log(`SwissDemoSeeder complete: ${SCENARIOS.map((s) => s.leagueName).join(', ')}`)
  }

  private async seedScenario(ownerId: number, countryId: number, scenario: Scenario) {
    const league = await League.updateOrCreate(
      { name: scenario.leagueName },
      {
        name: scenario.leagueName,
        userId: ownerId,
        countryId,
        description: scenario.description,
        gender: 'mixed',
      }
    )

    const season = await Season.updateOrCreate(
      { leagueId: league.id, name: '2026 Swiss Demo' },
      { leagueId: league.id, name: '2026 Swiss Demo', status: 'active' }
    )

    await FavouriteLeague.updateOrCreate(
      { userId: ownerId, leagueId: league.id },
      { userId: ownerId, leagueId: league.id }
    )

    const existingStage = await Stage.query()
      .where('season_id', season.id)
      .where('stage_type', 'swiss')
      .first()
    if (existingStage) {
      // Already seeded on a previous run - leave it as-is.
      return
    }

    const teams = await this.ensureTeams(league.id, ownerId)

    const { stage, groups } = await this.pairing.createSwissStage(league.id, season.id, {
      name: 'Opening Stage',
      groupNames: GROUP_NAMES,
      config: swissConfig(),
    })

    const half = teams.length / 2
    await this.pairing.assignTeams(stage.id, {
      mode: 'manual',
      assignments: [
        ...teams.slice(0, half).map((t) => ({ teamId: t.id, stageGroupId: groups[0]!.id })),
        ...teams.slice(half).map((t) => ({ teamId: t.id, stageGroupId: groups[1]!.id })),
      ],
    })

    for (let round = 1; round <= scenario.roundsPlayed; round++) {
      for (const group of groups) {
        const proposal = await this.pairing.proposeRound(stage.id, group.id, round, {
          mode: 'auto',
        })
        await this.pairing.confirmRound(stage.id, group.id, round, {
          fixtures: proposal.fixtures,
          byeTeamId: proposal.byeTeamId,
          playedAt:
            DateTime.utc()
              .minus({ days: (scenario.roundsPlayed - round) * 7 })
              .toISO() ?? undefined,
        })
        await this.completeRoundGames(stage.id, group.id, round)
      }
    }

    if (scenario.playPlayoffs) {
      for (const group of groups) {
        const proposal = await this.qualification.proposePlayoff(stage.id, group.id)
        if (proposal.fixtures.length === 0) {
          continue
        }
        await this.qualification.confirmPlayoff(stage.id, group.id, {
          fixtures: proposal.fixtures,
        })
        await this.completeRoundGames(stage.id, group.id, scenario.roundsPlayed + 1)
      }
    }

    if (scenario.playKnockout) {
      const knockout = await this.qualification.generateKnockoutFromSwiss(stage.id, {})
      await this.playKnockoutBracket(knockout.stage.id, scenario.knockoutStopAfterRound)
    }
  }

  private async ensureTeams(leagueId: number, ownerId: number): Promise<Team[]> {
    const teams: Team[] = []
    for (let i = 1; i <= TEAM_COUNT; i++) {
      const name = `Team ${String(i).padStart(2, '0')}`
      const team = await Team.updateOrCreate(
        { leagueId, name },
        { leagueId, name, addedBy: ownerId }
      )
      teams.push(team)
    }
    return teams
  }

  /** Lower team id always wins, so standings are decisive and reproducible. */
  private async completeRoundGames(stageId: number, stageGroupId: number, roundNumber: number) {
    const games = await Game.query()
      .where('stage_id', stageId)
      .where('stage_group_id', stageGroupId)
      .where('round_number', roundNumber)

    for (const game of games) {
      const homeWins = game.homeTeamId < game.awayTeamId
      game.status = 'full_time'
      game.homeScore = homeWins ? 2 : 0
      game.awayScore = homeWins ? 0 : 2
      game.winnerTeamId = homeWins ? game.homeTeamId : game.awayTeamId
      await game.save()
    }
  }

  /**
   * Plays a generated knockout bracket round by round. Pass `stopAfterRound`
   * to leave that round completed without generating the next one (e.g. to
   * freeze the fixture at "quarter-finals done, semis not generated yet").
   * Omit it to play all the way through the final and mark the stage complete.
   */
  private async playKnockoutBracket(knockoutStageId: number, stopAfterRound?: BracketRound) {
    const firstTie = await Tie.query().where('stage_id', knockoutStageId).first()
    let round: BracketRound | null = (firstTie?.round as BracketRound | undefined) ?? null

    while (round) {
      await this.completeRoundTies(knockoutStageId, round)
      if (round === stopAfterRound) {
        return
      }
      await this.bracketService.generateNextRound(knockoutStageId, round)
      if (round === 'final') {
        return
      }
      round = nextRound(round)
    }
  }

  /** Lower team id always wins each knockout tie, so the bracket resolves deterministically. */
  private async completeRoundTies(stageId: number, round: BracketRound) {
    const ties = await Tie.query()
      .where('stage_id', stageId)
      .where('round', round)
      .where('is_bye', false)

    for (const tie of ties) {
      const game = await Game.query().where('tie_id', tie.id).orderBy('leg', 'asc').first()
      if (!game || game.status === 'full_time') {
        continue
      }
      const homeWins = (tie.homeTeamId ?? 0) < (tie.awayTeamId ?? 0)
      game.status = 'full_time'
      game.homeScore = homeWins ? 2 : 0
      game.awayScore = homeWins ? 0 : 2
      game.winnerTeamId = homeWins ? tie.homeTeamId! : tie.awayTeamId!
      await game.save()
      await this.tieResolver.advanceTie(tie.id)
    }
  }
}
