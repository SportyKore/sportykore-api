import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import PlayerClaimService from '#services/player_claim_service'
import { createPlayerClaimValidator } from '#validators/player_claim'

@inject()
export default class PlayerClaimsController {
  constructor(private claims: PlayerClaimService) {}

  async store({ auth, request, response }: HttpContext) {
    const input = await request.validateUsing(createPlayerClaimValidator)
    const result = await this.claims.issue(auth.getUserOrFail().id, input)
    response.header('Cache-Control', 'no-store')
    response.status(201)
    return response.send(result)
  }

  async redeem({ auth, params, response, serialize }: HttpContext) {
    response.header('Cache-Control', 'no-store')
    return serialize(await this.claims.redeem(String(params.token), auth.getUserOrFail().id))
  }

  async show({ params, response, inertia }: HttpContext) {
    const token = String(params.token)
    response.header('Cache-Control', 'no-store')
    response.header('Referrer-Policy', 'no-referrer')
    const available = await this.claims.isAvailable(token)
    return inertia.render('players/claim', { token: available ? token : '', available })
  }
}
