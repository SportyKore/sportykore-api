import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Use native column operations: SQLite table rebuilding can trigger foreign
    // key actions on existing teams when changing a column default.
    this.schema.alterTable('leagues', (table) => {
      table.boolean('registration_approval').notNullable().defaultTo(false)
    })
    this.schema.raw('ALTER TABLE leagues DROP COLUMN public_registration_requires_approval')
    this.schema.raw(
      'ALTER TABLE leagues RENAME COLUMN registration_approval TO public_registration_requires_approval'
    )
  }

  async down() {
    this.schema.alterTable('leagues', (table) => {
      table.boolean('registration_approval').notNullable().defaultTo(true)
    })
    this.defer(async (db) => {
      await db.from('leagues').update({
        registration_approval: db.raw('public_registration_requires_approval'),
      })
    })
    this.schema.raw('ALTER TABLE leagues DROP COLUMN public_registration_requires_approval')
    this.schema.raw(
      'ALTER TABLE leagues RENAME COLUMN registration_approval TO public_registration_requires_approval'
    )
  }
}
