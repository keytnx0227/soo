import { getSummaryRecords } from '../summary/summary-store.js';
import { buildItemMemoryPromptContext as serializeItemMemory, deriveItemAtlas } from './item-memory.js';

export function getItemAtlas() {
    return deriveItemAtlas(getSummaryRecords());
}

export function buildItemMemoryPromptContext() {
    return serializeItemMemory(getItemAtlas().items);
}
