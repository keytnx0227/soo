const METADATA_KEY = 'sumi_chat_summarizer';
const CATEGORIES = Object.freeze(['people', 'items', 'commitments', 'events']);

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
