import { Exception } from '@adonisjs/core/exceptions'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'

import db from '@adonisjs/lucid/services/db'
import Game from '#models/game'
import Season from '#models/season'
import Stage from '#models/stage'
import StageGroup from '#models/stage_group'
import StageTeam from '#models/stage_team'
import StandingAdjustment from '#models/standing_adjustment'
import Team from '#models/team'
import Venue from '#models/venue'
import StageStandingService from '#services/stage_standing_service'
import AuditService from '#services/audit_service'
import type { AssignTeamsInput } from '#services/group_stage_service'
import { snakeAssign } from '#services/group_stage_service'
import type { SwissStageConfig, StageStatus } from '#types/stage'

export type CreateSwissStageInput = {
  name: string
  sequence?: number
  groupNames: string[]
  config: SwissStageConfig
}

export type ProposedFixture = { homeTeamId: number; awayTeamId: number }

export type PairingConflict =
  | { type: 'rematch'; teamIds: [number, number] }
  | { type: 'no_pair_violation'; teamIds: [number, number] }
  | { type: 'unresolved_team'; teamIds: number[] }

export type ProposeRoundInput =
  | { mode: 'auto'; allowIncompleteRounds?: boolean }
  | { mode: 'manual'; fixtures: ProposedFixture[]; allowIncompleteRounds?: boolean }

export type ProposeRoundResult = {
  fixtures: ProposedFixture[]
  conflicts: PairingConflict[]
  unresolvedTeamIds: number[]
  byeTeamId: number | null
}

export type ConfirmRoundInput = {
  fixtures: ProposedFixture[]
  playedAt?: string
  venueName?: string | null
  venueId?: number | null
  byeTeamId?: number | null
  forceOverride?: boolean
}

function parseConfig(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) {
    return {}
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return raw as Record<string, unknown>
}

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`
}

/** Deterministic PRNG so a round's random draw can be reproduced from its stored seed. */
function mulberry32(seed: number) {
  let t = seed
  return function random() {
    t |= 0
    t = (t + 0x6d2b79f5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export function seededShuffle<T>(items: T[], seed: number): T[] {
  const random = mulberry32(seed)
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

function violatesNoPair(a: number, b: number, config: SwissStageConfig): boolean {
  const noPair = config.constraints?.noPair ?? []
  return noPair.some(
    (rule) =>
      (rule.teamIds[0] === a && rule.teamIds[1] === b) ||
      (rule.teamIds[0] === b && rule.teamIds[1] === a)
  )
}

/**
 * Backtracking search for a full pairing with no rematches and no "do not pair"
 * violations. `order` must already be sorted by standings (closest-ranked teams
 * first), so partners are tried closest-rank-first. Returns null only when no
 * perfect matching exists at all.
 */
export function backtrackPairs(
  order: number[],
  playedPairs: Set<string>,
  config: SwissStageConfig
): ProposedFixture[] | null {
  if (order.length === 0) {
    return []
  }

  const [a, ...rest] = order
  for (const b of rest) {
    if (playedPairs.has(pairKey(a!, b)) || violatesNoPair(a!, b, config)) {
      continue
    }
    const remaining = rest.filter((team) => team !== b)
    const result = backtrackPairs(remaining, playedPairs, config)
    if (result) {
      return [{ homeTeamId: a!, awayTeamId: b }, ...result]
    }
  }

  return null
}

/** Last-resort fallback when no perfect matching exists: pair what's possible. */
function greedyPair(
  order: number[],
  playedPairs: Set<string>,
  config: SwissStageConfig
): { fixtures: ProposedFixture[]; unresolved: number[] } {
  const remaining = [...order]
  const fixtures: ProposedFixture[] = []
  const unresolved: number[] = []

  while (remaining.length > 0) {
    const a = remaining.shift()!
    const index = remaining.findIndex(
      (b) => !playedPairs.has(pairKey(a, b)) && !violatesNoPair(a, b, config)
    )
    if (index === -1) {
      unresolved.push(a)
      continue
    }
    const [b] = remaining.splice(index, 1)
    fixtures.push({ homeTeamId: a, awayTeamId: b! })
  }

  return { fixtures, unresolved }
}

/** A group without its own override falls back to the stage's default qualification rule. */
export function resolveGroupQualificationRule(
  config: SwissStageConfig,
  stageGroupId: number
): SwissStageConfig['qualification'] {
  return config.qualificationByGroup?.[String(stageGroupId)] ?? config.qualification
}

export function validatePairing(
  fixtures: ProposedFixture[],
  playedPairs: Set<string>,
  config: SwissStageConfig
): PairingConflict[] {
  const conflicts: PairingConflict[] = []
  for (const fixture of fixtures) {
    const key = pairKey(fixture.homeTeamId, fixture.awayTeamId)
    if (playedPairs.has(key)) {
      conflicts.push({ type: 'rematch', teamIds: [fixture.homeTeamId, fixture.awayTeamId] })
    }
    if (violatesNoPair(fixture.homeTeamId, fixture.awayTeamId, config)) {
      conflicts.push({
        type: 'no_pair_violation',
        teamIds: [fixture.homeTeamId, fixture.awayTeamId],
      })
    }
  }
  return conflicts
}

/** A `venueId` always wins and snapshots that venue's current name onto the game. */
export async function resolveVenueSnapshot(
  leagueId: number,
  venueId: number | null | undefined,
  venueName: string | null | undefined
): Promise<{ venueId: number | null; venueName: string | null }> {
  if (venueId === null || venueId === undefined) {
    return { venueId: null, venueName: venueName ?? null }
  }

  const venue = await Venue.find(venueId)
  if (!venue || venue.leagueId !== leagueId) {
    throw new Exception('Venue not found in this league', { status: 422 })
  }

  return { venueId: venue.id, venueName: venue.name }
}

@inject()
export default class SwissPairingService {
  constructor(
    private stageStandingService: StageStandingService = new StageStandingService(),
    private auditService: AuditService = new AuditService()
  ) {}

  getSwissConfig(stage: Stage): SwissStageConfig {
    const raw = parseConfig(stage.config)
    const format = (raw.format ?? {}) as Record<string, unknown>
    const qualification = (raw.qualification ?? {}) as Record<string, unknown>

    const rounds = Number(format.rounds)
    if (!Number.isFinite(rounds) || rounds < 1) {
      throw new Exception('Swiss stage is missing format.rounds', { status: 422 })
    }

    return {
      format: {
        rounds,
        byeHandling: (format.byeHandling as SwissStageConfig['format']['byeHandling']) ?? 'warn',
        seed: typeof format.seed === 'number' ? format.seed : undefined,
      },
      qualification: {
        directCount: Number(qualification.directCount ?? 0),
        playoffRankFrom: Number(qualification.playoffRankFrom ?? 0),
        playoffRankTo: Number(qualification.playoffRankTo ?? 0),
        playoffPairing:
          (qualification.playoffPairing as SwissStageConfig['qualification']['playoffPairing']) ??
          'rank_cross',
      },
      qualificationByGroup: raw.qualificationByGroup as SwissStageConfig['qualificationByGroup'],
      constraints: raw.constraints as SwissStageConfig['constraints'],
    }
  }

  /** Full replace of the stage's config (e.g. setting per-group qualification overrides once group ids are known). */
  async updateConfig(
    stageId: number,
    config: SwissStageConfig,
    audit?: { leagueId: number; actorId?: number | null; ipAddress?: string | null }
  ): Promise<Stage> {
    const stage = await Stage.query().where('id', stageId).firstOrFail()
    if (stage.stageType !== 'swiss') {
      throw new Exception('Config update is only valid for swiss stages', { status: 422 })
    }
    // JSON.stringify explicitly: sqlite (dev/test) cannot bind a plain object,
    // while Postgres jsonb accepts the string form just as well.
    stage.config = JSON.stringify(config)
    await stage.save()

    if (audit) {
      await this.auditService.log({
        leagueId: audit.leagueId,
        actorId: audit.actorId,
        action: 'swiss_stage.config_updated',
        entityType: 'stage',
        entityId: stageId,
        metadata: { config },
        ipAddress: audit.ipAddress,
      })
    }

    return stage
  }

  async createSwissStage(
    leagueId: number,
    seasonId: number,
    input: CreateSwissStageInput,
    client?: TransactionClientContract,
    audit?: { actorId?: number | null; ipAddress?: string | null }
  ): Promise<{ stage: Stage; groups: StageGroup[] }> {
    if (input.groupNames.length === 0) {
      throw new Exception('At least one group name is required', { status: 422 })
    }

    const run = async (trx: TransactionClientContract) => {
      const season = await Season.query({ client: trx })
        .where('id', seasonId)
        .where('league_id', leagueId)
        .firstOrFail()

      const last = await Stage.query({ client: trx })
        .where('season_id', season.id)
        .orderBy('sequence', 'desc')
        .first()
      const nextSequence = input.sequence ?? (last ? last.sequence + 1 : 1)

      const stage = await Stage.create(
        {
          seasonId: season.id,
          name: input.name,
          stageType: 'swiss',
          sequence: nextSequence,
          status: 'upcoming' as StageStatus,
          config: input.config,
        },
        { client: trx }
      )

      const groups: StageGroup[] = []
      for (let i = 0; i < input.groupNames.length; i++) {
        groups.push(
          await StageGroup.create(
            { stageId: stage.id, name: input.groupNames[i]!, sequence: i + 1 },
            { client: trx }
          )
        )
      }

      return { stage, groups }
    }

    const result = client ? await run(client) : await db.transaction(run)

    if (audit) {
      await this.auditService.log({
        leagueId,
        actorId: audit.actorId,
        action: 'swiss_stage.created',
        entityType: 'stage',
        entityId: result.stage.id,
        metadata: { name: result.stage.name, groups: result.groups.map((g) => g.name) },
        ipAddress: audit.ipAddress,
      })
    }

    return result
  }

  async assignTeams(
    stageId: number,
    input: AssignTeamsInput,
    audit?: { leagueId: number; actorId?: number | null; ipAddress?: string | null }
  ) {
    const stage = await Stage.query().where('id', stageId).preload('season').firstOrFail()
    if (stage.stageType !== 'swiss') {
      throw new Exception('Team assignment is only valid for swiss stages', { status: 422 })
    }

    const existing = await StageTeam.query().where('stage_id', stageId).first()
    if (existing) {
      throw new Exception('Teams are already assigned for this stage', { status: 409 })
    }

    const groups = await StageGroup.query().where('stage_id', stageId).orderBy('sequence', 'asc')
    if (groups.length === 0) {
      throw new Exception('Stage has no groups to assign teams to', { status: 422 })
    }

    let assignments: Array<{ teamId: number; stageGroupId: number; seed: number }>

    if (input.mode === 'manual') {
      const groupIds = new Set(groups.map((g) => g.id))
      for (const row of input.assignments) {
        if (!groupIds.has(row.stageGroupId)) {
          throw new Exception(`Invalid stageGroupId ${row.stageGroupId}`, { status: 422 })
        }
      }
      const teamIds = input.assignments.map((a) => a.teamId)
      if (new Set(teamIds).size !== teamIds.length) {
        throw new Exception('Duplicate team in assignments', { status: 422 })
      }
      await this.assertTeamsInLeague(stage.season.leagueId, teamIds)
      assignments = input.assignments.map((a, index) => ({
        teamId: a.teamId,
        stageGroupId: a.stageGroupId,
        seed: index + 1,
      }))
    } else {
      const teamIds = [...input.teamIds]
      await this.assertTeamsInLeague(stage.season.leagueId, teamIds)
      assignments = snakeAssign(
        teamIds,
        groups.map((g) => g.id)
      )
    }

    await db.transaction(async (trx) => {
      for (const row of assignments) {
        await StageTeam.create(
          { stageId, teamId: row.teamId, stageGroupId: row.stageGroupId, seed: row.seed },
          { client: trx }
        )
      }
    })

    if (audit) {
      await this.auditService.log({
        leagueId: audit.leagueId,
        actorId: audit.actorId,
        action: 'swiss_stage.teams_assigned',
        entityType: 'stage',
        entityId: stageId,
        metadata: { mode: input.mode, count: assignments.length },
        ipAddress: audit.ipAddress,
      })
    }

    return assignments
  }

  async proposeRound(
    stageId: number,
    stageGroupId: number,
    roundNumber: number,
    input: ProposeRoundInput
  ): Promise<ProposeRoundResult> {
    const { stage, group, config } = await this.loadContext(stageId, stageGroupId)
    this.assertRoundInRange(config, roundNumber)
    await this.assertPreviousRoundsComplete(stage, group, roundNumber, input.allowIncompleteRounds)

    const teamIds = await this.loadGroupTeamIds(stageId, group.id)
    const playedPairs = await this.loadPlayedPairs(stageId, group.id)

    if (input.mode === 'manual') {
      const conflicts = validatePairing(input.fixtures, playedPairs, config)
      const pairedTeamIds = new Set(input.fixtures.flatMap((f) => [f.homeTeamId, f.awayTeamId]))
      const unresolvedTeamIds = teamIds.filter((id) => !pairedTeamIds.has(id))
      if (unresolvedTeamIds.length > 0) {
        conflicts.push({ type: 'unresolved_team', teamIds: unresolvedTeamIds })
      }
      return { fixtures: input.fixtures, conflicts, unresolvedTeamIds, byeTeamId: null }
    }

    const order = await this.resolveStandingsOrder(stage, group, roundNumber, teamIds, config)

    let byeTeamId: number | null = null
    let pairable = order
    if (pairable.length % 2 === 1) {
      byeTeamId = pairable[pairable.length - 1]!
      pairable = pairable.slice(0, -1)
    }

    const pairs = backtrackPairs(pairable, playedPairs, config)
    if (pairs) {
      return { fixtures: pairs, conflicts: [], unresolvedTeamIds: [], byeTeamId }
    }

    // No perfect matching exists (rare, with no-rematch this tight) — pair what we
    // can and flag whoever is left for the admin to resolve by hand.
    const { fixtures, unresolved } = greedyPair(pairable, playedPairs, config)
    return {
      fixtures,
      conflicts: unresolved.length > 0 ? [{ type: 'unresolved_team', teamIds: unresolved }] : [],
      unresolvedTeamIds: unresolved,
      byeTeamId,
    }
  }

  async confirmRound(
    stageId: number,
    stageGroupId: number,
    roundNumber: number,
    input: ConfirmRoundInput,
    audit?: { leagueId: number; actorId?: number | null; ipAddress?: string | null }
  ) {
    const { stage, group, config } = await this.loadContext(stageId, stageGroupId)
    this.assertRoundInRange(config, roundNumber)

    const playedPairs = await this.loadPlayedPairs(stageId, group.id)
    const conflicts = validatePairing(input.fixtures, playedPairs, config)
    const blocking = conflicts.filter((c) => c.type === 'rematch' || c.type === 'no_pair_violation')
    if (blocking.length > 0 && !input.forceOverride) {
      throw new Exception(
        'This round has an unresolved pairing conflict (rematch or constraint violation). Confirm with forceOverride to proceed anyway.',
        { status: 422 }
      )
    }

    const season = stage.season
    const playedAt = input.playedAt ? DateTime.fromISO(input.playedAt) : DateTime.utc()
    const venue = await resolveVenueSnapshot(season.leagueId, input.venueId, input.venueName)
    const created: Game[] = []

    await db.transaction(async (trx) => {
      // Acquire the write lock before reading: serializes confirmations on
      // PostgreSQL and avoids SQLite read-to-write upgrade races.
      await trx.from('stage_groups').where('id', group.id).update({ id: group.id })
      const existing = await Game.query({ client: trx })
        .where('stage_id', stageId)
        .where('stage_group_id', group.id)
        .where('round_number', roundNumber)
        .first()
      if (existing) {
        throw new Exception(`Round ${roundNumber} fixtures already exist for this group`, {
          status: 409,
        })
      }

      let index = 0
      for (const fixture of input.fixtures) {
        created.push(
          await Game.create(
            {
              leagueId: season.leagueId,
              seasonId: season.id,
              stageId: stage.id,
              stageGroupId: group.id,
              homeTeamId: fixture.homeTeamId,
              awayTeamId: fixture.awayTeamId,
              status: 'scheduled',
              playedAt: playedAt.plus({ minutes: index }),
              venueId: venue.venueId,
              venueName: venue.venueName,
              roundNumber,
              tieId: null,
              round: null,
              leg: null,
            },
            { client: trx }
          )
        )
        index++
      }

      if (input.byeTeamId) {
        await this.applyBye(stage, group, input.byeTeamId, config, trx)
      }

      if (stage.status === 'upcoming') {
        stage.useTransaction(trx)
        stage.status = 'active'
        await stage.save()
      }
    })

    if (audit) {
      await this.auditService.log({
        leagueId: audit.leagueId,
        actorId: audit.actorId,
        action: 'swiss_stage.round_confirmed',
        entityType: 'stage',
        entityId: stageId,
        metadata: {
          stageGroupId: group.id,
          roundNumber,
          gameCount: created.length,
          forceOverride: !!input.forceOverride,
          conflictCount: conflicts.length,
        },
        ipAddress: audit.ipAddress,
      })
    }

    return { games: created, count: created.length }
  }

  private async loadContext(stageId: number, stageGroupId: number) {
    const stage = await Stage.query().where('id', stageId).preload('season').firstOrFail()
    if (stage.stageType !== 'swiss') {
      throw new Exception('Pairing is only valid for swiss stages', { status: 422 })
    }
    const group = await StageGroup.query()
      .where('id', stageGroupId)
      .where('stage_id', stageId)
      .firstOrFail()
    const config = this.getSwissConfig(stage)
    return { stage, group, config }
  }

  private assertRoundInRange(config: SwissStageConfig, roundNumber: number) {
    if (roundNumber < 1 || roundNumber > config.format.rounds) {
      throw new Exception(`roundNumber must be between 1 and ${config.format.rounds}`, {
        status: 422,
      })
    }
  }

  private async assertPreviousRoundsComplete(
    stage: Stage,
    group: StageGroup,
    roundNumber: number,
    allowIncompleteRounds?: boolean
  ) {
    if (roundNumber <= 1 || allowIncompleteRounds) {
      return
    }
    const unfinished = await Game.query()
      .where('stage_id', stage.id)
      .where('stage_group_id', group.id)
      .where('round_number', roundNumber - 1)
      .whereNotIn('status', ['full_time', 'cancelled', 'postponed'])
      .first()
    if (unfinished) {
      throw new Exception(
        `Round ${roundNumber - 1} is not finished yet. Pass allowIncompleteRounds to override.`,
        { status: 409 }
      )
    }
  }

  private async loadGroupTeamIds(stageId: number, stageGroupId: number): Promise<number[]> {
    const stageTeams = await StageTeam.query()
      .where('stage_id', stageId)
      .where('stage_group_id', stageGroupId)
      .orderBy('seed', 'asc')
    return stageTeams.map((st) => st.teamId)
  }

  private async loadPlayedPairs(stageId: number, stageGroupId: number): Promise<Set<string>> {
    const games = await Game.query()
      .where('stage_id', stageId)
      .where('stage_group_id', stageGroupId)
    return new Set(games.map((g) => pairKey(g.homeTeamId, g.awayTeamId)))
  }

  private async resolveStandingsOrder(
    stage: Stage,
    group: StageGroup,
    roundNumber: number,
    teamIds: number[],
    config: SwissStageConfig
  ): Promise<number[]> {
    if (roundNumber === 1) {
      let seed = config.format.seed
      if (seed === undefined) {
        seed = Math.floor(Math.random() * 2 ** 31)
        await this.persistSeed(stage, seed)
      }
      return seededShuffle(teamIds, seed)
    }

    const rows = await this.stageStandingService.rawTableRows(stage.id, group.id)
    const teamIdSet = new Set(teamIds)
    return rows.map((r) => r.teamId).filter((id) => teamIdSet.has(id))
  }

  private async persistSeed(stage: Stage, seed: number) {
    const raw = parseConfig(stage.config)
    const format = (raw.format ?? {}) as Record<string, unknown>
    // JSON.stringify explicitly: sqlite (dev/test) cannot bind a plain object,
    // while Postgres jsonb accepts the string form just as well.
    stage.config = JSON.stringify({ ...raw, format: { ...format, seed } })
    await stage.save()
  }

  private async applyBye(
    stage: Stage,
    group: StageGroup,
    teamId: number,
    config: SwissStageConfig,
    trx: TransactionClientContract
  ) {
    if (config.format.byeHandling !== 'award_points') {
      return
    }
    await StandingAdjustment.create(
      {
        stageId: stage.id,
        stageGroupId: group.id,
        teamId,
        pointsDelta: 3,
        reason: 'Swiss round bye',
      },
      { client: trx }
    )
  }

  private async assertTeamsInLeague(leagueId: number, teamIds: number[]) {
    if (teamIds.length === 0) {
      throw new Exception('At least one team is required', { status: 422 })
    }
    const teams = await Team.query().where('league_id', leagueId).whereIn('id', teamIds)
    if (teams.length !== new Set(teamIds).size) {
      throw new Exception('One or more teams are not in this league', { status: 422 })
    }
  }
}
