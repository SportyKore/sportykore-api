import { test } from '@japa/runner'
import { validateFinish } from '#services/kanter_finish_validation'
const finish = {
  result: 'win',
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
test.group('Kanter finish validation', () => {
  test('accepts target wins and full-time draws', ({ assert }) => {
    assert.isNull(validateFinish(finish, 80))
    assert.isNull(
      validateFinish({ ...finish, result: 'draw', playerScore: 0, durationSeconds: 120 }, 150)
    )
  })
  test('rejects instant draws and unfinished wins', ({ assert }) => {
    assert.isString(
      validateFinish({ ...finish, result: 'draw', playerScore: 0, durationSeconds: 0 }, 0)
    )
    assert.isString(validateFinish({ ...finish, playerScore: 1 }, 80))
  })
  test('accepts active game time after a long pause', ({ assert }) => {
    assert.isNull(validateFinish({ ...finish, durationSeconds: 120 }, 900))
  })
  test('rejects inconsistent results, bonuses and fractional scores', ({ assert }) => {
    for (const patch of [
      { playerScore: 1.5 },
      { result: 'loss' },
      { cpuScore: 1 },
      { comeback: true },
      { clutchGoal: true },
      { endedReason: 'owner_collect' },
      { durationSeconds: 121 },
    ]) {
      assert.isString(validateFinish({ ...finish, ...patch }, 200))
    }
  })
  test('allows unfinished manual and abandoned results without requiring full time', ({
    assert,
  }) => {
    for (const endedReason of ['manual', 'abandoned'])
      assert.isNull(
        validateFinish(
          { ...finish, result: 'draw', playerScore: 0, durationSeconds: 0, endedReason },
          0
        )
      )
  })
})
