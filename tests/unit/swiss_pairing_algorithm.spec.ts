import { test } from '@japa/runner'

import {
  backtrackPairs,
  pairKey,
  seededShuffle,
  validatePairing,
} from '#services/swiss_pairing_service'
import type { SwissStageConfig } from '#types/stage'

function config(overrides: Partial<SwissStageConfig> = {}): SwissStageConfig {
  return {
    format: { rounds: 3, byeHandling: 'warn' },
    qualification: { directCount: 1, playoffRankFrom: 2, playoffRankTo: 5 },
    ...overrides,
  }
}

test.group('Swiss pairing algorithm', () => {
  test('backtrackPairs: 8 teams round 1 produces 4 distinct pairs, no team twice', ({ assert }) => {
    const order = [1, 2, 3, 4, 5, 6, 7, 8]
    const pairs = backtrackPairs(order, new Set(), config())!

    assert.lengthOf(pairs, 4)
    const seen = new Set<number>()
    for (const pair of pairs) {
      assert.isFalse(seen.has(pair.homeTeamId))
      assert.isFalse(seen.has(pair.awayTeamId))
      seen.add(pair.homeTeamId)
      seen.add(pair.awayTeamId)
    }
    assert.equal(seen.size, 8)
  })

  test('backtrackPairs: never repeats a pairing already played', ({ assert }) => {
    const order = [1, 2, 3, 4, 5, 6, 7, 8]
    const round1 = backtrackPairs(order, new Set(), config())!
    const playedAfterRound1 = new Set(round1.map((p) => pairKey(p.homeTeamId, p.awayTeamId)))

    const round2 = backtrackPairs(order, playedAfterRound1, config())!
    for (const pair of round2) {
      assert.isFalse(playedAfterRound1.has(pairKey(pair.homeTeamId, pair.awayTeamId)))
    }

    const playedAfterRound2 = new Set([
      ...playedAfterRound1,
      ...round2.map((p) => pairKey(p.homeTeamId, p.awayTeamId)),
    ])
    const round3 = backtrackPairs(order, playedAfterRound2, config())!
    for (const pair of round3) {
      assert.isFalse(playedAfterRound2.has(pairKey(pair.homeTeamId, pair.awayTeamId)))
    }
  })

  test('backtrackPairs: returns null when no pairing can avoid a rematch', ({ assert }) => {
    // Only two teams, and they've already played each other.
    const played = new Set([pairKey(1, 2)])
    const result = backtrackPairs([1, 2], played, config())
    assert.isNull(result)
  })

  test('backtrackPairs: honours noPair constraints like a rematch', ({ assert }) => {
    const cfg = config({ constraints: { noPair: [{ teamIds: [1, 2] }] } })
    const result = backtrackPairs([1, 2], new Set(), cfg)
    assert.isNull(result)

    const withThirdOption = backtrackPairs([1, 2, 3, 4], new Set(), cfg)!
    const hasForbiddenPair = withThirdOption.some(
      (p) =>
        (p.homeTeamId === 1 && p.awayTeamId === 2) || (p.homeTeamId === 2 && p.awayTeamId === 1)
    )
    assert.isFalse(hasForbiddenPair)
  })

  test('seededShuffle: same seed reproduces the same order', ({ assert }) => {
    const teams = [1, 2, 3, 4, 5, 6, 7, 8]
    const a = seededShuffle(teams, 42)
    const b = seededShuffle(teams, 42)
    assert.deepEqual(a, b)
  })

  test('seededShuffle: different seeds usually diverge', ({ assert }) => {
    const teams = [1, 2, 3, 4, 5, 6, 7, 8]
    const a = seededShuffle(teams, 1)
    const b = seededShuffle(teams, 2)
    assert.notDeepEqual(a, b)
  })

  test('validatePairing: flags a rematch', ({ assert }) => {
    const played = new Set([pairKey(1, 2)])
    const conflicts = validatePairing([{ homeTeamId: 1, awayTeamId: 2 }], played, config())
    assert.lengthOf(conflicts, 1)
    assert.equal(conflicts[0]!.type, 'rematch')
  })

  test('validatePairing: flags a noPair violation', ({ assert }) => {
    const cfg = config({ constraints: { noPair: [{ teamIds: [3, 4] }] } })
    const conflicts = validatePairing([{ homeTeamId: 4, awayTeamId: 3 }], new Set(), cfg)
    assert.lengthOf(conflicts, 1)
    assert.equal(conflicts[0]!.type, 'no_pair_violation')
  })

  test('validatePairing: clean pairing has no conflicts', ({ assert }) => {
    const conflicts = validatePairing([{ homeTeamId: 1, awayTeamId: 2 }], new Set(), config())
    assert.lengthOf(conflicts, 0)
  })
})
