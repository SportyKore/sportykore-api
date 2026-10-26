import { DELETED_LEAGUE_STATUS } from '#types/league_status'
import { createHash } from 'node:crypto'
import { Exception } from '@adonisjs/core/exceptions'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import League from '#models/league'
import Season from '#models/season'
import Team from '#models/team'
import TeamAdmin from '#models/team_admin'
import Player from '#models/player'
import LeaguePlayer from '#models/league_player'

export const normalizeRosterName = (name: string) =>
  name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
export type DuplicateMatch = { normalizedName: string; inputIndexes: number[]; rosterIds: number[] }
export class DuplicateRosterNames extends Exception {
  constructor(public matches: DuplicateMatch[]) {
    super('Duplicate names require confirmation', { status: 409, code: 'DUPLICATE_NAMES' })
  }
}
export type RosterAccess = { owner: boolean; teamIds: number[] }
type CreateInput = {
  teamId: number | null
  names: string[]
  confirmDuplicates?: boolean
  requestId: string
}

export default class RosterService {
  async getAccess(
    userId: number,
    leagueId: number,
    seasonId?: number,
    trx?: TransactionClientContract
  ): Promise<RosterAccess> {
    const league = await League.query({ client: trx }).where('id', leagueId).firstOrFail()
    if (league.status === DELETED_LEAGUE_STATUS)
      throw new Exception('League not found', { status: 404 })
    if (seasonId !== undefined) {
      await Season.query({ client: trx })
        .where('id', seasonId)
        .where('league_id', leagueId)
        .firstOrFail()
    }
    const owner = league.userId === userId
    const admins = await TeamAdmin.query({ client: trx })
      .where('league_id', leagueId)
      .where('user_id', userId)
      .whereNull('removed_at')
    if (!owner && !admins.length) throw new Exception('Roster access denied', { status: 403 })
    return { owner, teamIds: admins.map((admin) => admin.teamId) }
  }

  async assertTeamAccess(
    scope: RosterAccess,
    leagueId: number,
    teamId: number | null,
    trx?: TransactionClientContract
  ) {
    if (!scope.owner && (teamId === null || !scope.teamIds.includes(teamId))) {
      throw new Exception('Team access denied', { status: 403 })
    }
    if (teamId !== null)
      await Team.query({ client: trx })
        .where('id', teamId)
        .where('league_id', leagueId)
        .firstOrFail()
  }

  private rows(leagueId: number, seasonId: number, trx?: TransactionClientContract) {
    return LeaguePlayer.query({ client: trx })
      .where('league_id', leagueId)
      .where('season_id', seasonId)
  }

  private serialize(row: LeaguePlayer) {
    return {
      id: row.id,
      leagueId: row.leagueId,
      seasonId: row.seasonId,
      playerId: row.playerId,
      teamId: row.teamId,
      status: row.status,
      jerseyNumber: row.jerseyNumber ?? null,
      position: row.position ?? null,
      isCaptain: row.isCaptain ?? false,
      joinedAt: row.joinedAt?.toISO() ?? null,
      leftAt: row.leftAt?.toISO() ?? null,
      name: row.player.name,
      player: {
        id: row.player.id,
        name: row.player.name,
        userId: row.player.userId,
        avatarUrl: row.player.avatarUrl,
      },
      team: row.team ? { id: row.team.id, name: row.team.name, logoUrl: row.team.logoUrl } : null,
    }
  }

  async list(userId: number, leagueId: number, seasonId: number, teamId?: number | null) {
    const scope = await this.getAccess(userId, leagueId, seasonId)
    const query = this.rows(leagueId, seasonId).preload('player').preload('team').orderBy('id')
    if (teamId !== undefined) {
      if (teamId === null) query.whereNull('team_id')
      else {
        await this.assertTeamAccess(scope, leagueId, teamId)
        query.where('team_id', teamId)
      }
    } else if (!scope.owner) {
      query.where((q) => q.whereIn('team_id', scope.teamIds).orWhereNull('team_id'))
    }
    const rows = await query
    return rows.map((row) => this.serialize(row))
  }

  // A write first acquires a season lock on both SQLite and PostgreSQL.
  // All roster writes take this lock before reading permissions or roster state.
  private async lock(trx: TransactionClientContract, leagueId: number, seasonId: number) {
    const count = await trx
      .from('seasons')
      .where('id', seasonId)
      .where('league_id', leagueId)
      .update({ id: seasonId })
    if (!Number(count)) throw new Exception('Season not found', { status: 404 })
  }

  async create(userId: number, leagueId: number, seasonId: number, input: CreateInput) {
    return db.transaction(async (trx) => {
      await this.lock(trx, leagueId, seasonId)
      const scope = await this.getAccess(userId, leagueId, seasonId, trx)
      await this.assertTeamAccess(scope, leagueId, input.teamId, trx)
      const names = input.names.map((name) => name.normalize('NFKC').trim().replace(/\s+/gu, ' '))
      const hash = createHash('sha256')
        .update(JSON.stringify({ teamId: input.teamId, names }))
        .digest('hex')
      const key = {
        league_id: leagueId,
        season_id: seasonId,
        user_id: userId,
        request_id: input.requestId,
      }
      const previous = await trx.from('roster_requests').where(key).first()
      if (previous) {
        if (previous.payload_hash !== hash)
          throw new Exception('Request ID already used for a different payload', {
            status: 409,
            code: 'REQUEST_ID_CONFLICT',
          })
        return JSON.parse(previous.response_body) as ReturnType<RosterService['serialize']>[]
      }
      const existing = await this.rows(leagueId, seasonId, trx).preload('player')
      const groups = new Map<string, DuplicateMatch>()
      names.forEach((name, index) => {
        const normalizedName = normalizeRosterName(name)
        const match = groups.get(normalizedName) ?? {
          normalizedName,
          inputIndexes: [],
          rosterIds: [],
        }
        match.inputIndexes.push(index)
        groups.set(normalizedName, match)
      })
      for (const row of existing) {
        if (row.player.name)
          groups.get(normalizeRosterName(row.player.name))?.rosterIds.push(row.id)
      }
      const matches = [...groups.values()].filter(
        (match) => match.inputIndexes.length > 1 || match.rosterIds.length
      )
      if (matches.length && !input.confirmDuplicates) throw new DuplicateRosterNames(matches)
      const result: ReturnType<RosterService['serialize']>[] = []
      for (const name of names) {
        const player = await Player.create(
          { name, userId: null, countryId: null, addedBy: userId },
          { client: trx }
        )
        const row = await LeaguePlayer.create(
          { leagueId, seasonId, playerId: player.id, teamId: input.teamId, status: 'active' },
          { client: trx }
        )
        await row.load('player')
        await row.load('team')
        result.push(this.serialize(row))
      }
      await trx
        .table('roster_requests')
        .insert({ ...key, payload_hash: hash, response_body: JSON.stringify(result) })
      return result
    })
  }

  async assign(
    userId: number,
    leagueId: number,
    seasonId: number,
    teamId: number,
    rosterIds: number[]
  ) {
    return db.transaction(async (trx) => {
      await this.lock(trx, leagueId, seasonId)
      const scope = await this.getAccess(userId, leagueId, seasonId, trx)
      await this.assertTeamAccess(scope, leagueId, teamId, trx)
      const ids = [...new Set(rosterIds)]
      const changed = await this.rows(leagueId, seasonId, trx)
        .whereIn('id', ids)
        .whereNull('team_id')
        .where('status', 'active')
        .update({ teamId })
      if (Number(changed) !== ids.length)
        throw new Exception('Some players are no longer available in the active pool', {
          status: 409,
          code: 'ROSTER_ASSIGNMENT_CONFLICT',
        })
      const rows = await this.rows(leagueId, seasonId, trx)
        .whereIn('id', ids)
        .preload('player')
        .preload('team')
        .orderBy('id')
      return rows.map((row) => this.serialize(row))
    })
  }

  async approve(
    userId: number,
    leagueId: number,
    seasonId: number,
    id: number,
    status: 'active' | 'rejected'
  ) {
    return db.transaction(async (trx) => {
      await this.lock(trx, leagueId, seasonId)
      const scope = await this.getAccess(userId, leagueId, seasonId, trx)
      const row = await this.rows(leagueId, seasonId, trx).where('id', id).firstOrFail()
      await this.assertTeamAccess(scope, leagueId, row.teamId, trx)
      if (row.status !== 'pending' && row.status !== status)
        throw new Exception('Registration has already been reviewed', { status: 409 })
      row.status = status
      await row.save()
      await row.load('player')
      await row.load('team')
      return this.serialize(row)
    })
  }

  async settings(userId: number, leagueId: number, value?: boolean) {
    const scope = await this.getAccess(userId, leagueId)
    if (!scope.owner)
      throw new Exception('Only the owner can manage registration settings', { status: 403 })
    if (value !== undefined)
      await db
        .from('leagues')
        .where('id', leagueId)
        .where('user_id', userId)
        .update({ public_registration_requires_approval: value })
    const row = await db.from('leagues').where('id', leagueId).firstOrFail()
    return {
      requiresApproval: Boolean(row.public_registration_requires_approval),
    }
  }
}
