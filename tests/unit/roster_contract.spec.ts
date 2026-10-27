import { test } from '@japa/runner'
import type { HttpContext } from '@adonisjs/core/http'
import RosterController from '#controllers/roster_controller'
import RosterService, { DuplicateRosterNames, normalizeRosterName } from '#services/roster_service'
import {
  rosterCreateValidator,
  rosterAssignValidator,
  rosterParamsValidator,
  rosterApprovalValidator,
} from '#validators/roster'

test.group('Roster contract (no database)', () => {
  test('normalization folds compatibility characters, whitespace and case', ({ assert }) => {
    assert.equal(normalizeRosterName('  ＪＡＮＥ\t Doe '), 'jane doe')
    assert.equal(normalizeRosterName('José'), 'josé')
  })

  test('validates bulk limits, required nullable team, IDs and approval statuses', async ({
    assert,
  }) => {
    const valid = { teamId: null, names: ['Jane'], requestId: 'request-1' }
    assert.deepEqual(await rosterCreateValidator.validate(valid), valid)
    await assert.rejects(() =>
      rosterCreateValidator.validate({ names: ['Jane'], requestId: 'request-1' })
    )
    await assert.rejects(() => rosterCreateValidator.validate({ ...valid, names: ['  '] }))
    await assert.rejects(() =>
      rosterCreateValidator.validate({ ...valid, names: Array(201).fill('Jane') })
    )
    await assert.rejects(() => rosterAssignValidator.validate({ teamId: 1, rosterIds: [1, 1] }))
    await assert.rejects(() => rosterParamsValidator.validate({ leagueId: -1, seasonId: 1.5 }))
    await assert.rejects(() => rosterApprovalValidator.validate({ status: 'pending' }))
  })

  test('duplicate controller response is exactly the specified 409 envelope', async ({
    assert,
  }) => {
    const matches = [{ normalizedName: 'jane', inputIndexes: [0, 1], rosterIds: [10] }]
    class DuplicateService extends RosterService {
      override async create(): Promise<never> {
        throw new DuplicateRosterNames(matches)
      }
    }
    const ctx = {
      params: { leagueId: '1', seasonId: '2' },
      auth: { getUserOrFail: () => ({ id: 3 }) },
      request: {
        validateUsing: () =>
          rosterCreateValidator.validate({
            teamId: null,
            names: ['Jane', 'Jane'],
            requestId: 'bulk',
          }),
      },
      response: {
        conflict: (body: unknown) => ({ status: 409, body }),
      },
    } as unknown as HttpContext
    assert.deepEqual(await new RosterController(new DuplicateService()).store(ctx), {
      status: 409,
      body: { code: 'DUPLICATE_NAMES', matches },
    })
  })
})
