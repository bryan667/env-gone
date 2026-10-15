import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CreatePage } from './components/CreatePage';
import { ReadNote } from './components/ReadNote';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('missing #root element');
}

const noteMatch = /^\/n\/([^/]+)\/?$/.exec(window.location.pathname);
// Valid IDs are already URL-safe. Leave malformed paths for the reader's
// validation instead of letting a bad percent escape crash the application.
const noteId = noteMatch === null ? null : noteMatch[1]!;

createRoot(container).render(
  <StrictMode>{noteId === null ? <CreatePage /> : <ReadNote id={noteId} />}</StrictMode>,
);
