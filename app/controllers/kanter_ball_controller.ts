import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import KanterBallService from '#services/kanter_ball_service'
import {
  finishKanterMatchValidator,
  guestSessionValidator,
  kanterLeaderboardValidator,
  kanterMatchParamsValidator,
  startKanterMatchValidator,
} from '#validators/kanter_ball'

@inject()
export default class KanterBallController {
  constructor(private kanterBallService: KanterBallService) {}

  /** Public — bootstraps a new guest, refreshes a returning one, or renames one. */
  async guestSession({ request, response }: HttpContext) {
    const { token, nickname } = await request.validateUsing(guestSessionValidator)
    const { player, session } = await this.kanterBallService.upsertGuestSession({
      token,
      nickname,
    })

    return response.ok({
      data: {
        playerId: player.id,
        nickname: player.nickname,
        linked: player.userId !== null,
        token: session.token,
        expiresAt: session.expiresAt,
      },
    })
  }

  /** Guest-session-authenticated — every solo-match action uses this, even
   * for a player who has since saved a profile. */
  async startMatch({ request, response }: HttpContext) {
    const { token, difficulty } = await request.validateUsing(startKanterMatchValidator)
    const player = await this.kanterBallService.requireGuestPlayer(token)
    const match = await this.kanterBallService.startMatch(player, difficulty)

    return response.created({
      data: {
        matchId: match.id,
        seed: match.seed,
        difficulty: match.difficulty,
        startedAt: match.startedAt,
      },
    })
  }

  async finishMatch({ request, params, response }: HttpContext) {
    const { matchId } = await request.validateUsing(kanterMatchParamsValidator, {
      data: { matchId: params.matchId },
    })
    const { token, ...payload } = await request.validateUsing(finishKanterMatchValidator)
    const match = await this.kanterBallService.finishMatch(token, matchId, payload)

    return response.ok({
      data: {
        matchId: match.id,
        result: match.result,
        rating: match.rating,
      },
    })
  }

  /** Public. */
  async leaderboard({ request, response }: HttpContext) {
    const filters = await request.validateUsing(kanterLeaderboardValidator)
    const rows = await this.kanterBallService.leaderboard(filters)

    return response.ok({ data: rows })
  }

  /** Authenticated (real Sportykore account) — links a guest's match history to it. */
  async claimProfile({ request, auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const { token } = await request.validateUsing(guestSessionValidator)
    const session = await this.kanterBallService.claimProfile(user, token)
    return response.ok({ data: session })
  }
}
