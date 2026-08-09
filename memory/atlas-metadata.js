import { createId } from '../core/utils.js';

const METADATA_KEY = 'sumi_chat_summarizer';
const CATEGORIES = Object.freeze(['people', 'items', 'commitments', 'events', 'world']);

export function getAtlasCorrections() {
    return structuredClone(getAtlasStore().corrections);
}

export function getAtlasEntityCorrection(category, entityId) {
    assertCategory(category);
    const correction = getAtlasStore().corrections[category][String(entityId)];
    return correction ? structuredClone(correction) : null;
}

export async function saveAtlasEntityCorrection(category, entityId, fields) {
    assertCategory(category);
    const store = getAtlasStore();
    const previous = structuredClone(store.corrections[category]);
    const normalizedFields = normalizeCorrectionFields(fields, category);
    const excluded = Boolean(store.corrections[category][String(entityId)]?.excluded);
    setCorrectionEntry(store, category, entityId, { fields: normalizedFields, excluded });
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.corrections[category] = previous;
        throw error;
    }
    notifyAtlasChanged();
    return getAtlasEntityCorrection(category, entityId);
}

export async function setAtlasEntityExcluded(category, entityId, excluded) {
    assertCategory(category);
    const store = getAtlasStore();
    const previous = structuredClone(store.corrections[category]);
    const current = store.corrections[category][String(entityId)];
    setCorrectionEntry(store, category, entityId, {
        fields: current?.fields || {},
        excluded: Boolean(excluded),
    });
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.corrections[category] = previous;
        throw error;
    }
    notifyAtlasChanged();
    return getAtlasEntityCorrection(category, entityId);
}

export async function clearAtlasEntityCorrection(category, entityId) {
    return await saveAtlasEntityCorrection(category, entityId, {});
}

export function getAtlasTranslation(category, entityId) {
    assertCategory(category);
    const translation = getAtlasStore().translations[category][String(entityId)];
    return translation ? structuredClone(translation) : null;
}

export function getAtlasTranslations(category) {
    assertCategory(category);
    return structuredClone(getAtlasStore().translations[category]);
}

export async function saveAtlasTranslation(category, entityId, translation) {
    assertCategory(category);
    const store = getAtlasStore();
    const previous = structuredClone(store.translations[category]);
    const normalized = normalizeTranslation(translation);
    if (normalized) store.translations[category][String(entityId)] = normalized;
    else delete store.translations[category][String(entityId)];
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.translations[category] = previous;
        throw error;
    }
    notifyAtlasChanged();
    return getAtlasTranslation(category, entityId);
}

export function getPeopleRetrievalMetadata() {
    return structuredClone(getAtlasStore().retrieval.people);
}

export function getPersonRetrievalMetadata(entityId) {
    return structuredClone(getAtlasStore().retrieval.people[String(entityId)] || { keywords: [], pinned: false });
}

export async function savePersonRetrievalMetadata(entityId, value) {
    const store = getAtlasStore();
    const previous = structuredClone(store.retrieval.people);
    const id = String(entityId);
    const normalized = normalizePersonRetrieval(value);
    if (normalized.keywords.length || normalized.pinned) store.retrieval.people[id] = normalized;
    else delete store.retrieval.people[id];
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.retrieval.people = previous;
        throw error;
    }
    notifyAtlasChanged();
    return getPersonRetrievalMetadata(id);
}

export function getManualWorldEntries() {
    return structuredClone(getAtlasStore().manual.world);
}

export async function addManualWorldEntry({ keys, content }) {
    const store = getAtlasStore();
    const previous = structuredClone(store.manual.world);
    const now = new Date().toISOString();
    const entry = normalizeManualWorldEntry({
        id: createId('world-manual'),
        keys,
        content,
        createdAt: now,
        updatedAt: now,
    });
    if (!entry) throw new Error('세계 설정의 키와 내용을 모두 입력해주세요.');
    store.manual.world = [...store.manual.world, entry];
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.manual.world = previous;
        throw error;
    }
    notifyAtlasChanged();
    return structuredClone(entry);
}

export async function updateManualWorldEntry(entityId, { keys, content }) {
    const store = getAtlasStore();
    const previousEntries = structuredClone(store.manual.world);
    const previousTranslations = structuredClone(store.translations.world);
    const id = String(entityId);
    let updated = null;
    store.manual.world = store.manual.world.map(entry => {
        if (entry.id !== id) return entry;
        updated = normalizeManualWorldEntry({
            ...entry,
            keys,
            content,
            updatedAt: new Date().toISOString(),
        });
        return updated;
    });
    if (!updated) throw new Error('수정할 직접 추가 세계 설정을 찾지 못했습니다.');
    delete store.translations.world[id];
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.manual.world = previousEntries;
        store.translations.world = previousTranslations;
        throw error;
    }
    notifyAtlasChanged();
    return structuredClone(updated);
}

export async function deleteManualWorldEntry(entityId) {
    const store = getAtlasStore();
    const id = String(entityId);
    if (!store.manual.world.some(entry => entry.id === id)) return false;
    const previousEntries = structuredClone(store.manual.world);
    const previousTranslations = structuredClone(store.translations.world);
    store.manual.world = store.manual.world.filter(entry => entry.id !== id);
    delete store.translations.world[id];
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.manual.world = previousEntries;
        store.translations.world = previousTranslations;
        throw error;
    }
    notifyAtlasChanged();
    return true;
}

function getAtlasStore() {
    const metadata = SillyTavern.getContext().chatMetadata;
    if (!metadata[METADATA_KEY] || typeof metadata[METADATA_KEY] !== 'object') {
        metadata[METADATA_KEY] = { records: [] };
    }
    const root = metadata[METADATA_KEY];
    if (!root.atlas || typeof root.atlas !== 'object') root.atlas = {};
    if (!root.atlas.corrections || typeof root.atlas.corrections !== 'object') root.atlas.corrections = {};
    if (!root.atlas.translations || typeof root.atlas.translations !== 'object') root.atlas.translations = {};
    if (!root.atlas.retrieval || typeof root.atlas.retrieval !== 'object') root.atlas.retrieval = {};
    if (!root.atlas.manual || typeof root.atlas.manual !== 'object') root.atlas.manual = {};
    root.atlas.manual.world = normalizeManualWorldEntries(root.atlas.manual.world);
    root.atlas.retrieval.people = normalizeEntityMap(root.atlas.retrieval.people, normalizePersonRetrieval);
    for (const category of CATEGORIES) {
        root.atlas.corrections[category] = normalizeEntityMap(
            root.atlas.corrections[category],
            entry => normalizeCorrection(entry, category),
        );
        root.atlas.translations[category] = normalizeEntityMap(root.atlas.translations[category], normalizeTranslation);
    }
    return root.atlas;
}

function normalizeManualWorldEntries(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.map(normalizeManualWorldEntry).filter(entry => {
        if (!entry || seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
    });
}

function normalizeManualWorldEntry(value) {
    if (!value || typeof value !== 'object') return null;
    const keys = normalizeStringList(value.keys);
    const content = String(value.content || '').trim();
    if (!keys.length || !content) return null;
    const createdAt = String(value.createdAt || new Date().toISOString());
    return {
        id: String(value.id || createId('world-manual')),
        keys,
        content,
        createdAt,
        updatedAt: String(value.updatedAt || createdAt),
    };
}

function normalizeStringList(value) {
    const source = Array.isArray(value) ? value : [];
    const result = [];
    const seen = new Set();
    for (const item of source) {
        const text = String(item || '').trim();
        const identity = text.normalize('NFKC').toLocaleLowerCase();
        if (!text || seen.has(identity)) continue;
        seen.add(identity);
        result.push(text);
    }
    return result;
}

function normalizeEntityMap(value, normalizer) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
        .map(([id, entry]) => [String(id), normalizer(entry)])
        .filter(([, entry]) => entry));
}

function normalizeCorrection(value, category) {
    if (!value || typeof value !== 'object') return null;
    const fields = normalizeCorrectionFields(value.fields, category);
    const excluded = Boolean(value.excluded);
    return Object.keys(fields).length || excluded ? { fields, excluded } : null;
}

function setCorrectionEntry(store, category, entityId, correction) {
    const id = String(entityId);
    if (Object.keys(correction.fields).length || correction.excluded) {
        store.corrections[category][id] = {
            fields: structuredClone(correction.fields),
            excluded: Boolean(correction.excluded),
        };
    } else {
        delete store.corrections[category][id];
    }
}

function normalizeCorrectionFields(value, category = null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const normalized = Object.fromEntries(Object.entries(value).map(([path, entry]) => {
        if (!entry || typeof entry !== 'object' || !Object.hasOwn(entry, 'value')) return [path, null];
        return [String(path), {
            value: structuredClone(entry.value),
            appliedThroughId: Math.max(0, Number(entry.appliedThroughId) || 0),
            locked: Boolean(entry.locked),
            editedAt: String(entry.editedAt || new Date().toISOString()),
        }];
    }).filter(([, entry]) => entry));
    return category === 'people' ? normalizePeopleCorrectionPaths(normalized) : normalized;
}

function normalizePeopleCorrectionPaths(fields) {
    const allowed = new Set([
        'name', 'provisional', 'aliases', 'role', 'age', 'occupation', 'appearance',
        'affiliations', 'traits', 'voice', 'lastKnownState.location',
        'lastKnownState.physicalCondition', 'relationships',
    ]);
    const normalized = {};
    for (const [path, entry] of Object.entries(fields)) {
        const mappedPath = {
            roles: 'role',
            personalityTraits: 'traits',
            speechPatterns: 'voice',
        }[path] || path;
        if (!allowed.has(mappedPath) || Object.hasOwn(normalized, mappedPath)) continue;
        const value = ['role', 'voice'].includes(mappedPath) && Array.isArray(entry.value)
            ? entry.value.map(item => String(item || '').trim()).filter(Boolean).join('; ') || null
            : entry.value;
        normalized[mappedPath] = { ...entry, value };
    }
    return normalized;
}

function normalizeTranslation(value) {
    if (!value || typeof value !== 'object' || !String(value.content || '').trim()) return null;
    return {
        content: String(value.content).trim(),
        sourceHash: String(value.sourceHash || ''),
        provider: ['google', 'bing'].includes(value.provider) ? value.provider : 'google',
        targetLanguage: String(value.targetLanguage || 'ko'),
        translatedAt: String(value.translatedAt || new Date().toISOString()),
    };
}

function normalizePersonRetrieval(value) {
    const source = value && typeof value === 'object' ? value : {};
    const keywords = Array.isArray(source.keywords) ? source.keywords : [];
    const normalizedKeywords = [];
    const seen = new Set();
    for (const keywordValue of keywords) {
        const keyword = String(keywordValue || '').trim();
        const identity = keyword.normalize('NFKC').toLocaleLowerCase();
        if (!keyword || seen.has(identity)) continue;
        seen.add(identity);
        normalizedKeywords.push(keyword);
    }
    return {
        keywords: normalizedKeywords,
        pinned: Boolean(source.pinned),
    };
}

function assertCategory(category) {
    if (!CATEGORIES.includes(category)) throw new Error('지원하지 않는 도감 종류입니다.');
}

function notifyAtlasChanged() {
    window.dispatchEvent(new CustomEvent('stsm:atlas-changed'));
}
