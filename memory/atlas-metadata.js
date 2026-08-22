import { createId } from '../core/utils.js';
import { normalizeFeelings } from './people-feelings.js';

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
    const current = store.corrections[category][String(entityId)];
    setCorrectionEntry(store, category, entityId, {
        fields: normalizedFields,
        excluded: Boolean(current?.excluded),
        llmHidden: Boolean(current?.llmHidden),
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

export async function setAtlasEntityExcluded(category, entityId, excluded) {
    assertCategory(category);
    const store = getAtlasStore();
    const previous = structuredClone(store.corrections[category]);
    const current = store.corrections[category][String(entityId)];
    setCorrectionEntry(store, category, entityId, {
        fields: current?.fields || {},
        excluded: Boolean(excluded),
        llmHidden: Boolean(current?.llmHidden),
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

export async function setAtlasEntityLlmHidden(category, entityId, llmHidden) {
    assertCategory(category);
    const store = getAtlasStore();
    const previous = structuredClone(store.corrections[category]);
    const current = store.corrections[category][String(entityId)];
    setCorrectionEntry(store, category, entityId, {
        fields: current?.fields || {},
        excluded: Boolean(current?.excluded),
        llmHidden: Boolean(llmHidden),
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
    return getManualAtlasEntries('world');
}

export function getManualAtlasEntries(category) {
    assertCategory(category);
    return structuredClone(getAtlasStore().manual[category]);
}

export function getAtlasReviewRecords() {
    return structuredClone(getAtlasStore().reviews);
}

export async function saveAtlasReviewRecord({
    id,
    category,
    startId,
    endId,
    appliedThroughId,
    batchId,
    memoryUpdates,
}) {
    assertCategory(category);
    const store = getAtlasStore();
    const previous = structuredClone(store.reviews);
    const existing = store.reviews.find(record => record.category === category
        && record.startId === Number(startId)
        && record.endId === Number(endId));
    const now = new Date().toISOString();
    const record = normalizeAtlasReviewRecord({
        id: existing?.id || String(id || createId('atlas-review')),
        category,
        startId,
        endId,
        appliedThroughId,
        batchId,
        memoryUpdates,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
    });
    if (!record) throw new Error('저장할 도감 재검토 기록이 올바르지 않습니다.');
    store.reviews = [
        ...store.reviews.filter(item => item.id !== record.id),
        record,
    ];
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.reviews = previous;
        throw error;
    }
    notifyAtlasChanged();
    return structuredClone(record);
}

export async function deleteAtlasReviewRecord(recordId) {
    const store = getAtlasStore();
    const id = String(recordId);
    if (!store.reviews.some(record => record.id === id)) return false;
    const previous = structuredClone(store.reviews);
    store.reviews = store.reviews.filter(record => record.id !== id);
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.reviews = previous;
        throw error;
    }
    notifyAtlasChanged();
    return true;
}

export async function addManualWorldEntry({ keys, content }) {
    return await addManualAtlasEntry('world', { keys, content, allowAutoUpdate: false });
}

export async function addManualAtlasEntry(category, value) {
    assertCategory(category);
    const store = getAtlasStore();
    const previous = structuredClone(store.manual[category]);
    const now = new Date().toISOString();
    const entry = normalizeManualAtlasEntry(category, {
        ...value,
        id: createId(`${category}-manual`),
        createdAt: now,
        updatedAt: now,
    });
    if (!entry) throw new Error('직접 추가할 도감 항목의 필수 정보를 입력해주세요.');
    store.manual[category] = [...store.manual[category], entry];
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.manual[category] = previous;
        throw error;
    }
    notifyAtlasChanged();
    return structuredClone(entry);
}

export async function updateManualWorldEntry(entityId, { keys, content }) {
    const current = getManualAtlasEntries('world').find(entry => entry.id === String(entityId));
    return await updateManualAtlasEntry('world', entityId, { ...current, keys, content });
}

export async function updateManualAtlasEntry(category, entityId, value) {
    assertCategory(category);
    const store = getAtlasStore();
    const previousEntries = structuredClone(store.manual[category]);
    const previousTranslations = structuredClone(store.translations[category]);
    const id = String(entityId);
    let updated = null;
    store.manual[category] = store.manual[category].map(entry => {
        if (entry.id !== id) return entry;
        updated = normalizeManualAtlasEntry(category, {
            ...entry,
            ...value,
            id: entry.id,
            createdAt: entry.createdAt,
            updatedAt: new Date().toISOString(),
        });
        return updated;
    });
    if (!updated) throw new Error('수정할 직접 추가 도감 항목을 찾지 못했습니다.');
    delete store.translations[category][id];
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.manual[category] = previousEntries;
        store.translations[category] = previousTranslations;
        throw error;
    }
    notifyAtlasChanged();
    return structuredClone(updated);
}

export async function deleteManualWorldEntry(entityId) {
    return await deleteManualAtlasEntry('world', entityId);
}

export async function deleteManualAtlasEntry(category, entityId) {
    assertCategory(category);
    const store = getAtlasStore();
    const id = String(entityId);
    if (!store.manual[category].some(entry => entry.id === id)) return false;
    const previousEntries = structuredClone(store.manual[category]);
    const previousTranslations = structuredClone(store.translations[category]);
    const previousCorrections = structuredClone(store.corrections[category]);
    const previousRetrieval = category === 'people' ? structuredClone(store.retrieval.people) : null;
    store.manual[category] = store.manual[category].filter(entry => entry.id !== id);
    delete store.translations[category][id];
    delete store.corrections[category][id];
    if (category === 'people') delete store.retrieval.people[id];
    try {
        await SillyTavern.getContext().saveMetadata();
    } catch (error) {
        store.manual[category] = previousEntries;
        store.translations[category] = previousTranslations;
        store.corrections[category] = previousCorrections;
        if (category === 'people') store.retrieval.people = previousRetrieval;
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
    root.atlas.reviews = normalizeAtlasReviewRecords(root.atlas.reviews);
    for (const category of CATEGORIES) {
        root.atlas.manual[category] = normalizeManualAtlasEntries(category, root.atlas.manual[category]);
    }
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

function normalizeAtlasReviewRecords(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.map(normalizeAtlasReviewRecord).filter(record => {
        if (!record || seen.has(record.id)) return false;
        seen.add(record.id);
        return true;
    });
}

function normalizeAtlasReviewRecord(value) {
    if (!value || typeof value !== 'object' || !CATEGORIES.includes(value.category)) return null;
    const startId = Number(value.startId);
    const endId = Number(value.endId);
    if (!Number.isInteger(startId) || !Number.isInteger(endId) || startId < 0 || startId > endId) return null;
    const updates = value.memoryUpdates && typeof value.memoryUpdates === 'object'
        ? structuredClone(value.memoryUpdates)
        : { created: [], updated: [] };
    return {
        id: String(value.id || createId('atlas-review')),
        category: value.category,
        startId,
        endId,
        appliedThroughId: Math.max(endId, Number(value.appliedThroughId) || endId),
        batchId: String(value.batchId || ''),
        memoryUpdates: updates,
        createdAt: String(value.createdAt || new Date().toISOString()),
        updatedAt: String(value.updatedAt || value.createdAt || new Date().toISOString()),
    };
}

function normalizeManualAtlasEntries(category, value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.map(entry => normalizeManualAtlasEntry(category, entry)).filter(entry => {
        if (!entry || seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
    });
}

function normalizeManualAtlasEntry(category, value) {
    if (!value || typeof value !== 'object') return null;
    const createdAt = String(value.createdAt || new Date().toISOString());
    const common = {
        id: String(value.id || createId(`${category}-manual`)),
        allowAutoUpdate: Boolean(value.allowAutoUpdate),
        appliedThroughId: Math.max(0, Number(value.appliedThroughId) || 0),
        createdAt,
        updatedAt: String(value.updatedAt || createdAt),
    };
    if (category === 'people') {
        const name = normalizeNullableString(value.name);
        if (!name) return null;
        return {
            ...common,
            name,
            provisional: Boolean(value.provisional),
            aliases: normalizeStringList(value.aliases),
            role: normalizeNullableString(value.role),
            age: normalizeNullableString(value.age),
            occupation: normalizeNullableString(value.occupation),
            appearance: normalizeNullableString(value.appearance),
            affiliations: normalizeStringList(value.affiliations),
            traits: normalizeStringList(value.traits),
            voice: normalizeNullableString(value.voice),
            lastKnownState: {
                location: normalizeNullableString(value.lastKnownState?.location),
                physicalCondition: normalizeNullableString(value.lastKnownState?.physicalCondition),
            },
            relationships: normalizeManualRelationships(value.relationships),
        };
    }
    if (category === 'items') {
        const name = normalizeNullableString(value.name);
        if (!name) return null;
        return {
            ...common,
            name,
            aliases: normalizeStringList(value.aliases),
            facts: normalizeStringList(value.facts),
            functions: normalizeStringList(value.functions),
            lastKnownState: Object.fromEntries(['owner', 'holder', 'location', 'condition', 'status']
                .map(field => [field, normalizeNullableString(value.lastKnownState?.[field])])),
        };
    }
    if (category === 'commitments') {
        const title = normalizeNullableString(value.title);
        const terms = normalizeNullableString(value.terms);
        if (!title || !terms) return null;
        return {
            ...common,
            title,
            terms,
            participants: normalizeManualParticipants(value.participants),
            conditions: normalizeStringList(value.conditions),
            deadline: normalizeNullableString(value.deadline),
            facts: normalizeStringList(value.facts),
            status: ['pending', 'fulfilled', 'obsolete'].includes(value.status) ? value.status : 'pending',
            statusReason: normalizeNullableString(value.statusReason),
        };
    }
    if (category === 'events') {
        const title = normalizeNullableString(value.title);
        const summary = normalizeNullableString(value.summary);
        if (!title || !summary) return null;
        const importance = value.importance === 'major' ? 'major' : 'minor';
        return {
            ...common,
            title,
            date: normalizeNullableString(value.date),
            location: normalizeNullableString(value.location),
            summary,
            importance,
            shift: importance === 'major' ? normalizeNullableString(value.shift) : null,
        };
    }
    const keys = normalizeStringList(value.keys);
    const content = normalizeNullableString(value.content);
    if (!keys.length || !content) return null;
    return { ...common, keys, content };
}

function normalizeManualRelationships(value) {
    if (!Array.isArray(value)) return [];
    return value.map(entry => {
        const targetName = normalizeNullableString(entry?.targetName || entry?.targetId);
        if (!targetName) return null;
        return {
            targetId: normalizeNullableString(entry?.targetId),
            targetName,
            relationship: normalizeStringList(entry?.relationship),
            feelings: normalizeFeelings(entry?.feelings),
        };
    }).filter(Boolean);
}

function normalizeManualParticipants(value) {
    if (!Array.isArray(value)) return [];
    return value.map(entry => {
        const personName = normalizeNullableString(entry?.personName || entry?.personId);
        if (!personName) return null;
        return {
            personId: normalizeNullableString(entry?.personId),
            personName,
            role: normalizeNullableString(entry?.role),
        };
    }).filter(Boolean);
}

function normalizeNullableString(value) {
    return String(value || '').trim() || null;
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
    const llmHidden = Boolean(value.llmHidden);
    return Object.keys(fields).length || excluded || llmHidden ? { fields, excluded, llmHidden } : null;
}

function setCorrectionEntry(store, category, entityId, correction) {
    const id = String(entityId);
    if (Object.keys(correction.fields).length || correction.excluded || correction.llmHidden) {
        store.corrections[category][id] = {
            fields: structuredClone(correction.fields),
            excluded: Boolean(correction.excluded),
            llmHidden: Boolean(correction.llmHidden),
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
        const value = mappedPath === 'relationships'
            ? normalizeManualRelationships(entry.value)
            : ['role', 'voice'].includes(mappedPath) && Array.isArray(entry.value)
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
