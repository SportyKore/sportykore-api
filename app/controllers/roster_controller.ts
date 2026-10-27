import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import RosterService, { DuplicateRosterNames } from '#services/roster_service'
import {
  rosterParamsValidator,
  rosterListValidator,
  rosterCreateValidator,
  rosterAssignValidator,
  rosterApprovalValidator,
  rosterIdValidator,
} from '#validators/roster'

@inject()
export default class RosterController {
  constructor(protected roster: RosterService) {}

  async index({ auth, params, request, response }: HttpContext) {
    const { leagueId, seasonId } = await rosterParamsValidator.validate(params)
    const query = request.qs()
    if (query.teamId === 'null') query.teamId = null
    const { teamId } = await rosterListValidator.validate(query)
    return response.ok({
      data: await this.roster.list(auth.getUserOrFail().id, leagueId, seasonId, teamId),
    })
  }

  async store({ auth, params, request, response }: HttpContext) {
    const { leagueId, seasonId } = await rosterParamsValidator.validate(params)
    const input = await request.validateUsing(rosterCreateValidator)
    try {
      return response.created({
        data: await this.roster.create(auth.getUserOrFail().id, leagueId, seasonId, input),
      })
    } catch (error) {
      if (error instanceof DuplicateRosterNames)
        return response.conflict({ code: 'DUPLICATE_NAMES', matches: error.matches })
      throw error
    }
  }

  async assign({ auth, params, request, response }: HttpContext) {
    const { leagueId, seasonId } = await rosterParamsValidator.validate(params)
    const { teamId, rosterIds } = await request.validateUsing(rosterAssignValidator)
    return response.ok({
      data: await this.roster.assign(
        auth.getUserOrFail().id,
        leagueId,
        seasonId,
        teamId,
        rosterIds
      ),
    })
  }

  async update({ auth, params, request, response }: HttpContext) {
    const { leagueId, seasonId } = await rosterParamsValidator.validate(params)
    const { id } = await rosterIdValidator.validate(params)
    const { status } = await request.validateUsing(rosterApprovalValidator)
    return response.ok({
      data: await this.roster.approve(auth.getUserOrFail().id, leagueId, seasonId, id, status),
    })
  }
}
