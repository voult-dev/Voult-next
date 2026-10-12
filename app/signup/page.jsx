'use client';
import { useState } from 'react';
import { PASSWORD_REQUIREMENTS_MESSAGE, useVoult } from '@voult/react';

export default function SignUp() {
  const { signUp } = useVoult();
  const [error, setError] = useState('');
  return (
    <main>
      <h1>Create an account</h1>
      <form onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        try {
          await signUp(Object.fromEntries(new FormData(event.currentTarget)));
          window.location.assign('/account'); // full navigation: see sign-in.jsx
        } catch (err) { setError(`${err.code}: ${err.message}`); }
      }}>
        <input name="fullName" aria-label="Full name" placeholder="Full name" required />
        <input name="email" type="email" aria-label="Email" placeholder="Email" required />
        <input name="password" type="password" aria-label="Password" placeholder="Password" autoComplete="new-password" required />
        <button>Create account</button>
      </form>
      <p className="muted">{PASSWORD_REQUIREMENTS_MESSAGE}</p>
      {error && <p className="err" role="alert">{error}</p>}
    </main>
  );
}
