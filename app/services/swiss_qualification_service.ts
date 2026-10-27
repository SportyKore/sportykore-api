import { Exception } from '@adonisjs/core/exceptions'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

import Game from '#models/game'
import Stage from '#models/stage'
import StageGroup from '#models/stage_group'
import StageStandingService, { type EnrichedTableRow } from '#services/stage_standing_service'
import SwissPairingService, {
  resolveGroupQualificationRule,
  resolveVenueSnapshot,
} from '#services/swiss_pairing_service'
import StageService from '#services/stage_service'
import AuditService from '#services/audit_service'
import type { KnockoutStageConfig, SwissQualificationRule } from '#types/stage'

export type GroupQualificationResult = {
  stageGroupId: number
  stageGroupName: string
  direct: EnrichedTableRow[]
  playoffCandidates: EnrichedTableRow[]
  eliminated: EnrichedTableRow[]
  rule: SwissQualificationRule
}

export type PlayoffProposal = {
  fixtures: Array<{ homeTeamId: number; awayTeamId: number }>
  byeTeamId: number | null
}

/** Pairs the highest remaining rank against the lowest remaining rank (2v5, 3v4 style). */
export function rankCrossPair(rankedTeamIds: number[]): PlayoffProposal {
  const ids = [...rankedTeamIds]
  let byeTeamId: number | null = null
  if (ids.length % 2 === 1) {
    const middle = Math.floor(ids.length / 2)
    byeTeamId = ids[middle] ?? null
    ids.splice(middle, 1)
  }

  const fixtures: Array<{ homeTeamId: number; awayTeamId: number }> = []
  let lo = 0
  let hi = ids.length - 1
  while (lo < hi) {
    fixtures.push({ homeTeamId: ids[lo]!, awayTeamId: ids[hi]! })
    lo++
    hi--
  }
  return { fixtures, byeTeamId }
}

@inject()
export default class SwissQualificationService {
  constructor(
    private stageStandingService: StageStandingService = new StageStandingService(),
    private swissPairingService: SwissPairingService = new SwissPairingService(),
    private stageService: StageService = new StageService(),
    private auditService: AuditService = new AuditService()
  ) {}

  async resolveGroupQualification(
    stageId: number,
    stageGroupId: number
  ): Promise<GroupQualificationResult> {
    const stage = await Stage.query().where('id', stageId).firstOrFail()
    if (stage.stageType !== 'swiss') {
      throw new Exception('Qualification is only valid for swiss stages', { status: 422 })
    }
    const group = await StageGroup.query()
      .where('id', stageGroupId)
      .where('stage_id', stageId)
      .firstOrFail()

    const config = this.swissPairingService.getSwissConfig(stage)
    const rule = resolveGroupQualificationRule(config, stageGroupId)

    const standings = await this.stageStandingService.forStage(stageId)
    const table = standings.tables.find((t) => t.stageGroupId === stageGroupId)
    if (!table) {
      throw new Exception('No standings table found for this group', { status: 422 })
    }

    const direct = table.rows.filter((row) => row.position <= rule.directCount)
    const playoffCandidates = table.rows.filter(
      (row) => row.position >= rule.playoffRankFrom && row.position <= rule.playoffRankTo
    )
    const eliminated = table.rows.filter(
      (row) =>
        row.position > rule.directCount &&
        (row.position < rule.playoffRankFrom || row.position > rule.playoffRankTo)
    )

    return { stageGroupId, stageGroupName: group.name, direct, playoffCandidates, eliminated, rule }
  }

  async proposePlayoff(stageId: number, stageGroupId: number): Promise<PlayoffProposal> {
    const { playoffCandidates } = await this.resolveGroupQualification(stageId, stageGroupId)
    // table.rows is already position-ascending, so this is rank order.
    return rankCrossPair(playoffCandidates.map((row) => row.teamId))
  }

  async confirmPlayoff(
    stageId: number,
    stageGroupId: number,
    input: {
      fixtures: Array<{ homeTeamId: number; awayTeamId: number }>
      playedAt?: string
      venueName?: string | null
      venueId?: number | null
    },
    audit?: { leagueId: number; actorId?: number | null; ipAddress?: string | null }
  ) {
    const stage = await Stage.query().where('id', stageId).preload('season').firstOrFail()
    if (stage.stageType !== 'swiss') {
      throw new Exception('Qualification is only valid for swiss stages', { status: 422 })
    }
    const group = await StageGroup.query()
      .where('id', stageGroupId)
      .where('stage_id', stageId)
      .firstOrFail()
    const config = this.swissPairingService.getSwissConfig(stage)
    const playoffRoundNumber = config.format.rounds + 1

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
        .where('round_number', playoffRoundNumber)
        .first()
      if (existing) {
        throw new Exception('Playoff fixtures already exist for this group', { status: 409 })
      }

      let index = 0
      for (const fixture of input.fixtures) {
        created.push(
          await Game.create(
            {
              leagueId: season.leagueId,
              seasonId: season.id,
              stageId,
              stageGroupId: group.id,
              homeTeamId: fixture.homeTeamId,
              awayTeamId: fixture.awayTeamId,
              status: 'scheduled',
              playedAt: playedAt.plus({ minutes: index }),
              venueId: venue.venueId,
              venueName: venue.venueName,
              roundNumber: playoffRoundNumber,
              tieId: null,
              round: null,
              leg: null,
            },
            { client: trx }
          )
        )
        index++
      }
    })

    if (audit) {
      await this.auditService.log({
        leagueId: audit.leagueId,
        actorId: audit.actorId,
        action: 'swiss_stage.playoff_confirmed',
        entityType: 'stage',
        entityId: stageId,
        metadata: { stageGroupId: group.id, gameCount: created.length },
        ipAddress: audit.ipAddress,
      })
    }

    return { games: created, count: created.length }
  }

  /** Direct qualifiers + playoff winners (+ a bye, if the playoff had an odd candidate count). */
  async resolveGroupQualifiers(stageId: number, stageGroupId: number): Promise<number[]> {
    const { direct, playoffCandidates } = await this.resolveGroupQualification(
      stageId,
      stageGroupId
    )
    if (playoffCandidates.length === 0) {
      return direct.map((row) => row.teamId)
    }

    const stage = await Stage.findOrFail(stageId)
    const config = this.swissPairingService.getSwissConfig(stage)
    const playoffRoundNumber = config.format.rounds + 1

    const playoffGames = await Game.query()
      .where('stage_id', stageId)
      .where('stage_group_id', stageGroupId)
      .where('round_number', playoffRoundNumber)

    if (playoffGames.length === 0) {
      throw new Exception('Playoff fixtures have not been generated for this group yet', {
        status: 422,
      })
    }
    const unfinished = playoffGames.find((g) => g.status !== 'full_time' || !g.winnerTeamId)
    if (unfinished) {
      throw new Exception('Playoff games are not all finished yet', { status: 422 })
    }

    const winners = playoffGames.map((g) => g.winnerTeamId!)
    const pairedTeamIds = new Set(playoffGames.flatMap((g) => [g.homeTeamId, g.awayTeamId]))
    const byeQualifier = playoffCandidates.find((row) => !pairedTeamIds.has(row.teamId))

    return [
      ...direct.map((row) => row.teamId),
      ...winners,
      ...(byeQualifier ? [byeQualifier.teamId] : []),
    ]
  }

  /**
   * Dry run of {@link generateKnockoutFromSwiss}: resolves each group's
   * qualifiers without creating anything, so the admin can see exactly who
   * would advance before confirming. A group whose playoff isn't finished
   * yet (or has none generated) comes back `ready: false` with a reason.
   */
  async previewKnockoutQualifiers(
    stageId: number,
    input: { groupOrder?: number[] } = {}
  ): Promise<{
    groups: Array<{
      stageGroupId: number
      stageGroupName: string
      ready: boolean
      reason?: string
      qualifierTeamIds: number[]
    }>
    ready: boolean
    qualifierTeamIds: number[]
  }> {
    const stage = await Stage.query().where('id', stageId).firstOrFail()
    if (stage.stageType !== 'swiss') {
      throw new Exception('generate-knockout requires a swiss stage', { status: 422 })
    }

    const groups = await StageGroup.query().where('stage_id', stageId).orderBy('sequence', 'asc')
    const order = input.groupOrder ?? groups.map((g) => g.id)
    const groupById = new Map(groups.map((g) => [g.id, g]))

    const results: Array<{
      stageGroupId: number
      stageGroupName: string
      ready: boolean
      reason?: string
      qualifierTeamIds: number[]
    }> = []

    for (const groupId of order) {
      const group = groupById.get(groupId)
      if (!group) continue

      try {
        const qualifierTeamIds = await this.resolveGroupQualifiers(stageId, groupId)
        results.push({
          stageGroupId: groupId,
          stageGroupName: group.name,
          ready: true,
          qualifierTeamIds,
        })
      } catch (error) {
        results.push({
          stageGroupId: groupId,
          stageGroupName: group.name,
          ready: false,
          reason: error instanceof Exception ? error.message : 'Not ready yet',
          qualifierTeamIds: [],
        })
      }
    }

    const ready = results.length > 0 && results.every((r) => r.ready)
    return {
      groups: results,
      ready,
      qualifierTeamIds: ready ? results.flatMap((r) => r.qualifierTeamIds) : [],
    }
  }

  async generateKnockoutFromSwiss(
    stageId: number,
    input: { name?: string; knockout?: KnockoutStageConfig; groupOrder?: number[] },
    audit?: { leagueId: number; actorId?: number | null; ipAddress?: string | null }
  ) {
    const stage = await Stage.query().where('id', stageId).preload('season').firstOrFail()
    if (stage.stageType !== 'swiss') {
      throw new Exception('generate-knockout requires a swiss stage', { status: 422 })
    }

    const groups = await StageGroup.query().where('stage_id', stageId).orderBy('sequence', 'asc')
    const order = input.groupOrder ?? groups.map((g) => g.id)

    const seededTeamIds: number[] = []
    for (const groupId of order) {
      const qualifiers = await this.resolveGroupQualifiers(stageId, groupId)
      seededTeamIds.push(...qualifiers)
    }

    if (seededTeamIds.length < 2) {
      throw new Exception('At least 2 qualifiers are required', { status: 422 })
    }

    const knockoutConfig: KnockoutStageConfig = input.knockout ?? {
      format: {},
      ties: { default: { tie_format: 'single' } },
    }
    this.stageService.assertKnockoutTieConfig(knockoutConfig)

    const { default: TieResolver } = await import('#services/tie_resolver')
    const { default: BracketService } = await import('#services/bracket_service')
    const bracketService = new BracketService(this.stageService, new TieResolver())

    const knockout = await db.transaction(async (trx) => {
      await trx.from('stages').where('id', stageId).update({ id: stageId })
      const existing = await Stage.query({ client: trx })
        .where('source_stage_id', stageId)
        .where('stage_type', 'knockout')
        .first()
      if (existing) {
        throw new Exception('A knockout has already been generated from this Swiss stage', {
          status: 409,
        })
      }
      const created = await Stage.create(
        {
          seasonId: stage.seasonId,
          name: input.name ?? 'Knockout',
          stageType: 'knockout',
          sequence: stage.sequence + 1,
          status: 'upcoming',
          sourceStageId: stage.id,
          config: knockoutConfig,
        },
        { client: trx }
      )
      await bracketService.generateKnockoutPhase(created.id, seededTeamIds, trx)
      stage.useTransaction(trx)
      stage.status = 'completed'
      await stage.save()
      return created
    })

    if (audit) {
      await this.auditService.log({
        leagueId: audit.leagueId,
        actorId: audit.actorId,
        action: 'swiss_stage.generate_knockout',
        entityType: 'stage',
        entityId: knockout.id,
        metadata: { sourceStageId: stageId, qualifiers: seededTeamIds },
        ipAddress: audit.ipAddress,
      })
    }

    const bracket = await bracketService.getBracket(knockout.id)
    return { stage: bracket.stage, ties: bracket.ties, qualifiers: seededTeamIds }
  }
}
