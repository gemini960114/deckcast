import { openDB, IDBPDatabase } from 'idb';
import type { GenerationRecord } from './types';

const DB_NAME = 'podcast-generator';
const DB_VERSION = 1;
const STORE_NAME = 'records';

let dbPromise: Promise<IDBPDatabase> | null = null;

function normalizeOwnerEmail(ownerEmail?: string) {
  const normalized = ownerEmail?.trim().toLowerCase();
  return normalized || undefined;
}

function canAccessRecord(record: GenerationRecord, ownerEmail?: string) {
  const normalizedOwnerEmail = normalizeOwnerEmail(ownerEmail);
  if (!normalizedOwnerEmail) return true;
  return normalizeOwnerEmail(record.ownerEmail) === normalizedOwnerEmail;
}

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
  await db.put(STORE_NAME, {
    ...record,
    ownerEmail: normalizeOwnerEmail(record.ownerEmail),
  });
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

export async function getRecordsByOwner(ownerEmail?: string): Promise<GenerationRecord[]> {
  const all = await getAllRecords();
  const normalizedOwnerEmail = normalizeOwnerEmail(ownerEmail);
  if (!normalizedOwnerEmail) return all;
  return all.filter(record => normalizeOwnerEmail(record.ownerEmail) === normalizedOwnerEmail);
}

export async function deleteRecord(id: string, ownerEmail?: string) {
  const db = await getDB();
  const existing = await db.get(STORE_NAME, id);
  if (existing && !canAccessRecord(existing, ownerEmail)) return false;
  await db.delete(STORE_NAME, id);
  return true;
}

export async function updateRecord(id: string, updates: Partial<GenerationRecord>, ownerEmail?: string) {
  const db = await getDB();
  const existing = await db.get(STORE_NAME, id);
  if (!existing) return false;
  if (!canAccessRecord(existing, ownerEmail)) return false;

  await db.put(STORE_NAME, {
    ...existing,
    ...updates,
    ownerEmail: normalizeOwnerEmail(existing.ownerEmail ?? ownerEmail),
  });
  return true;
}
