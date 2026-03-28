export interface SlideTiming {
  slideIndex: number;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export type SlideTimings = SlideTiming[];

export interface GenerationRecord {
  id: string;
  pdfName: string;
  createdAt: number;
  // Settings snapshot
  speaker1?: string;
  speaker2?: string;
  dialogueStyle?: string;
  tone?: string;
  voice1?: string;
  voice2?: string;
  styleId?: number;
  lyricsDuration?: string;
  musicStyle: string;
  // Content
  slides?: string;
  script?: string;
  lyrics?: string;
  pdfBlob?: Blob;
  podcastBlob?: Blob;
  musicBlob?: Blob;
  podcastPptxBlob?: Blob;
  musicPptxBlob?: Blob;
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
