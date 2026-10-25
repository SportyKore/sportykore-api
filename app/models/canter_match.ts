import { CanterMatchSchema } from '#database/schema'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import User from '#models/user'
import Tie from '#models/tie'
import CanterTurn from '#models/canter_turn'
import CanterMatchEvent from '#models/canter_match_event'
import KanterBallPlayer from '#models/kanter_ball_player'

export default class CanterMatch extends CanterMatchSchema {
  @belongsTo(() => User, { foreignKey: 'hostUserId' })
  declare hostUser: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'guestUserId' })
  declare guestUser: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'winnerUserId' })
  declare winnerUser: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'currentTurnUserId' })
  declare currentTurnUser: BelongsTo<typeof User>

  @belongsTo(() => Tie)
  declare tie: BelongsTo<typeof Tie>

  /** Solo (match_type = 'solo') matches only — who's playing against the CPU. */
  @belongsTo(() => KanterBallPlayer, { foreignKey: 'kanterPlayerId' })
  declare kanterPlayer: BelongsTo<typeof KanterBallPlayer>

  @hasMany(() => CanterTurn)
  declare turns: HasMany<typeof CanterTurn>

  @hasMany(() => CanterMatchEvent)
  declare events: HasMany<typeof CanterMatchEvent>
}
