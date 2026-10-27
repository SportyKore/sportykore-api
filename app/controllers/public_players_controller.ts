import { randomUUID } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import { publicWebUrl } from '#helpers/public_web_url'
import Country from '#models/country'
import LeaguePlayer from '#models/league_player'
import db from '@adonisjs/lucid/services/db'
import PublicPlayerService from '#services/public_player_service'
import { publicPlayerValidator } from '#validators/public_player'

export default class PublicPlayersController {
  private service = new PublicPlayerService()
  private async props(token: string) {
    const { league, team, requiresApproval } = await this.service.context(token)
    const countries = await Country.query().orderBy('name')
    return {
      token,
      leagueName: league.name,
      teamName: team?.name ?? null,
      requiresApproval,
      countries: countries.map((c) => ({ id: c.id, name: c.name })),
      requestId: randomUUID(),
    }
  }
  async show({ params, inertia, response, session, view }: HttpContext) {
    response.header('Cache-Control', 'no-store').header('Referrer-Policy', 'same-origin')
    try {
      const props = await this.props(params.token)
      view.share({
        socialTitle: props.teamName
          ? `Join ${props.teamName} in ${props.leagueName} | SportyKore`
          : `Join ${props.leagueName} | SportyKore`,
        socialDescription: props.teamName
          ? 'Register your player profile and join the team. No sign-in required.'
          : 'Register your player profile and join the league. No sign-in required.',
        socialImage: publicWebUrl('/images/sportykore-logo.png'),
      })
      return inertia.render('players/register', {
        ...props,
        duplicateName: Boolean(session.flashMessages.get('registrationDuplicate')),
        requestId: session.flashMessages.get('registrationRequestId') ?? props.requestId,
      })
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'status' in error &&
        [403, 404].includes(Number(error.status))
      ) {
        response.status(Number(error.status))
        return inertia.render('players/unavailable', {
          message:
            'This registration link is unavailable or has expired. Ask your organizer for a new link.',
        })
      }
      throw error
    }
  }
  async store({ params, request, response, session }: HttpContext) {
    const input = await request.validateUsing(publicPlayerValidator)
    const result = await this.service.register(params.token, input)
    if (result.duplicate) {
      session.flash('registrationDuplicate', true)
      session.flash('registrationRequestId', input.requestId)
      session.flash('inputErrorsBag', {
        name: 'A player with this name already exists. Confirm if you are registering a different player.',
      })
      return response.redirect(`/join/${encodeURIComponent(params.token)}`)
    }
    return response.redirect(
      `/join/${encodeURIComponent(params.token)}/complete/${input.requestId}`
    )
  }
  async complete({ params, inertia, response }: HttpContext) {
    response.header('Cache-Control', 'no-store').header('Referrer-Policy', 'same-origin')
    const { invite, league } = await this.service.context(params.token)
    const receipt = await db
      .from('public_player_registrations')
      .where('request_id', params.requestId)
      .where('invite_id', invite.id)
      .firstOrFail()
    const roster = await LeaguePlayer.findOrFail(receipt.roster_id)
    await roster.load('team')
    return inertia.render('players/registered', {
      leagueName: league.name,
      teamName: roster.team?.name ?? null,
      status: roster.status,
    })
  }
}
