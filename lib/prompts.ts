import {
  LYRICS_FREE_STYLE,
  PODCAST_PROMPT_TEMPLATE,
  LYRICS_PROMPT_FREE,
  LYRICS_PROMPT_TIMED,
} from './constants';

export function buildPodcastPrompt(vars: {
  speaker1: string;
  speaker2: string;
  dialogueStyle: string;
  tone: string;
}) {
  return PODCAST_PROMPT_TEMPLATE(vars);
}

export function buildLyricsPrompt(styleLabel: string, duration: string): string {
  if (duration === LYRICS_FREE_STYLE) {
    return LYRICS_PROMPT_FREE(styleLabel);
  }
  const totalSec = parseInt(duration);
  const mm = Math.floor(totalSec / 60);
  const ss = String(totalSec % 60).padStart(2, '0');
  const endTime = `${mm}:${ss}`;
  return LYRICS_PROMPT_TIMED(styleLabel, totalSec, endTime);
}
