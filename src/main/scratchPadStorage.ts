import { randomUUID } from 'node:crypto';
import Store from 'electron-store';
import type { ScratchPadNote, ScratchPadNotePatch, ScratchPadStorageState } from '../shared/addons';

const scratchPadStore = new Store<ScratchPadStorageState>({
  name: 'float-ai-scratchpad',
  defaults: {
    notes: []
  }
});

let scratchPadState = normalizeScratchPadStorageState(scratchPadStore.store);

export function getScratchPadNotes(): ScratchPadNote[] {
  return [...scratchPadState.notes].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function createScratchPadNote(): ScratchPadNote {
  const now = new Date().toISOString();
  const note: ScratchPadNote = {
    id: randomUUID(),
    title: 'Untitled note',
    content: '',
    createdAt: now,
    updatedAt: now
  };

  saveScratchPadState({
    notes: [note, ...scratchPadState.notes]
  });
  return note;
}

export function updateScratchPadNote(noteId: string, patch: ScratchPadNotePatch): ScratchPadNote {
  const noteIndex = scratchPadState.notes.findIndex((note) => note.id === noteId);

  if (noteIndex === -1) {
    throw new Error('ScratchPad note was not found.');
  }

  const currentNote = scratchPadState.notes[noteIndex];
  const updatedNote: ScratchPadNote = {
    ...currentNote,
    ...(typeof patch.title === 'string' ? { title: patch.title } : {}),
    ...(typeof patch.content === 'string' ? { content: patch.content } : {}),
    updatedAt: new Date().toISOString()
  };
  const notes = [...scratchPadState.notes];
  notes[noteIndex] = updatedNote;

  saveScratchPadState({ notes });
  return updatedNote;
}

export function deleteScratchPadNote(noteId: string): ScratchPadNote[] {
  saveScratchPadState({
    notes: scratchPadState.notes.filter((note) => note.id !== noteId)
  });
  return getScratchPadNotes();
}

export function restoreScratchPadState(value: unknown): ScratchPadNote[] {
  saveScratchPadState(value);
  return getScratchPadNotes();
}

function saveScratchPadState(nextState: unknown): ScratchPadStorageState {
  scratchPadState = normalizeScratchPadStorageState(nextState);
  scratchPadStore.set(scratchPadState);
  // TODO: Keep this local-first boundary so future cloud sync can layer on top without changing the panel UI.
  return scratchPadState;
}

export function normalizeScratchPadStorageState(value: unknown): ScratchPadStorageState {
  const input = value && typeof value === 'object' ? (value as Partial<ScratchPadStorageState>) : {};
  const notesInput = Array.isArray(input.notes) ? input.notes : [];
  const notes = notesInput.filter(isScratchPadNote);

  return {
    notes
  };
}

function isScratchPadNote(value: unknown): value is ScratchPadNote {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const note = value as ScratchPadNote;
  return (
    typeof note.id === 'string' &&
    typeof note.title === 'string' &&
    typeof note.content === 'string' &&
    typeof note.createdAt === 'string' &&
    typeof note.updatedAt === 'string'
  );
}
