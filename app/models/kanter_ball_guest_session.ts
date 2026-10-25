import { KanterBallGuestSessionSchema } from '#database/schema'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { belongsTo } from '@adonisjs/lucid/orm'
import KanterBallPlayer from '#models/kanter_ball_player'

export default class KanterBallGuestSession extends KanterBallGuestSessionSchema {
  // Lucid's default FK convention would look for kanterBallPlayerId (from
  // the related model's class name) — the actual column is kanterPlayerId.
  @belongsTo(() => KanterBallPlayer, { foreignKey: 'kanterPlayerId' })
  declare kanterPlayer: BelongsTo<typeof KanterBallPlayer>
}
