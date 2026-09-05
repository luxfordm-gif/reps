// Binary attachments waiting to be uploaded, held on the device.
//
// The outbox itself lives in localStorage, which can only hold strings and is
// capped at a few megabytes — a screen recording would blow it out on the first
// attachment. So the queue stores a blob id and the bytes live here, in
// IndexedDB, which handles large binary and has room for it.
//
// Ownership rule: a blob is written before its outbox entry is queued and
// deleted only after that entry has been accepted by the server or discarded by
// the user. That order means an interrupted write can leave an orphan blob
// (wasted space, cleaned up by `deleteOrphans`) but never a queued entry whose
// bytes have gone.

const DB_NAME = 'reps-blobs';
const DB_VERSION = 1;
const STORE = 'attachments';

export interface StoredBlob {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  createdAt: string;
}

function supported(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open blob store'));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Blob store request failed'));
        tx.oncomplete = () => db.close();
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error('Blob store transaction aborted'));
        };
      })
  );
}

/**
 * Bank a file for later upload. Returns the id to put in the outbox entry.
 *
 * Throws when IndexedDB is unavailable or full, which is deliberate: the caller
 * must know the bytes are safe before it queues an entry that references them.
 */
export async function putBlob(file: File): Promise<string> {
  if (!supported()) throw new Error('This browser cannot store attachments offline');
  const id = crypto.randomUUID();
  const record: StoredBlob = {
    id,
    blob: file,
    name: file.name,
    type: file.type,
    createdAt: new Date().toISOString(),
  };
  await run('readwrite', (s) => s.add(record));
  return id;
}

/** The stored file, or null if it isn't there (already sent, or evicted). */
export async function getBlob(id: string): Promise<StoredBlob | null> {
  if (!supported()) return null;
  try {
    return (await run<StoredBlob | undefined>('readonly', (s) => s.get(id))) ?? null;
  } catch {
    return null;
  }
}

export async function deleteBlob(id: string): Promise<void> {
  if (!supported()) return;
  try {
    await run('readwrite', (s) => s.delete(id));
  } catch {
    // A blob we can't delete is wasted space, never lost data.
  }
}

export async function deleteBlobs(ids: readonly string[]): Promise<void> {
  for (const id of ids) await deleteBlob(id);
}

/**
 * Drop blobs nothing references any more.
 *
 * Called after a flush with the ids still spoken for by the queue. An orphan is
 * the residue of a write that was interrupted between banking the bytes and
 * queueing the entry, so there is no one left to send it.
 */
export async function deleteOrphans(referenced: ReadonlySet<string>): Promise<void> {
  if (!supported()) return;
  try {
    const all = await run<StoredBlob[]>('readonly', (s) => s.getAll());
    const orphans = all.filter((b) => !referenced.has(b.id)).map((b) => b.id);
    await deleteBlobs(orphans);
  } catch {
    // ignore
  }
}
