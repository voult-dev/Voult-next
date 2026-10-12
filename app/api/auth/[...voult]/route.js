// C3: every Voult route (sign-in, MFA, sessions, passkeys, magic links, OAuth, …) from one file.
import { createVoultRouteHandlers } from '@voult/next';

export const { GET, POST, PATCH, DELETE } = createVoultRouteHandlers();
