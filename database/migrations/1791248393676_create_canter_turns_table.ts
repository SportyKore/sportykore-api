import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'canter_turns'

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
      table
        .integer('user_id')
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
        .notNullable()

      table.integer('turn_number').unsigned().notNullable()
      table.float('drag_x').notNullable()
      table.float('drag_y').notNullable()
      table.text('result_event').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.index(['canter_match_id', 'turn_number'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
