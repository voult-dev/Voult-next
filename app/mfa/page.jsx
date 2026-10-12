import SignIn from '../sign-in';

// Hosted OAuth and magic links send users with MFA here (oauth.mfaPath, default /mfa).
export default function Mfa() {
  return <main><h1>Finish signing in</h1><SignIn /></main>;
}
