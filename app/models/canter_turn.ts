import { CanterTurnSchema } from '#database/schema'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { belongsTo } from '@adonisjs/lucid/orm'
import User from '#models/user'
import CanterMatch from '#models/canter_match'

export default class CanterTurn extends CanterTurnSchema {
  @belongsTo(() => CanterMatch)
  declare canterMatch: BelongsTo<typeof CanterMatch>

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
