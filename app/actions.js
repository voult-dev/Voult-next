'use server';
// getSession() in a server action: also allowed to write cookies, so it renews too.
import { getSession } from '@voult/next';

export async function whoAmI() {
  const session = await getSession();
  return session ? { email: session.user.email, verified: session.verified } : { email: null };
}
