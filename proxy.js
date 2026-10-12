// C5: redirect signed-out visitors before the page renders. A UX guard; requireSession() is the authority.
import { voultMiddleware } from '@voult/next/middleware';

export default voultMiddleware({ publicPaths: ['/', '/login', '/signup', '/mfa'], signInPath: '/login' });
export const config = { matcher: ['/((?!_next/|favicon.ico|.*\\..*).*)'] };
