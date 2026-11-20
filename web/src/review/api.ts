// The owner's review notes on the angel service (pkg/angel/review.go). Every
// call carries the admin token in the Authorization header, never in the URL.

import type { Target } from './locator';

export const REVIEW_API = '/api/angel/review';

export interface NotePage {
  url: string;
  hash: string;
  key: string;
  view?: string;
  item?: string;
  scene?: string;
  chapter?: string;
  lang: string;
  theme?: string;
  device: string;
  width: number;
  height: number;
  dpr: number;
  scroll: number;
  user_agent?: string;
}

export interface NoteSelection {
  text: string;
  before?: string;
  after?: string;
}

export interface NoteInput {
  comment: string;
  page: NotePage;
  target: Target;
  selection?: NoteSelection;
}

export interface Note extends NoteInput {
  id: number;
  status: 'open' | 'done';
  created: string;
  updated: string;
  audio?: string;
  audio_type?: string;
}

export class ReviewError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class ReviewApi {
  constructor(private readonly token: string) {}

  private async call<T>(method: string, path: string, body?: BodyInit, json = true): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (body && json) headers['Content-Type'] = 'application/json';
    const r = await fetch(REVIEW_API + path, { method, headers, body, cache: 'no-store' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new ReviewError(r.status, (data as { error?: string }).error ?? r.statusText);
    return data as T;
  }

  async list(): Promise<Note[]> {
    return (await this.call<{ reviews: Note[] }>('GET', '?status=all')).reviews;
  }

  create(note: NoteInput, audio?: Blob): Promise<Note> {
    if (!audio) return this.call('POST', '', JSON.stringify(note));
    const form = new FormData();
    form.append('note', JSON.stringify(note));
    const ext = /ogg/.test(audio.type) ? 'ogg' : /mp4|aac/.test(audio.type) ? 'm4a' : 'webm';
    form.append('audio', audio, `note.${ext}`);
    return this.call('POST', '', form, false);
  }

  update(id: number, patch: { comment?: string; status?: 'open' | 'done' }): Promise<Note> {
    return this.call('PATCH', `/${id}`, JSON.stringify(patch));
  }

  remove(id: number): Promise<unknown> {
    return this.call('DELETE', `/${id}`);
  }
}
