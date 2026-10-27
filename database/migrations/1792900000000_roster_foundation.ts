import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('players', (table) => {
      table.integer('user_id').unsigned().nullable().alter()
      table.integer('country_id').unsigned().nullable().alter()
    })
    this.schema.alterTable('league_players', (table) => {
      // Replace the column to remove SQLite/PostgreSQL's old enum CHECK.
      table
        .enum('roster_status', [
          'active',
          'transferred',
          'injured',
          'suspended',
          'pending',
          'inactive',
          'rejected',
        ])
        .defaultTo('active')
    })
    this.defer(async (db) => {
      await db.from('league_players').update({ roster_status: db.raw('status') })
    })
    this.schema.alterTable('league_players', (table) => table.dropColumn('status'))
    this.schema.alterTable('league_players', (table) =>
      table.renameColumn('roster_status', 'status')
    )
    this.schema.alterTable('leagues', (table) => {
      table.boolean('public_registration_requires_approval').notNullable().defaultTo(true)
    })
    this.schema.createTable('roster_requests', (table) => {
      table.increments('id')
      table
        .integer('league_id')
        .unsigned()
        .references('id')
        .inTable('leagues')
        .onDelete('CASCADE')
        .notNullable()
      table
        .integer('season_id')
        .unsigned()
        .references('id')
        .inTable('seasons')
        .onDelete('CASCADE')
        .notNullable()
      table
        .integer('user_id')
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
        .notNullable()
      table.string('request_id', 128).notNullable()
      table.string('payload_hash', 64).notNullable()
      table.text('response_body').notNullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.unique(['league_id', 'season_id', 'user_id', 'request_id'])
    })
  }

  async down() {
    this.schema.dropTable('roster_requests')
    this.schema.alterTable('leagues', (table) =>
      table.dropColumn('public_registration_requires_approval')
    )
    // Keep nullable columns and widened status on rollback: existing name-only
    // players and rejected registrations must not be destroyed or invalidated.
  }
}
