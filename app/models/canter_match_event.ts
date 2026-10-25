import { CanterMatchEventSchema } from '#database/schema'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { belongsTo } from '@adonisjs/lucid/orm'
import CanterMatch from '#models/canter_match'

export default class CanterMatchEvent extends CanterMatchEventSchema {
  @belongsTo(() => CanterMatch)
  declare canterMatch: BelongsTo<typeof CanterMatch>
}
