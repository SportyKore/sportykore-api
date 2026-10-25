import { KanterBallPlayerSchema } from '#database/schema'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import User from '#models/user'
import CanterMatch from '#models/canter_match'
import KanterBallGuestSession from '#models/kanter_ball_guest_session'

export default class KanterBallPlayer extends KanterBallPlayerSchema {
  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @hasMany(() => CanterMatch, { foreignKey: 'kanterPlayerId' })
  declare matches: HasMany<typeof CanterMatch>

  // Default FK convention would be kanterBallPlayerId — actual column is
  // kanterPlayerId.
  @hasMany(() => KanterBallGuestSession, { foreignKey: 'kanterPlayerId' })
  declare guestSessions: HasMany<typeof KanterBallGuestSession>
}
