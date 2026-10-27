import { test } from '@japa/runner'

import Country from '#models/country'
import StageGroup from '#models/stage_group'
import User from '#models/user'
import LeagueService from '#services/league_service'
import StandingService from '#services/standing_service'
import { withFreshDatabaseAndCountries } from '../helpers/migration.js'

function createLeagueService() {
  return new LeagueService(new StandingService())
}

async function createUser() {
  return User.create({
    email: `league-swiss-${Date.now()}-${Math.random().toString(36).slice(2)}@kpakore.test`,
    fullName: 'League Swiss Tester',
  })
}

test.group('LeagueService.createWithSeason (swiss)', (group) => {
  withFreshDatabaseAndCountries(group)

  test('creates a swiss stage with groups in the same transaction as the league', async ({
    assert,
  }) => {
    const service = createLeagueService()
    const owner = await createUser()
    const ng = await Country.findByOrFail('code', 'ng')

    const result = await service.createWithSeason(owner.id, {
      name: 'FUOYE Champions League 2.0',
      countryId: ng.id,
      seasonName: '2026',
      format: 'swiss',
      swiss: {
        name: 'Opening Stage',
        groupNames: ['Ikole Campus', 'Oye Campus'],
        config: {
          format: { rounds: 3, byeHandling: 'warn' },
          qualification: { directCount: 1, playoffRankFrom: 2, playoffRankTo: 5 },
        },
      },
    })

    assert.equal(result.stage.stageType, 'swiss')
    assert.equal(result.format, 'swiss')
    assert.isFalse(result.seeded)

    const groups = await StageGroup.query().where('stage_id', result.stage.id).orderBy('sequence')
    assert.deepEqual(groups.map((g) => g.name), ['Ikole Campus', 'Oye Campus'])
  })

  test('requires groupNames when format is swiss', async ({ assert }) => {
    const service = createLeagueService()
    const owner = await createUser()
    const ng = await Country.findByOrFail('code', 'ng')

    await assert.rejects(() =>
      service.createWithSeason(owner.id, {
        name: 'No Groups League',
        countryId: ng.id,
        seasonName: '2026',
        format: 'swiss',
      })
    )
  })
})
