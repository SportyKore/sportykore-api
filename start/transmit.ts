import logger from '@adonisjs/core/services/logger'
import transmit from '@adonisjs/transmit/services/main'
import type { HttpContext } from '@adonisjs/core/http'
import CanterMatch from '#models/canter_match'

transmit.on('connect', ({ uid }) => {
  logger.info({ uid }, 'Transmit client connected')
})

// Canter Ball matches are public — anyone (including anonymous spectators in
// the mobile app) may subscribe to a match's live channel. The only check is
// that the match actually exists, so a client can't subscribe to garbage
// channel names and keep a dangling subscription alive.
transmit.authorize<{ matchId: string }>(
  'canter-matches/:matchId',
  async (_ctx: HttpContext, { matchId }) => {
    const match = await CanterMatch.find(matchId)
    return Boolean(match)
  }
)
