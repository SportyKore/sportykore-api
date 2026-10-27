import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('player_claims', (table) => {
      table.increments('id')
      table.string('token_hash', 64).notNullable().unique()
      table
        .integer('player_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('players')
        .onDelete('CASCADE')
      table
        .integer('league_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('leagues')
        .onDelete('CASCADE')
      table
        .integer('season_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('seasons')
        .onDelete('CASCADE')
      table
        .integer('issued_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table
        .integer('redeemed_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      // Versioned verification method leaves room for future proof-of-identity flows.
      table.string('verification_method', 64).notNullable().defaultTo('admin_link_v1')
      table.timestamp('expires_at').notNullable()
      table.timestamp('redeemed_at').nullable()
      table.timestamp('revoked_at').nullable()
      table.timestamp('created_at').notNullable()
      table.index(['player_id', 'revoked_at', 'redeemed_at'])
    })
  }

  async down() {
    this.schema.dropTable('player_claims')
  }
}
