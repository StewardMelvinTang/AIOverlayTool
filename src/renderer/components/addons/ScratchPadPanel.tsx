import { Check, ChevronLeft, Copy, Maximize2, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScratchPadNote } from '../../../shared/addons';

type SaveState = 'saved' | 'saving' | 'error';

export default function ScratchPadPanel({
  expanded,
  onToggleExpanded
}: {
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const [notes, setNotes] = useState<ScratchPadNote[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [query, setQuery] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [copyState, setCopyState] = useState('');
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(false);
  const pendingSaveRef = useRef<ScratchPadNote | null>(null);

  useEffect(() => {
    let mounted = true;
    mountedRef.current = true;

    window.floatAI.getScratchPadNotes().then((nextNotes) => {
      if (!mounted) {
        return;
      }

      const sortedNotes = sortNotes(nextNotes);
      setNotes(sortedNotes);
      setSelectedNoteId(sortedNotes[0]?.id ?? '');
    });

    return () => {
      mounted = false;
      mountedRef.current = false;

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }

      if (pendingSaveRef.current) {
        void persistNote(pendingSaveRef.current, false);
      }

      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const selectedNote = notes.find((note) => note.id === selectedNoteId);
  const filteredNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return notes;
    }

    return notes.filter((note) =>
      `${note.title}\n${note.content}`.toLowerCase().includes(normalizedQuery)
    );
  }, [notes, query]);

  async function createNote() {
    const note = await window.floatAI.createScratchPadNote();
    setNotes((current) => sortNotes([note, ...current]));
    setSelectedNoteId(note.id);
    setNoteToDelete(null);
    setSaveState('saved');
  }

  function updateNote(noteId: string, patch: Partial<Pick<ScratchPadNote, 'title' | 'content'>>) {
    const currentNote = notes.find((note) => note.id === noteId);

    if (!currentNote) {
      return;
    }

    const nextNote = {
      ...currentNote,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    setNotes((current) => sortNotes(current.map((note) => (note.id === noteId ? nextNote : note))));
    scheduleSave(nextNote);
  }

  function scheduleSave(note: ScratchPadNote) {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    pendingSaveRef.current = note;
    setSaveState('saving');
    saveTimerRef.current = setTimeout(() => {
      void persistNote(note, true);
    }, 420);
  }

  async function persistNote(note: ScratchPadNote, updateUi: boolean) {
    try {
      const savedNote = await window.floatAI.updateScratchPadNote(note.id, {
        title: note.title,
        content: note.content
      });

      if (pendingSaveRef.current?.id === note.id && pendingSaveRef.current.updatedAt === note.updatedAt) {
        pendingSaveRef.current = null;
      }

      if (updateUi && mountedRef.current) {
        setNotes((current) => sortNotes(current.map((item) => (item.id === savedNote.id ? savedNote : item))));
        setSaveState('saved');
      }
    } catch {
      if (updateUi && mountedRef.current) {
        setSaveState('error');
      }
    }
  }

  async function confirmDelete(noteId: string) {
    if (pendingSaveRef.current?.id === noteId) {
      pendingSaveRef.current = null;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }

    const nextNotes = await window.floatAI.deleteScratchPadNote(noteId);
    const sortedNotes = sortNotes(nextNotes);
    setNotes(sortedNotes);
    setSelectedNoteId((currentId) =>
      currentId === noteId ? sortedNotes[0]?.id ?? '' : currentId
    );
    setNoteToDelete(null);
    setSaveState('saved');
  }

  async function copySelectedNote() {
    if (!selectedNote) {
      return;
    }

    await window.floatAI.copyText(selectedNote.content);
    setCopyState('Copied');

    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }

    copyTimerRef.current = setTimeout(() => {
      setCopyState('');
    }, 1400);
  }

  function closeExpandedEditor() {
    setNoteToDelete(null);
    onToggleExpanded();
  }

  return (
    <div className={expanded ? 'scratchpad-panel expanded' : 'scratchpad-panel'}>
      <aside className="scratchpad-sidebar">
        <div className="scratchpad-actions">
          <div className="scratchpad-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search notes"
              aria-label="Search notes"
            />
          </div>
          <button className="primary-button compact" type="button" onClick={createNote}>
            <Plus size={15} />
            New Note
          </button>
        </div>
        <div className="scratchpad-note-list">
          {filteredNotes.length > 0 ? (
            filteredNotes.map((note) => (
              <button
                className={note.id === selectedNoteId ? 'scratchpad-note-row active' : 'scratchpad-note-row'}
                key={note.id}
                type="button"
                onClick={() => {
                  setSelectedNoteId(note.id);
                  setNoteToDelete(null);
                }}
              >
                <strong>{note.title.trim() || 'Untitled note'}</strong>
                <span>{note.content.trim() || 'No content yet'}</span>
                <time>{formatNoteTime(note.updatedAt)}</time>
              </button>
            ))
          ) : (
            <div className="scratchpad-empty-list">
              {notes.length === 0 ? 'No notes yet' : 'No matching notes'}
            </div>
          )}
        </div>
      </aside>

      <section className="scratchpad-editor">
        <div className="scratchpad-editor-toolbar">
          {expanded ? (
            <button className="scratchpad-back-button" type="button" onClick={closeExpandedEditor}>
              <ChevronLeft size={18} />
              Back
            </button>
          ) : (
            <span className={`scratchpad-save-state ${saveState}`}>
              {selectedNote
                ? saveState === 'saving'
                  ? 'Saving...'
                  : saveState === 'error'
                    ? 'Save failed'
                    : 'Saved'
                : 'ScratchPad'}
            </span>
          )}
          <div className="scratchpad-editor-actions">
            {expanded && (
              <span className={`scratchpad-save-state ${saveState}`}>
                {selectedNote
                  ? saveState === 'saving'
                    ? 'Saving...'
                    : saveState === 'error'
                      ? 'Save failed'
                      : 'Saved'
                  : 'ScratchPad'}
              </span>
            )}
            {!expanded && (
              <button
                className="icon-button soft scratchpad-expand-button"
                type="button"
                onClick={onToggleExpanded}
                title="Focus editor"
                aria-label="Focus ScratchPad editor"
              >
                <Maximize2 size={16} />
              </button>
            )}
            {selectedNote && (
              <>
                <button
                  className="icon-button soft"
                  type="button"
                  onClick={copySelectedNote}
                  title="Copy note"
                  aria-label="Copy note"
                >
                  {copyState ? <Check size={16} /> : <Copy size={16} />}
                </button>
                <button
                  className="icon-button danger"
                  type="button"
                  onClick={() => setNoteToDelete(selectedNote.id)}
                  title="Delete note"
                  aria-label="Delete note"
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
        </div>
        {selectedNote ? (
          <>
            {copyState && <div className="scratchpad-copy-toast">{copyState}</div>}

            {noteToDelete === selectedNote.id && (
              <div className="scratchpad-delete-confirm">
                <span>Delete this note?</span>
                <div>
                  <button type="button" onClick={() => setNoteToDelete(null)}>
                    <X size={14} />
                    Cancel
                  </button>
                  <button type="button" onClick={() => confirmDelete(selectedNote.id)}>
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>
            )}

            <input
              className="scratchpad-title-input"
              value={selectedNote.title}
              onChange={(event) => updateNote(selectedNote.id, { title: event.target.value })}
              placeholder="Untitled note"
              aria-label="Note title"
            />
            <textarea
              className="scratchpad-content-input"
              value={selectedNote.content}
              onChange={(event) => updateNote(selectedNote.id, { content: event.target.value })}
              placeholder="Write a note..."
              aria-label="Note content"
              spellCheck
            />
          </>
        ) : (
          <div className="addon-empty-state">
            <Plus size={30} />
            <strong>Start a local note</strong>
            <span>Create a note to keep quick thoughts inside Float AI.</span>
            <button className="primary-button compact" type="button" onClick={createNote}>
              <Plus size={15} />
              New Note
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function sortNotes(notes: ScratchPadNote[]): ScratchPadNote[] {
  return [...notes].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function formatNoteTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}
