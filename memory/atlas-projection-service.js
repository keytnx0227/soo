import { getSummaryRecords } from '../summary/summary-store.js';
import { getAtlasCorrections, getManualWorldEntries } from './atlas-metadata.js';
import { applyAtlasCorrections } from './atlas-corrections.js';
import { deriveItemAtlas } from './item-memory.js';
import { derivePeopleAtlas } from './people-memory.js';
import { deriveCommitmentAtlas } from './commitment-memory.js';
import { deriveEventAtlas } from './event-memory.js';
import { deriveWorldAtlas } from './world-memory.js';

let cache = null;
let cachedChat = null;

export function invalidateAtlasProjection() {
    cache = null;
    cachedChat = null;
}

export function getAtlasProjection({ includeCorrections = true } = {}) {
    const chat = SillyTavern.getContext().chat;
    if (!cache || cachedChat !== chat) {
        const records = getSummaryRecords();
        const people = derivePeopleAtlas(records);
        const items = deriveItemAtlas(records);
        const commitments = deriveCommitmentAtlas(records);
        const events = deriveEventAtlas(records);
        const world = deriveWorldAtlas(records);
        const manualWorld = getManualWorldEntries().map(toManualWorldAtlasEntry);
        cache = {
            raw: {
                people: people.people,
                items: items.items,
                commitments: commitments.commitments,
                events: events.events,
                world: [...world.world, ...manualWorld].sort(compareWorldEntries),
                skippedUpdates: {
                    people: people.skippedUpdates,
                    items: items.skippedUpdates,
                    commitments: commitments.skippedUpdates,
                    events: events.skippedUpdates,
                    world: world.skippedUpdates,
                },
                frontierId: records.reduce((maximum, record) => Math.max(maximum, Number(record.endId) || 0), 0),
            },
            corrected: null,
        };
        cachedChat = chat;
    }
    if (!includeCorrections) return structuredClone(cache.raw);
    if (!cache.corrected) cache.corrected = applyAtlasCorrections(cache.raw, getAtlasCorrections());
    return structuredClone(cache.corrected);
}

function toManualWorldAtlasEntry(entry) {
    return {
        ...structuredClone(entry),
        manual: true,
        sourceRecordIds: [],
        firstSeenRange: null,
        lastUpdatedRange: null,
        provenance: { fields: {}, values: {} },
    };
}

function compareWorldEntries(left, right) {
    if (Boolean(left.manual) !== Boolean(right.manual)) return left.manual ? 1 : -1;
    const leftPosition = Number(left.firstSeenRange?.startId) || 0;
    const rightPosition = Number(right.firstSeenRange?.startId) || 0;
    return leftPosition - rightPosition
        || String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
        || String(left.content || '').localeCompare(String(right.content || ''));
}
