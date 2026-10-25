import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'canter_match_events'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table
        .integer('canter_match_id')
        .unsigned()
        .references('id')
        .inTable('canter_matches')
        .onDelete('CASCADE')
        .notNullable()

      table.integer('turn_number').unsigned().nullable()

      // goal, own_goal, owner_annoyed, owner_warning, owner_vexed,
      // owner_collect, match_completed, etc. A curated, semantic log —
      // deliberately separate from canter_turns, which already records
      // every raw flick input + its per-turn result_event for replay and
      // anti-cheat. This table is what leaderboard/achievement derivation
      // and any future highlight feed reads from, and it's shared by PvP
      // and solo matches alike.
      table.string('event_type', 32).notNullable()

      // host/guest for pvp, player/cpu for solo.
      table.string('side', 16).nullable()
      table.json('payload').nullable()

      table.timestamp('created_at')

      table.index(['canter_match_id', 'turn_number'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
