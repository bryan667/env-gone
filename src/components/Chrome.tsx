import type { ReactNode } from 'react';

export function Logo() {
  return (
    <span className="brand">
      <svg
        className="brand-icon"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="2" y="2" width="20" height="20" rx="6" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M7 9h10M7 13h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M14.5 17.5 19.5 12.5" stroke="#0066cc" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span>env-gone</span>
    </span>
  );
}

export function SiteHeader({ action }: { action?: ReactNode }) {
  return (
    <header className="site-head">
      <a className="brand-link" href="/" aria-label="env-gone home">
        <Logo />
      </a>
      {action ?? null}
    </header>
  );
}

export function SiteFooter({ left, right }: { left: string; right: string }) {
  return (
    <footer className="site-foot">
      <span>{left}</span>
      <span>{right}</span>
    </footer>
  );
}
