import { test } from '@japa/runner'
import config from '@adonisjs/core/services/config'
import db from '@adonisjs/lucid/services/db'
import { DateTime, Settings } from 'luxon'
import Service from '#services/kanter_ball_service'
import Player from '#models/kanter_ball_player'
import User from '#models/user'
import Match from '#models/canter_match'
import Session from '#models/kanter_ball_guest_session'

const result = {
  result: 'win' as const,
  endedReason: 'full_time',
  playerScore: 3,
  cpuScore: 0,
  durationSeconds: 40,
  flicks: 10,
  ownerHits: 0,
  cleanSheet: true,
  comeback: false,
  clutchGoal: false,
}
test.group('Kanter persistence regression', (group) => {
  const originalZone = Settings.defaultZone
  const originalFilename = config.get('database.connections.sqlite.connection.filename')
  group.setup(async () => {
    Settings.defaultZone = 'UTC'
    await db.manager.closeAll()
    config.set('database.connections.sqlite.connection.filename', ':memory:')
    await db.rawQuery('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)')
    await db.rawQuery(
      'CREATE TABLE kanter_ball_players (id INTEGER PRIMARY KEY, nickname TEXT UNIQUE, user_id INTEGER, created_at TEXT, updated_at TEXT)'
    )
    await db.rawQuery(
      'CREATE TABLE kanter_ball_guest_sessions (id INTEGER PRIMARY KEY, kanter_player_id INTEGER, token TEXT UNIQUE, expires_at TEXT, created_at TEXT, updated_at TEXT)'
    )
    await db.rawQuery(
      `CREATE TABLE canter_matches (id INTEGER PRIMARY KEY, kanter_player_id INTEGER, match_type TEXT, status TEXT, rules_mode TEXT, difficulty TEXT, seed TEXT, started_at TEXT, ended_at TEXT, result TEXT, player_score INTEGER, cpu_score INTEGER, duration_seconds INTEGER, flicks INTEGER, owner_hits INTEGER, clean_sheet INTEGER, comeback INTEGER, clutch_goal INTEGER, ended_reason TEXT, rating INTEGER, rating_formula_version INTEGER, created_at TEXT, updated_at TEXT)`
    )
    await db.rawQuery(
      'CREATE TABLE canter_match_events (id INTEGER PRIMARY KEY, canter_match_id INTEGER, event_type TEXT, side TEXT, payload TEXT, created_at TEXT)'
    )
  })
  group.teardown(async () => {
    await db.manager.closeAll()
    Settings.defaultZone = originalZone
    config.set('database.connections.sqlite.connection.filename', originalFilename)
  })
  test('retry returns the original result and creates one event', async ({ assert }) => {
    const service = new Service()
    const player = await Player.create({ nickname: 'Retry' })
    const session = await Session.create({
      kanterPlayerId: player.id,
      token: crypto.randomUUID(),
      expiresAt: DateTime.utc().plus({ days: 1 }),
    })
    const match = await service.startMatch(player, 'medium')
    match.startedAt = DateTime.utc().minus({ seconds: 150 })
    await match.save()
    const first = await service.finishMatch(session.token, match.id, result)
    const second = await service.finishMatch(session.token, match.id, {
      ...result,
      playerScore: 0,
      result: 'draw',
    })
    assert.equal(second.rating, first.rating)
    assert.equal(second.playerScore, 3)
    const events = await db.from('canter_match_events').where('canter_match_id', match.id)
    assert.lengthOf(events, 1)
  })
  test('abandoned games receive no points and are excluded', async ({ assert }) => {
    const service = new Service()
    const player = await Player.create({ nickname: 'Abandoned' })
    const session = await Session.create({
      kanterPlayerId: player.id,
      token: crypto.randomUUID(),
      expiresAt: DateTime.utc().plus({ days: 1 }),
    })
    const match = await service.startMatch(player, 'hard')
    const saved = await service.finishMatch(session.token, match.id, {
      ...result,
      result: 'draw',
      playerScore: 0,
      durationSeconds: 0,
      endedReason: 'abandoned',
    })
    assert.equal(saved.status, 'abandoned')
    assert.isNull(saved.rating)
    assert.isFalse(
      (await service.leaderboard({ range: 'all' })).some((p) => p.playerId === player.id)
    )
  })
  test('event failure rolls back the match completion', async ({ assert }) => {
    const service = new Service()
    const player = await Player.create({ nickname: 'Rollback' })
    const session = await Session.create({
      kanterPlayerId: player.id,
      token: crypto.randomUUID(),
      expiresAt: DateTime.utc().plus({ days: 1 }),
    })
    const match = await service.startMatch(player, 'easy')
    await db.rawQuery(
      "CREATE TRIGGER fail_event BEFORE INSERT ON canter_match_events BEGIN SELECT RAISE(FAIL, 'test event failure'); END"
    )
    try {
      await assert.rejects(() =>
        service.finishMatch(session.token, match.id, {
          ...result,
          result: 'draw',
          playerScore: 0,
          durationSeconds: 0,
          endedReason: 'manual',
        })
      )
      assert.equal((await Match.findOrFail(match.id)).status, 'active')
    } finally {
      await db.rawQuery('DROP TRIGGER fail_event')
    }
  })
  test('claim merges guest matches and sessions, and recovery retains identity', async ({
    assert,
  }) => {
    const service = new Service()
    await db.table('users').insert({ id: 900, email: 'recover@example.com' })
    const user = await User.findOrFail(900)
    const a = await service.upsertGuestSession({ nickname: 'Original' })
    const first = await service.claimProfile(user, a.session.token)
    const b = await service.upsertGuestSession({ nickname: 'NewDevice' })
    const match = await service.startMatch(b.player, 'easy')
    const merged = await service.claimProfile(user, b.session.token)
    assert.equal(merged.playerId, first.playerId)
    assert.equal((await Match.findOrFail(match.id)).kanterPlayerId, first.playerId)
    const finished = await service.finishMatch(b.session.token, match.id, {
      ...result,
      result: 'draw',
      playerScore: 0,
      durationSeconds: 0,
      endedReason: 'manual',
    })
    assert.equal(finished.status, 'abandoned')
    const outsider = await service.upsertGuestSession({ nickname: 'Outsider' })
    await assert.rejects(() => service.finishMatch(outsider.session.token, match.id, result))

    assert.equal((await service.requireGuestPlayer(b.session.token)).id, first.playerId)
    assert.equal((await service.claimProfile(user)).playerId, first.playerId)
    assert.lengthOf(await Player.query().where('user_id', 900), 1)
  })
})
