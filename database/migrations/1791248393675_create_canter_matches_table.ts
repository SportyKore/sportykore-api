import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'canter_matches'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Not nullable at the app level for PvP matches, but the column
      // itself has to allow null: a solo (vs-CPU) match has no host user,
      // only a kanter_player_id. CanterMatchService enforces that PvP rows
      // always populate this.
      table
        .integer('host_user_id')
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
        .nullable()
      table
        .integer('guest_user_id')
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
        .nullable()
      table
        .integer('winner_user_id')
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
        .nullable()
      table
        .integer('current_turn_user_id')
        .unsigned()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
        .nullable()

      // Nullable hook for the future tournament module: when a match is
      // created on behalf of a bracket fixture, this links back to it so a
      // tournament listener can advance the tie on completion. Unused until
      // that module exists (see Game.tieId for the equivalent pattern).
      table
        .integer('tie_id')
        .unsigned()
        .references('id')
        .inTable('ties')
        .onDelete('SET NULL')
        .nullable()

      // Solo (vs-CPU) matches have no invite flow.
      table.string('invite_code').unique().nullable()
      table.timestamp('invite_expires_at').nullable()

      table
        .enum('status', ['pending', 'active', 'completed', 'abandoned', 'expired'])
        .notNullable()
        .defaultTo('pending')
      table.string('rules_mode', 32).notNullable().defaultTo('street')

      // 'pvp' (default) covers every existing/future authenticated host-vs-
      // guest match. 'solo' is a single player vs the CPU — see the
      // kanter_player_id / difficulty / seed / rating columns below.
      table.enum('match_type', ['pvp', 'solo']).notNullable().defaultTo('pvp')

      // Solo matches only: who's playing, and the CPU-match-specific
      // fields a PvP row never populates.
      table
        .integer('kanter_player_id')
        .unsigned()
        .references('id')
        .inTable('kanter_ball_players')
        .onDelete('CASCADE')
        .nullable()
      table.string('difficulty', 16).nullable()
      table.string('seed').nullable()
      // win/draw/loss/owner_collect — set on finish. PvP's equivalent is
      // winner_user_id (+ status) instead.
      table.string('result', 16).nullable()
      table.integer('player_score').unsigned().notNullable().defaultTo(0)
      table.integer('cpu_score').unsigned().notNullable().defaultTo(0)
      table.integer('duration_seconds').unsigned().nullable()
      table.integer('rating').nullable()
      table.integer('rating_formula_version').unsigned().nullable()
      table.integer('flicks').unsigned().notNullable().defaultTo(0)
      table.boolean('clean_sheet').notNullable().defaultTo(false)
      table.boolean('comeback').notNullable().defaultTo(false)
      table.boolean('clutch_goal').notNullable().defaultTo(false)
      // full_time / owner_collect / manual / abandoned — solo matches only;
      // PvP's equivalent is already captured by `status`.
      table.string('ended_reason', 32).nullable()

      table.integer('host_score').unsigned().notNullable().defaultTo(0)
      table.integer('guest_score').unsigned().notNullable().defaultTo(0)
      table.integer('turn_number').unsigned().notNullable().defaultTo(0)
      table.timestamp('turn_expires_at').nullable()

      // Serialized snapshot of ball/cap positions, for the live render and
      // for reconnect. Server-authoritative; the client never writes this.
      table.json('state').nullable()

      table.string('last_touch', 16).nullable()
      table.integer('owner_hits').unsigned().notNullable().defaultTo(0)

      table.timestamp('started_at').nullable()
      table.timestamp('ended_at').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
