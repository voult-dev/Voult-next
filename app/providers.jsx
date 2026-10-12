'use client';
import { VoultProvider } from '@voult/react';

export default function Providers({ children }) {
  return <VoultProvider apiBase="/api/auth">{children}</VoultProvider>;
}
