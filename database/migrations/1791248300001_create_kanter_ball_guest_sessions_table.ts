import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'kanter_ball_guest_sessions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table
        .integer('kanter_player_id')
        .unsigned()
        .references('id')
        .inTable('kanter_ball_players')
        .onDelete('CASCADE')
        .notNullable()

      // Server-issued, opaque, unguessable — what the client actually
      // stores in localStorage. Never a raw/client-generated player id,
      // so one guest can't spoof or pollute another guest's match history.
      table.string('token').unique().notNullable()
      table.timestamp('expires_at').notNullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
