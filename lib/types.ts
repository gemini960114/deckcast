export type NarrationMode = 'duo' | 'solo_explainer' | 'solo_story';

export type ContentLanguage = 'zh-TW' | 'en' | 'ja' | 'ko';

export type NarrationLengthPreset = 'brief' | 'balanced' | 'detailed';

export type TtsGenerationMode = 'single' | 'chunked';

export interface SlideTiming {
  slideIndex: number;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export type SlideTimings = SlideTiming[];

export interface SrtEntry {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface SrtSlideCue {
  srtId: number;
  slideIndex: number;
}

export interface SlideCueEvent {
  srtId: number;
  slideIndex: number;
  startSec: number;
}

export interface MusicTransitionMatch {
  slideIndex: number;
  startSrtId: number | null;
  confidence?: number;
  matchReason?: string;
}

export type LyricVisualTag = { kind: 'slide'; slideIndex: number };

export interface LyricSection {
  sectionIndex: number;
  sectionLabel: string;
  visualTag: LyricVisualTag;
  rawHeader: string;
  lines: string[];
}

export interface VisualCueMatch {
  cueIndex: number;
  slideIndex: number | null;
  startSrtId: number | null;
  confidence?: number;
  matchReason?: string;
}

export interface VisualCueTiming {
  cueIndex: number;
  slideIndex: number | null;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface AlignMusicDiagnostics {
  phase1Success: boolean;
  asrMode: 'whisper+gemini' | 'gemini-only';
  srtSource: 'hybrid-whisper-gemini' | 'whisper' | 'gemini-only' | 'lyrics-fallback' | 'none';
  timingSource: 'srt-id' | 'lyrics-weight-fallback' | 'equal-fallback';
  issues: string[];
}

export interface AlignPodcastDiagnostics {
  phase1Success: boolean;
  asrMode: 'whisper+gemini' | 'gemini-only';
  srtSource: 'hybrid-whisper-gemini' | 'whisper' | 'gemini-only' | 'script-fallback' | 'none';
  timingSource: 'srt-id' | 'script-char-fallback' | 'equal-fallback';
  issues: string[];
}

export interface GenerationRecord {
  id: string;
  pdfName: string;
  createdAt: number;
  ownerEmail?: string;
  contentLanguage?: ContentLanguage;
  multimodalModel?: string;
  textModel?: string;
  step41Model?: string;
  step42Model?: string;
  step71Model?: string;
  step72Model?: string;
  ttsModel?: string;
  musicModel?: string;
  // Settings snapshot
  narrationMode?: NarrationMode;
  narrationLengthPreset?: NarrationLengthPreset;
  narrationLengthNote?: string;
  speaker1?: string;
  speaker2?: string;
  dialogueStyle?: string;
  tone?: string;
  voice1?: string;
  voice2?: string;
  styleId?: number;
  lyricsDuration?: string;
  lyricsContentSource?: 'script' | 'slides';
  musicStyle: string;
  // Content
  slides?: string;
  script?: string;
  scriptGeneratedAt?: number;
  lyrics?: string;
  lyricsGeneratedAt?: number;
  pdfBlob?: Blob;
  podcastBlob?: Blob;
  podcastSource?: 'api' | 'upload';
  musicBlob?: Blob;
  musicSource?: 'api' | 'upload';
  podcastPptxBlob?: Blob;
  musicPptxBlob?: Blob;
  podcastSrt?: string;
  musicSrt?: string;
  podcastDiagnostics?: AlignPodcastDiagnostics;
  musicDiagnostics?: AlignMusicDiagnostics;
  podcastTimings?: SlideTiming[];
  musicTimings?: SlideTiming[];
  podcastSrtEntries?: SrtEntry[];
  musicSrtEntries?: SrtEntry[];
  podcastSlideCues?: SrtSlideCue[];
  musicSlideCues?: SrtSlideCue[];
  podcastSrtConfirmed?: boolean;
  musicSrtConfirmed?: boolean;
  // Step 4.1 / 7.1 — optional video export
  podcastVideoBlob?: Blob;
  musicVideoBlob?: Blob;
}

export interface StepState {
  status: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
}

export const MUSIC_STYLES = [
  { id: 1, label: 'K-POP Dance Pop' },
  { id: 2, label: 'C-POP 國風電子' },
  { id: 3, label: '台灣抒情流行' },
  { id: 4, label: 'J-POP / City Pop' },
  { id: 5, label: 'EDM / Synth-Pop' },
  { id: 6, label: 'Hip-Hop / Trap' },
  { id: 7, label: 'R&B / Neo Soul' },
  { id: 8, label: 'Pop Rock' },
  { id: 9, label: 'Indie Folk' },
  { id: 10, label: '歌劇 / Musical Theater' },
  { id: 11, label: 'Reggaeton' },
  { id: 12, label: 'Jazz / Swing' },
  { id: 13, label: 'Disco Funk' },
  { id: 14, label: 'Cinematic / Epic Orchestra' },
] as const;

export const VOICES = [
  { name: 'Zephyr',         desc: 'Bright, Higher pitch, Female' },
  { name: 'Puck',           desc: 'Upbeat, Middle pitch, Male' },
  { name: 'Charon',         desc: 'Informative, Lower pitch, Male' },
  { name: 'Kore',           desc: 'Firm, Middle pitch, Female' },
  { name: 'Fenrir',         desc: 'Excitable, Lower middle pitch, Male' },
  { name: 'Leda',           desc: 'Youthful, Higher pitch, Female' },
  { name: 'Orus',           desc: 'Firm, Lower middle pitch, Male' },
  { name: 'Aoede',          desc: 'Breezy, Middle pitch, Female' },
  { name: 'Callirrhoe',     desc: 'Easy-going, Middle pitch, Female' },
  { name: 'Autonoe',        desc: 'Bright, Middle pitch, Female' },
  { name: 'Enceladus',      desc: 'Breathy, Lower pitch, Male' },
  { name: 'Iapetus',        desc: 'Clear, Lower middle pitch, Male' },
  { name: 'Umbriel',        desc: 'Easy-going, Lower middle pitch, Male' },
  { name: 'Algieba',        desc: 'Smooth, Lower pitch, Male' },
  { name: 'Despina',        desc: 'Smooth, Middle pitch, Female' },
  { name: 'Erinome',        desc: 'Clear, Middle pitch, Female' },
  { name: 'Algenib',        desc: 'Gravelly, Lower pitch, Male' },
  { name: 'Rasalgethi',     desc: 'Informative, Middle pitch, Male' },
  { name: 'Laomedeia',      desc: 'Upbeat, Higher pitch, Female' },
  { name: 'Achernar',       desc: 'Soft, Higher pitch, Female' },
  { name: 'Alnilam',        desc: 'Firm, Lower middle pitch, Male' },
  { name: 'Schedar',        desc: 'Even, Lower middle pitch, Male' },
  { name: 'Gacrux',         desc: 'Mature, Middle pitch, Female' },
  { name: 'Pulcherrima',    desc: 'Forward, Middle pitch, Female' },
  { name: 'Achird',         desc: 'Friendly, Lower middle pitch, Male' },
  { name: 'Zubenelgenubi',  desc: 'Casual, Lower middle pitch, Male' },
  { name: 'Vindemiatrix',   desc: 'Gentle, Middle pitch, Female' },
  { name: 'Sadachbia',      desc: 'Lively, Lower pitch, Male' },
  { name: 'Sadaltager',     desc: 'Knowledgeable, Middle pitch, Male' },
  { name: 'Sulafat',        desc: 'Warm, Middle pitch, Female' },
] as const;
