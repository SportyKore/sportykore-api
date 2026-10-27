import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('stages', (table) => {
      // Replace the column to widen SQLite/PostgreSQL's old enum CHECK with 'swiss'.
      table
        .enum('stage_type_new', ['round_robin', 'group', 'knockout', 'playoff', 'swiss'])
        .notNullable()
        .defaultTo('round_robin')
    })
    this.defer(async (db) => {
      await db.from('stages').update({ stage_type_new: db.raw('stage_type') })
    })
    this.schema.alterTable('stages', (table) => table.dropColumn('stage_type'))
    this.schema.alterTable('stages', (table) => table.renameColumn('stage_type_new', 'stage_type'))

    this.schema.alterTable('games', (table) => {
      table.integer('round_number').unsigned().nullable()
    })
  }

  async down() {
    this.schema.alterTable('games', (table) => table.dropColumn('round_number'))
    // Keep the widened stage_type enum on rollback: existing swiss stages must not be orphaned.
  }
}
