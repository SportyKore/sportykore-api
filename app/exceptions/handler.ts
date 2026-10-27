import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import type { StatusPageRange, StatusPageRenderer } from '@adonisjs/core/types/http'

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * Status pages are used to display a custom HTML pages for certain error
   * codes. You might want to enable them in production only, but feel
   * free to enable them in development as well.
   */
  protected renderStatusPages = app.inProduction

  /**
   * Status pages is a collection of error code range and a callback
   * to return the HTML contents to send as a response.
   */
  protected statusPages: Record<StatusPageRange, StatusPageRenderer> = {
    '404': (_, { response }) =>
      response.type('html').send('<!doctype html><title>Not found</title><h1>Not found</h1>'),
    '500..599': (_, { response }) =>
      response
        .type('html')
        .send('<!doctype html><title>Server error</title><h1>Something went wrong</h1>'),
  }

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    const isMissingRoute =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'E_ROUTE_NOT_FOUND'
    const path = ctx.request.url()
    const isWebNavigation =
      ['GET', 'HEAD'].includes(ctx.request.method()) &&
      ctx.request.accepts(['html', 'json']) === 'html' &&
      !/^\/(api|assets|images|fonts|uploads|__)(?:\/|$)/.test(path) &&
      !/\.[^/]+$/.test(path)
    if (isMissingRoute && isWebNavigation) {
      ctx.response.header('Referrer-Policy', 'no-referrer')
      return ctx.response.redirect('https://sportykore.com')
    }
    return super.handle(error, ctx)
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
