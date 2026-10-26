import { DELETED_LEAGUE_STATUS } from '#types/league_status'
import { createHash, randomBytes } from 'node:crypto'
import { Exception } from '@adonisjs/core/exceptions'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import env from '#start/env'

type ClaimInput = { playerId: number; leagueId: number; seasonId: number }
const digest = (token: string) => createHash('sha256').update(token).digest('hex')
const unavailable = () =>
  new Exception('This claim link is invalid, expired, or already used', { status: 410 })

export default class PlayerClaimService {
  async issue(issuerId: number, input: ClaimInput) {
    const token = randomBytes(32).toString('hex')
    await db.transaction(async (trx) => {
      // A write first serializes issuance/redemption on SQLite as well as PostgreSQL.
      const locked = await trx
        .from('players')
        .where('id', input.playerId)
        .whereNull('user_id')
        .update({ user_id: null })
      if (!locked)
        throw new Exception('Player is missing or already linked to an account', { status: 409 })
      await this.assertAuthority(trx, issuerId, input)
      const now = new Date()
      await trx
        .from('player_claims')
        .where('player_id', input.playerId)
        .whereNull('redeemed_at')
        .whereNull('revoked_at')
        .update({ revoked_at: now })
      await trx.table('player_claims').insert({
        token_hash: digest(token),
        player_id: input.playerId,
        league_id: input.leagueId,
        season_id: input.seasonId,
        issued_by: issuerId,
        verification_method: 'admin_link_v1',
        expires_at: new Date(now.getTime() + 48 * 60 * 60 * 1000),
        created_at: now,
      })
    })
    return { claimLink: new URL(`/claim/${token}`, env.get('APP_URL')).href }
  }

  async isAvailable(token: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(token)) return false
    return Boolean(
      await db
        .from('player_claims')
        .where('token_hash', digest(token))
        .where('verification_method', 'admin_link_v1')
        .whereNull('revoked_at')
        .whereNull('redeemed_at')
        .where('expires_at', '>', new Date())
        .first()
    )
  }

  async redeem(token: string, userId: number) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw unavailable()
    try {
      return await db.transaction(async (trx) => {
        // Write before reading prevents SQLite deferred-transaction upgrade races.
        // The user row also serializes different claims redeemed by the same account.
        await trx.from('users').where('id', userId).update({ id: userId })
        const claim = await trx.from('player_claims').where('token_hash', digest(token)).first()
        if (!claim) throw unavailable()
        const linked = await trx
          .from('players')
          .where('id', claim.player_id)
          .whereNull('user_id')
          .update({ user_id: userId })
        if (!linked) throw new Exception('Player is already linked to an account', { status: 409 })
        const ownProfile = await trx
          .from('players')
          .where('user_id', userId)
          .whereNot('id', claim.player_id)
          .first()
        if (ownProfile)
          throw new Exception(
            'You already have a player profile. Contact your league administrator for help.',
            { status: 409 }
          )
        // Conditional consumption and the player update commit together or both roll back.
        const consumed = await trx
          .from('player_claims')
          .where('id', claim.id)
          .where('verification_method', 'admin_link_v1')
          .whereNull('redeemed_at')
          .whereNull('revoked_at')
          .where('expires_at', '>', new Date())
          .update({ redeemed_at: new Date(), redeemed_by: userId })
        if (!consumed) throw unavailable()
        await this.assertAuthority(trx, claim.issued_by, {
          playerId: claim.player_id,
          leagueId: claim.league_id,
          seasonId: claim.season_id,
        })
        return { playerId: Number(claim.player_id) }
      })
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Exception(
          'You already have a player profile. Contact your league administrator for help.',
          { status: 409 }
        )
      }
      throw error
    }
  }

  private async assertAuthority(
    trx: TransactionClientContract,
    issuerId: number | null,
    input: ClaimInput
  ) {
    const league = await trx.from('leagues').where('id', input.leagueId).first()
    const season = await trx
      .from('seasons')
      .where('id', input.seasonId)
      .where('league_id', input.leagueId)
      .first()
    const memberships = await trx
      .from('league_players')
      .where('player_id', input.playerId)
      .where('league_id', input.leagueId)
      .where('season_id', input.seasonId)
      .whereIn('status', ['active', 'injured', 'suspended'])
      .whereNull('left_at')
    if (
      !issuerId ||
      !league ||
      league.status === DELETED_LEAGUE_STATUS ||
      !season ||
      !memberships.length
    ) {
      throw new Exception(
        'A current verified roster membership and authorized issuer are required',
        { status: 403 }
      )
    }
    if (Number(league.user_id) === issuerId) return
    const teamIds = memberships
      .map((membership) => membership.team_id)
      .filter((id): id is number => id !== null)
    const admin = teamIds.length
      ? await trx
          .from('team_admins')
          .join('teams', 'teams.id', 'team_admins.team_id')
          .where('team_admins.user_id', issuerId)
          .where('team_admins.league_id', input.leagueId)
          .where('teams.league_id', input.leagueId)
          .whereIn('team_admins.team_id', teamIds)
          .whereNull('team_admins.removed_at')
          .first()
      : null
    if (!admin)
      throw new Exception(
        'Only the league owner or this player’s team administrator can issue a claim',
        { status: 403 }
      )
  }
}
