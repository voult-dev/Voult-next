import SignIn from '../sign-in';

const safe = (path) => (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : '/account');

export default async function Login({ searchParams }) {
  const { returnTo, voult_error: error, voult_error_description: description } = await searchParams;
  return (
    <main>
      <h1>Sign in</h1>
      {returnTo && <p className="muted" data-testid="return-to">After signing in you go back to <code>{returnTo}</code>.</p>}
      {error && <p className="err" role="alert">{error}{description ? `: ${description}` : ''}</p>}
      <SignIn returnTo={safe(returnTo)} />
    </main>
  );
}
