import { getSummaryRecords } from '../summary/summary-store.js';
import { buildPeopleMemoryPromptContext as serializePeopleMemory, derivePeopleAtlas } from './people-memory.js';

export function getPeopleAtlas() {
    return derivePeopleAtlas(getSummaryRecords());
}

export function buildPeopleMemoryPromptContext() {
    return serializePeopleMemory(getPeopleAtlas().people);
}
