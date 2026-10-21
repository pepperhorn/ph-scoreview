import './styles.css';
import PepperScore from './components/PepperScore';
import type { PepperScoreProps } from './components/PepperScore';

export { PepperScore };
export default PepperScore;
export type { PepperScoreProps, PepperScoreHandle, PepperScoreReadyInfo, PepperScoreClickInfo, PepperScoreHighlight, PepperScoreInsets, PepperScoreScrollTarget, PepperScoreScrollOptions } from './components/PepperScore';
export type { ChromePreset, PepperScoreControls } from './lib/chrome';
export type { PepperScoreSettings } from './lib/prefs';
export type { ExternalClock, ClockEvent } from './lib/clock';
export type { SoundSource } from './lib/sounds';
export type { SoundPackName } from './lib/assets';
export { SOUNDS_VERSION, defaultAssetBaseUrl } from './lib/assets';
/** @deprecated Use PepperScore. Kept for one release. */
export const Reader = PepperScore;
/** @deprecated Use PepperScoreProps. Kept for one release. */
export type ReaderProps = PepperScoreProps;
