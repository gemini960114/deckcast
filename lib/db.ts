import { openDB, IDBPDatabase } from 'idb';
import type { GenerationRecord } from './types';

const DB_NAME = 'podcast-generator';
const DB_VERSION = 1;
const STORE_NAME = 'records';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveRecord(record: GenerationRecord) {
  const db = await getDB();
  await db.put(STORE_NAME, record);
}

export async function getRecord(id: string): Promise<GenerationRecord | undefined> {
  const db = await getDB();
  return db.get(STORE_NAME, id);
}

export async function getAllRecords(): Promise<GenerationRecord[]> {
  const db = await getDB();
  const all = await db.getAll(STORE_NAME);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteRecord(id: string) {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

export async function updateRecord(id: string, updates: Partial<GenerationRecord>) {
  const db = await getDB();
  const existing = await db.get(STORE_NAME, id);
  if (existing) {
    await db.put(STORE_NAME, { ...existing, ...updates });
  }
}
