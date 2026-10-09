import { useState } from 'react';
import { PepperScore } from 'pepperscore';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';

/**
 * The demo maps `?score=<url>` to scoreUrl (the component never reads the page URL). It is read on the client's first
 * render; PepperScore's first render does not depend on its source props, so hydration still matches the server HTML.
 */
const linkedScore = () => typeof window === 'undefined' ? undefined : new URLSearchParams(window.location.search).get('score')?.trim() || undefined;

export default function DemoReader() {
  const [scoreUrl] = useState(linkedScore);
  return <PepperScore className="scoreflow-demo" height="100dvh" persist="scoreflow" assetBaseUrl="/" scoreUrl={scoreUrl} autoFocus />;
}
