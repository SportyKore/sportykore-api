import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import RosterService from '#services/roster_service'
import { rosterIdValidator, rosterSettingsValidator } from '#validators/roster'

@inject()
export default class RosterSettingsController {
  constructor(protected roster: RosterService) {}

  async show({ auth, params, response }: HttpContext) {
    const { id } = await rosterIdValidator.validate({ id: params.leagueId })
    return response.ok(await this.roster.settings(auth.getUserOrFail().id, id))
  }

  async update({ auth, params, request, response }: HttpContext) {
    const { id } = await rosterIdValidator.validate({ id: params.leagueId })
    const { requiresApproval } = await request.validateUsing(rosterSettingsValidator)
    return response.ok(await this.roster.settings(auth.getUserOrFail().id, id, requiresApproval))
  }
}
