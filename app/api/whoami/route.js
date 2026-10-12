// getSession() in a route handler: cookies are writable here, so an expired access token is
// renewed and the rotated cookies are saved on this response.
import { getSession } from '@voult/next';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  return Response.json(session ? { email: session.user.email, verified: session.verified } : { email: null });
}
