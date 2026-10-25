import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import CanterMatchService from '#services/canter_match_service'
import CanterMatchTransformer from '#transformers/canter_match_transformer'
import {
  canterMatchParamsValidator,
  createCanterMatchValidator,
  joinCanterMatchValidator,
  submitCanterTurnValidator,
} from '#validators/canter_match'

@inject()
export default class CanterMatchesController {
  constructor(private canterMatchService: CanterMatchService) {}

  /** Public — list of currently-live matches, for the mobile spectator feed. */
  async index({ serialize }: HttpContext) {
    const matches = await this.canterMatchService.listActive()

    return serialize(CanterMatchTransformer.transform(matches)?.useVariant('Spectator'))
  }

  /** Public — fetch one match to spectate. No participant check. */
  async spectate({ params, serialize, request }: HttpContext) {
    const { matchId } = await request.validateUsing(canterMatchParamsValidator, {
      data: { matchId: params.matchId },
    })

    const match = await this.canterMatchService.findForSpectator(matchId)

    return serialize(CanterMatchTransformer.transform(match)?.useVariant('Spectator'))
  }

  async store({ request, auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { rulesMode } = await request.validateUsing(createCanterMatchValidator)

    const match = await this.canterMatchService.create(user, rulesMode)

    return serialize(CanterMatchTransformer.transform(match)?.useVariant('WithInvite'))
  }

  async join({ request, params, auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const { inviteCode } = await request.validateUsing(joinCanterMatchValidator, {
      data: { inviteCode: params.inviteCode },
    })

    const match = await this.canterMatchService.join(inviteCode, user)

    return serialize(CanterMatchTransformer.transform(match))
  }

  async show({ params, auth, serialize, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const { matchId } = await request.validateUsing(canterMatchParamsValidator, {
      data: { matchId: params.matchId },
    })

    const match = await this.canterMatchService.findForUser(matchId, user)

    return serialize(CanterMatchTransformer.transform(match))
  }

  async claimTimeout({ params, auth, serialize, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const { matchId } = await request.validateUsing(canterMatchParamsValidator, {
      data: { matchId: params.matchId },
    })

    const match = await this.canterMatchService.findForUser(matchId, user)
    const updated = await this.canterMatchService.claimTimeout(match, user)

    return serialize(CanterMatchTransformer.transform(updated))
  }

  async submitTurn({ params, auth, serialize, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const { matchId } = await request.validateUsing(canterMatchParamsValidator, {
      data: { matchId: params.matchId },
    })
    const { capId, dragX, dragY } = await request.validateUsing(submitCanterTurnValidator)

    const match = await this.canterMatchService.findForUser(matchId, user)
    const {
      match: updated,
      frames,
      resultEvent,
    } = await this.canterMatchService.submitTurn(match, user, {
      capId,
      dragX,
      dragY,
    })

    return serialize({
      match: CanterMatchTransformer.transform(updated),
      frames,
      resultEvent,
    })
  }
}
