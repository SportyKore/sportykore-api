import { Exception } from '@adonisjs/core/exceptions'
import League from '#models/league'
import Season from '#models/season'
import Team from '#models/team'
import TeamAdmin from '#models/team_admin'
import { DELETED_LEAGUE_STATUS } from '#types/league_status'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import InviteService from '#services/invite_service'
import { completeProfileAndAcceptValidator, generateInviteValidator } from '#validators/invite'

@inject()
export default class InvitesController {
  constructor(private inviteService: InviteService) {}

  async generate({ request, response, auth }: HttpContext) {
    const { leagueId, seasonId, teamId, invitedUserId } =
      await request.validateUsing(generateInviteValidator)

    const league = await League.findOrFail(leagueId)
    if (league.status === DELETED_LEAGUE_STATUS)
      throw new Exception('League not found', { status: 404 })
    await Season.query().where('id', seasonId).where('league_id', leagueId).firstOrFail()
    if (teamId !== null && teamId !== undefined)
      await Team.query().where('id', teamId).where('league_id', leagueId).firstOrFail()
    const userId = auth.getUserOrFail().id
    if (league.userId !== userId) {
      if (
        teamId === null ||
        teamId === undefined ||
        !(await TeamAdmin.query()
          .where('user_id', userId)
          .where('league_id', leagueId)
          .where('team_id', teamId)
          .whereNull('removed_at')
          .first())
      ) {
        throw new Exception('You cannot invite players to this destination', { status: 403 })
      }
    }
    const link = await this.inviteService.generate(
      leagueId,
      seasonId,
      teamId ?? undefined,
      invitedUserId
    )

    return response.ok({ inviteLink: link })
  }

  async accept({ params, auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const result = await this.inviteService.accept(params.token, user.id)

    if (result.requiresProfile) {
      return response.ok({ requiresProfile: true, token: params.token })
    }

    return response.ok({ requiresProfile: false, leagueId: result.leagueId })
  }

  async completeProfileAndAccept({ params, request, auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const data = await request.validateUsing(completeProfileAndAcceptValidator)

    const result = await this.inviteService.completeProfileAndAccept(params.token, user.id, {
      name: data.name,
      countryId: data.countryId,
      bio: data.bio,
      avatar: data.avatar,
    })

    return response.ok({ leagueId: result.leagueId })
  }
}
