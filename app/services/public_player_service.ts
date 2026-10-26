import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'
import { Exception } from '@adonisjs/core/exceptions'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Invite from '#models/invite'
import League from '#models/league'
import Season from '#models/season'
import Team from '#models/team'
import Player from '#models/player'
import LeaguePlayer from '#models/league_player'
import FileService from '#services/file_service'
import { normalizeRosterName } from '#services/roster_service'
import { playerAvatarKey } from '#helpers/storage_paths'
import { DELETED_LEAGUE_STATUS } from '#types/league_status'

export default class PublicPlayerService {
  async context(token: string, trx?: TransactionClientContract) {
    const invite = await Invite.query({ client: trx })
      .where('token', token)
      .whereIn('status', ['pending', 'accepted'])
      .where('expires_at', '>', DateTime.utc().toFormat('yyyy-MM-dd HH:mm:ss'))
      .firstOrFail()
    if (!invite.leagueId || invite.invitedUserId !== null) {
      throw new Exception('This invitation requires the invited account.', { status: 403 })
    }
    const league = await League.query({ client: trx }).where('id', invite.leagueId).firstOrFail()
    if (league.status === DELETED_LEAGUE_STATUS)
      throw new Exception('League not found', { status: 404 })
    await Season.query({ client: trx })
      .where('id', invite.seasonId)
      .where('league_id', league.id)
      .firstOrFail()
    const team =
      invite.teamId === null
        ? null
        : await Team.query({ client: trx })
            .where('id', invite.teamId)
            .where('league_id', league.id)
            .firstOrFail()
    const settings = await (trx ?? db)
      .from('leagues')
      .where('id', league.id)
      .select('public_registration_requires_approval')
      .first()
    return {
      invite,
      league,
      team,
      requiresApproval: Boolean(settings.public_registration_requires_approval),
    }
  }

  async register(
    token: string,
    input: {
      name: string
      countryId: number
      photo?: MultipartFile
      requestId: string
      confirmDuplicate?: boolean
    }
  ) {
    const initial = await this.context(token)
    const name = input.name.normalize('NFKC').trim().replace(/\s+/gu, ' ')
    const payloadHash = createHash('sha256')
      .update(JSON.stringify([initial.invite.id, name, input.countryId]))
      .digest('hex')
    return db.transaction(async (trx) => {
      // Same season lock as admin roster writes: duplicate checks and assignments are serialized.
      await trx
        .from('seasons')
        .where('id', initial.invite.seasonId)
        .update({ id: initial.invite.seasonId })
      const context = await this.context(token, trx)
      const receipt = await trx
        .from('public_player_registrations')
        .where('request_id', input.requestId)
        .first()
      if (receipt) {
        if (receipt.payload_hash !== payloadHash)
          throw new Exception('This submission has already been used. Reload the form.', {
            status: 409,
          })
        return {
          duplicate: false as const,
          roster: await LeaguePlayer.query({ client: trx })
            .where('id', receipt.roster_id)
            .firstOrFail(),
          context,
        }
      }
      const existing = await Player.query({ client: trx }).whereIn(
        'id',
        trx.from('league_players').select('player_id').where('league_id', context.league.id)
      )
      if (
        !input.confirmDuplicate &&
        existing.some(
          (player) => player.name && normalizeRosterName(player.name) === normalizeRosterName(name)
        )
      ) {
        return { duplicate: true as const, context }
      }
      await trx.table('public_player_registrations').insert({
        request_id: input.requestId,
        invite_id: context.invite.id,
        payload_hash: payloadHash,
        created_at: DateTime.utc().toSQL(),
      })
      const player = await Player.create(
        { name, countryId: input.countryId, userId: null },
        { client: trx }
      )
      if (input.photo) {
        player.avatarUrl = await new FileService().upload(
          input.photo,
          playerAvatarKey(player, input.photo.extname)
        )
        await player.save()
      }
      const roster = await LeaguePlayer.create(
        {
          playerId: player.id,
          leagueId: context.league.id,
          seasonId: context.invite.seasonId,
          teamId: context.invite.teamId,
          status: context.requiresApproval ? 'pending' : 'active',
        },
        { client: trx }
      )
      await trx
        .from('public_player_registrations')
        .where('request_id', input.requestId)
        .update({ roster_id: roster.id })
      return { duplicate: false as const, roster, context }
    })
  }
}
