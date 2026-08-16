import {
    confirmDeleteManualAtlasEntry,
    showManualAtlasEntryEditor,
} from './atlas-manual-editor.js';

export async function showManualWorldEntryEditor(entityId = null) {
    return await showManualAtlasEntryEditor('world', entityId);
}

export async function confirmDeleteManualWorldEntry(entityId, label) {
    return await confirmDeleteManualAtlasEntry('world', entityId, label);
}
