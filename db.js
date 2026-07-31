const DB_NAME = "draftroom";
const DB_VERSION = 1;
const NOTES_STORE = "notes";

let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(NOTES_STORE)) {
        const store = database.createObjectStore(NOTES_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
        store.createIndex("archived", "archived");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return databasePromise;
}

function runTransaction(mode, operation) {
  return openDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(NOTES_STORE, mode);
        const store = transaction.objectStore(NOTES_STORE);
        const request = operation(store);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
      }),
  );
}

export function getAllNotes() {
  return runTransaction("readonly", (store) => store.getAll());
}

export function saveNote(note) {
  return runTransaction("readwrite", (store) => store.put(note));
}

export function removeNote(id) {
  return runTransaction("readwrite", (store) => store.delete(id));
}

export async function seedNotesIfEmpty() {
  const notes = await getAllNotes();
  if (notes.length) return notes;

  const now = Date.now();
  const starters = [
    {
      id: crypto.randomUUID(),
      title: "Welcome to Draftroom",
      content:
        "This notebook currently lives entirely on your device.\n\nCreate notes, add tags, favorite ideas, search everything, and export a backup whenever you like.\n\nNext, we’ll connect the same data layer to Supabase so your notes can follow you between devices.",
      tags: ["welcome", "roadmap"],
      favorite: true,
      archived: false,
      createdAt: now - 120000,
      updatedAt: now - 120000,
    },
    {
      id: crypto.randomUUID(),
      title: "Small project ideas",
      content:
        "• A personal link garden\n• A Burmese vocabulary notebook\n• A tiny habit heatmap\n• A browser-based ambient sound mixer\n• A Codex tool for finding and creating notes",
      tags: ["ideas", "fun"],
      favorite: false,
      archived: false,
      createdAt: now - 60000,
      updatedAt: now - 60000,
    },
  ];

  await Promise.all(starters.map(saveNote));
  return starters;
}
