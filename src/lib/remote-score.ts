/**
 * Opening a score from a public URL: the Reader's `scoreUrl` prop, or `?score=<url>` on the page. The file is
 * downloaded here and then opened through the reader's normal file path, so its format is read from its name.
 */
import { formatMb, MAX_SCORE_FILE_BYTES } from './mxl';
import { scoreFormatOf } from './score-files';

/** The query parameter that names a score to open on load. */
export const SCORE_URL_PARAM = 'score';

/** File extensions for score media types, for URLs whose path has no score extension. */
const MEDIA_EXTENSIONS: Array<[RegExp, string]> = [
  [/^application\/vnd\.recordare\.musicxml$/, '.mxl'],
  [/musicxml|^(application|text)\/xml$/, '.musicxml'],
  [/^(audio\/(x-)?midi|audio\/mid)$/, '.mid'],
  [/mei/, '.mei'],
  [/abc|^text\/plain$/, '.abc'],
];

/** The score link named in a query string, if any (resolved against the page when fetched). */
export function scoreUrlFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(SCORE_URL_PARAM)?.trim();
  return value ? value : null;
}

/** A file name for the download: the URL's own name when it has a score extension, else one from the media type. */
export function remoteFileName(url: URL, contentType: string): string {
  const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
  if (last && scoreFormatOf(last)) return last;
  const type = contentType.split(';')[0].trim().toLowerCase();
  const extension = MEDIA_EXTENSIONS.find(([pattern]) => pattern.test(type))?.[1];
  if (!extension) throw new Error('This link doesn’t point to a MusicXML, MIDI, MEI or ABC file.');
  return `${(last || url.hostname).replace(/\.[^.]*$/, '') || 'score'}${extension}`;
}

/** Download a public score as a File. Only http(s) links are fetched, and a score larger than the open limit is refused. */
export async function fetchScoreFile(link: string, base: string, signal?: AbortSignal): Promise<File> {
  let url: URL;
  // Resolved against the page, so a site-relative path works too.
  try { url = new URL(link, base); } catch { throw new Error('The score link isn’t a valid URL.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Scores can only be opened from http or https links.');
  let response: Response;
  try { response = await fetch(url, { signal, credentials: 'omit' }); }
  catch (e) {
    if (signal?.aborted) throw e;
    // A network failure and a CORS refusal look the same from here.
    throw new Error(`The score at ${url.host} couldn’t be downloaded. Check the link, and that its server allows other sites to load it (CORS).`);
  }
  if (!response.ok) throw new Error(`The score at ${url.host} couldn’t be downloaded (${response.status}${response.statusText ? ` ${response.statusText}` : ''}).`);
  const tooLarge = (bytes: number) => new Error(`This score is ${formatMb(bytes)}; scores up to ${formatMb(MAX_SCORE_FILE_BYTES)} can be opened.`);
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_SCORE_FILE_BYTES) throw tooLarge(declared);
  const name = remoteFileName(new URL(response.url || url.href), response.headers.get('content-type') || '');
  const blob = await response.blob();
  if (blob.size > MAX_SCORE_FILE_BYTES) throw tooLarge(blob.size);
  return new File([blob], name, { type: blob.type });
}
