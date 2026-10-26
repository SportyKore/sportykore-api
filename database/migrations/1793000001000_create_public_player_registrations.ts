import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('public_player_registrations', (table) => {
      table.string('request_id', 36).primary()
      table
        .integer('invite_id')
        .unsigned()
        .references('id')
        .inTable('invites')
        .onDelete('CASCADE')
        .notNullable()
      table
        .integer('roster_id')
        .unsigned()
        .references('id')
        .inTable('league_players')
        .onDelete('CASCADE')
        .nullable()
      table.string('payload_hash', 64).notNullable()
      table.timestamp('created_at').notNullable()
    })
  }
  async down() {
    this.schema.dropTable('public_player_registrations')
  }
}
